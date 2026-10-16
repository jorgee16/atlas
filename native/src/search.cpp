#include "atlas/core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <iterator>
#include <set>
#include <sstream>
#include <stdexcept>

namespace atlas {
std::string normalize(std::string_view in) {
  std::string out;
  bool space = true;
  auto append = [&](char c) {
    if (c) {
      out += c;
      space = false;
    } else if (!space) {
      out += ' ';
      space = true;
    }
  };
  for (std::size_t i = 0; i < in.size();) {
    uint32_t c = static_cast<unsigned char>(in[i++]);
    if (c >= 128) {
      int n = (c & 0xe0) == 0xc0   ? 1
              : (c & 0xf0) == 0xe0 ? 2
              : (c & 0xf8) == 0xf0 ? 3
                                   : 0;
      if (!n) {
        append(0);
        continue;
      }
      c &= (1u << (6 - n)) - 1;
      for (int j = 0; j < n; ++j) {
        if (i == in.size() ||
            (static_cast<unsigned char>(in[i]) & 0xc0) != 0x80)
          throw std::runtime_error("Invalid UTF-8 query");
        c = (c << 6) | (static_cast<unsigned char>(in[i++]) & 63);
      }
    }
    if (c >= 0x300 && c <= 0x36f)
      continue;
    char a = 0;
    if (c < 128 && std::isalnum(static_cast<unsigned char>(c)))
      a = char(std::tolower(static_cast<unsigned char>(c)));
    else if ((c >= 0xc0 && c <= 0xc5) || (c >= 0xe0 && c <= 0xe5))
      a = 'a';
    else if (c == 0xc7 || c == 0xe7)
      a = 'c';
    else if ((c >= 0xc8 && c <= 0xcb) || (c >= 0xe8 && c <= 0xeb))
      a = 'e';
    else if ((c >= 0xcc && c <= 0xcf) || (c >= 0xec && c <= 0xef))
      a = 'i';
    else if (c == 0xd1 || c == 0xf1)
      a = 'n';
    else if ((c >= 0xd2 && c <= 0xd6) || (c >= 0xf2 && c <= 0xf6))
      a = 'o';
    else if ((c >= 0xd9 && c <= 0xdc) || (c >= 0xf9 && c <= 0xfc))
      a = 'u';
    else if (c == 0xdd || c == 0xfd || c == 0xff)
      a = 'y';
    append(a);
  }
  if (!out.empty() && out.back() == ' ')
    out.pop_back();
  return out;
}
Search::Search(const std::string &ip, const std::string &rp)
    : index_(ip), records_(rp) {
  index_.range(0, 32);
  records_.range(0, 32);
  if (index_.text(0, 4) != "ATSI" || index_.u16(4) != 2 ||
      records_.text(0, 4) != "ATSR" || records_.u16(4) != 1 ||
      records_.u16(6) != 24)
    throw std::runtime_error("Search requires ATSI v2 / ATSR v1 assets");
  auto count = index_.u32(12), entries = index_.u32(16),
       tokens = index_.u32(20), posts = index_.u32(24);
  if (entries < 32 || uint64_t(entries) + uint64_t(count) * 16 > tokens ||
      tokens > posts || posts > index_.size() ||
      index_.u32(8) != records_.u32(8))
    throw std::runtime_error("Invalid search index header");
  index_.range(entries, std::size_t(count) * 16);
  std::string_view previous;
  for (uint32_t i = 0; i < count; ++i) {
    auto o = entries + std::size_t(i) * 16;
    auto at = uint64_t(tokens) + index_.u32(o);
    auto len = index_.u16(o + 4);
    if (at + len > posts ||
        uint64_t(posts) + index_.u32(o + 8) > index_.size() ||
        index_.u32(o + 12) > records_.u32(8))
      throw std::runtime_error("Invalid search token entry");
    auto token = index_.text(std::size_t(at), len);
    if (i && token <= previous)
      throw std::runtime_error("Unsorted search tokens");
    previous = token;
  }
  auto n = records_.u32(8), sc = records_.u32(12), ro = records_.u32(16),
       rb = records_.u32(20), so = records_.u32(24), sb = records_.u32(28);
  if (ro < 32 || uint64_t(ro) + (uint64_t(n) + 1) * 4 > rb || rb > so ||
      uint64_t(so) + (uint64_t(sc) + 1) * 4 > sb || sb > records_.size())
    throw std::runtime_error("Invalid search record sections");
  for (uint32_t i = 0; i <= n; ++i) {
    auto a = records_.u32(ro + std::size_t(i) * 4);
    if (uint64_t(rb) + a > so ||
        (i && a < records_.u32(ro + std::size_t(i - 1) * 4)))
      throw std::runtime_error("Invalid search record offsets");
  }
  for (uint32_t i = 0; i <= sc; ++i) {
    auto a = records_.u32(so + std::size_t(i) * 4);
    if (uint64_t(sb) + a > records_.size() ||
        (i && a < records_.u32(so + std::size_t(i - 1) * 4)))
      throw std::runtime_error("Invalid search string offsets");
  }
}
std::string Search::stringAt(uint32_t id) const {
  if (!id)
    return {};
  if (id > records_.u32(12))
    throw std::runtime_error("Invalid search string reference");
  auto o = records_.u32(24) + std::size_t(id - 1) * 4;
  auto start = records_.u32(o), end = records_.u32(o + 4);
  return std::string(
      records_.text(records_.u32(28) + std::size_t(start), end - start));
}
Place Search::record(uint32_t id) const {
  if (id >= records_.u32(8))
    throw std::out_of_range("Invalid search record");
  auto o = records_.u32(16) + std::size_t(id) * 4;
  auto at = records_.u32(20) + std::size_t(records_.u32(o)),
       end = records_.u32(20) + std::size_t(records_.u32(o + 4));
  if (end - at < 16)
    throw std::runtime_error("Truncated search record");
  Place p;
  p.id = stringAt(records_.u32(at));
  p.point = {records_.i32(at + 8) / 1e6, records_.i32(at + 4) / 1e6};
  p.fields.resize(24);
  if (!valid(p.point))
    throw std::runtime_error("Invalid search coordinate");
  auto mask = records_.u32(at + 12);
  at += 16;
  if (mask & 0xff000000u)
    throw std::runtime_error("Unknown search fields");
  for (unsigned f = 0; f < 24; ++f)
    if (mask & (1u << f)) {
      if (end - at < 4)
        throw std::runtime_error("Truncated search fields");
      p.fields[f] = stringAt(records_.u32(at));
      at += 4;
    }
  if (at != end)
    throw std::runtime_error("Invalid search record size");
  return p;
}
std::string Place::name() const {
  if (!fields[0].empty())
    return fields[0];
  return fields[5] + (fields[4].empty() ? "" : " " + fields[4]);
}
bool Place::visitable() const {
  return fields[23] != "true" && fields[1] != "address" &&
         fields[1] != "street" && fields[22].empty() && fields[3].empty();
}
std::vector<uint32_t> Search::postings(std::string_view query,
                                       bool prefix) const {
  auto entries = index_.u32(16), tokens = index_.u32(20), base = index_.u32(24),
       count = index_.u32(12);
  auto tokenAt = [&](uint32_t i) {
    auto o = entries + std::size_t(i) * 16;
    return index_.text(tokens + std::size_t(index_.u32(o)), index_.u16(o + 4));
  };
  uint32_t lo = 0, hi = count;
  while (lo < hi) {
    auto mid = lo + (hi - lo) / 2;
    if (tokenAt(mid) < query)
      lo = mid + 1;
    else
      hi = mid;
  }
  std::vector<uint32_t> out;
  for (auto i = lo; i < count; ++i) {
    auto token = tokenAt(i);
    if (prefix ? (token.substr(0, query.size()) != query) : (token != query))
      break;
    auto o = entries + std::size_t(i) * 16;
    std::size_t at = base + std::size_t(index_.u32(o + 8));
    uint64_t previous = 0;
    for (uint32_t j = 0; j < index_.u32(o + 12); ++j) {
      uint32_t delta = 0;
      unsigned shift = 0;
      while (true) {
        auto b = index_.u8(at++);
        if (shift == 28 && (b & 0xf0))
          throw std::runtime_error("Search varint overflow");
        delta |= uint32_t(b & 127) << shift;
        if (!(b & 128))
          break;
        shift += 7;
        if (shift > 28)
          throw std::runtime_error("Invalid search varint");
      }
      previous += delta;
      if (previous >= records_.u32(8) || (j && delta == 0))
        throw std::runtime_error("Invalid search posting");
      out.push_back(uint32_t(previous));
    }
    if (!prefix)
      break;
  }
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}
std::vector<Place> Search::query(std::string_view input, Point anchor,
                                 std::size_t limit) const {
  if (!valid(anchor) || limit > 1000)
    throw std::invalid_argument("Invalid search options");
  auto text = normalize(input);
  if (text.size() < 2 || text.size() > 256 || !limit)
    return {};
  std::istringstream stream(text);
  std::vector<std::string> words;
  std::string w;
  static const std::set<std::string> stop = {"a",  "as",  "da", "das", "de",
                                             "do", "dos", "e",  "of",  "the"};
  while (stream >> w)
    if (!stop.count(w))
      words.push_back(w);
  if (words.empty())
    return {};
  std::vector<std::vector<uint32_t>> lists;
  for (std::size_t i = 0; i < words.size(); ++i) {
    auto ids = postings(words[i], i + 1 == words.size());
    if (ids.empty())
      return {};
    lists.push_back(std::move(ids));
  }
  std::sort(lists.begin(), lists.end(),
            [](const auto &a, const auto &b) { return a.size() < b.size(); });
  auto ids = std::move(lists[0]);
  for (std::size_t i = 1; i < lists.size(); ++i) {
    std::vector<uint32_t> next;
    std::set_intersection(ids.begin(), ids.end(), lists[i].begin(),
                          lists[i].end(), std::back_inserter(next));
    ids = std::move(next);
  }
  std::vector<Place> out;
  auto less = [](const Place &a, const Place &b) {
    return a.score != b.score ? a.score < b.score : a.meters < b.meters;
  };
  for (auto id : ids) {
    auto p = record(id);
    std::string hay;
    for (auto &f : p.fields)
      hay += ' ' + normalize(f);
    bool all = true;
    for (auto &word : words)
      if (hay.find(word) == std::string::npos) {
        all = false;
        break;
      }
    if (!all)
      continue;
    auto name = normalize(p.name());
    p.score = name == text                              ? 0
              : name.compare(0, text.size(), text) == 0 ? 1
              : name.find(text) != std::string::npos    ? 2
                                                        : 3;
    p.meters = distance(anchor, p.point);
    out.push_back(std::move(p));
    if (out.size() > limit * 2) {
      std::partial_sort(out.begin(), out.begin() + std::ptrdiff_t(limit),
                        out.end(), less);
      out.resize(limit);
    }
  }
  std::sort(out.begin(), out.end(), less);
  if (out.size() > limit)
    out.resize(limit);
  return out;
}
std::vector<Place> Search::nearby(Point anchor, double radius,
                                  std::string_view category,
                                  std::size_t limit) const {
  if (!valid(anchor) || !std::isfinite(radius) || radius < 0 ||
      radius > 100000 || limit > 1000)
    throw std::invalid_argument("Invalid nearby options");
  std::vector<Place> out;
  if (!limit)
    return out;
  auto less = [](const Place &a, const Place &b) {
    return a.meters < b.meters;
  };
  for (uint32_t i = 0; i < records_.u32(8); ++i) {
    auto recordOffset = records_.u32(16) + std::size_t(i) * 4;
    auto at = records_.u32(20) + std::size_t(records_.u32(recordOffset));
    auto end = records_.u32(20) + std::size_t(records_.u32(recordOffset + 4));
    if (end - at < 16)
      throw std::runtime_error("Truncated nearby record");
    Point coordinate{records_.i32(at + 8) / 1e6, records_.i32(at + 4) / 1e6};
    if (!valid(coordinate))
      throw std::runtime_error("Invalid nearby coordinate");
    double meters = distance(anchor, coordinate);
    if (meters > radius)
      continue;
    auto p = record(i);
    if (!p.visitable())
      continue;
    if (!category.empty() && p.fields[1] != category &&
        p.fields[2] != category && p.fields[18] != category &&
        p.fields[19] != category)
      continue;
    p.meters = meters;
    out.push_back(std::move(p));
    if (out.size() > limit * 2) {
      std::partial_sort(out.begin(), out.begin() + std::ptrdiff_t(limit),
                        out.end(), less);
      out.resize(limit);
    }
  }
  std::sort(out.begin(), out.end(), less);
  if (out.size() > limit)
    out.resize(limit);
  return out;
}
std::string placesJson(const std::vector<Place> &places) {
  std::ostringstream s;
  s.precision(12);
  s << '[';
  for (std::size_t i = 0; i < places.size(); ++i) {
    if (i)
      s << ',';
    auto &p = places[i];
    s << "{\"id\":" << jsonString(p.id) << ",\"name\":" << jsonString(p.name())
      << ",\"lat\":" << p.point.lat << ",\"lon\":" << p.point.lon
      << ",\"distanceMeters\":" << p.meters
      << ",\"type\":" << jsonString(p.fields[1]) << '}';
  }
  return s.str() + ']';
}
} // namespace atlas
