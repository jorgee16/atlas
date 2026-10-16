#include "atlas/core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <iterator>
#include <map>
#include <regex>
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
         fields[1] != "street" && normalize(fields[22]) != "administrative" &&
         !std::set<std::string>{"administrative", "borough",       "city",
                                "district",       "hamlet",        "locality",
                                "municipality",   "neighbourhood", "parish",
                                "quarter",        "region",        "suburb",
                                "town",           "village"}
              .count(normalize(fields[1])) &&
         !std::set<std::string>{"administrative", "borough",       "city",
                                "district",       "hamlet",        "locality",
                                "municipality",   "neighbourhood", "parish",
                                "quarter",        "region",        "suburb",
                                "town",           "village"}
              .count(normalize(fields[3]));
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
namespace {
std::string foldSearch(std::string_view input) {
  std::string result;
  for (std::size_t i = 0; i < input.size();) {
    unsigned char c = input[i];
    if (c < 128) {
      result += char(std::tolower(c));
      ++i;
      continue;
    }
    auto count = (c & 0xe0) == 0xc0   ? 2u
                 : (c & 0xf0) == 0xe0 ? 3u
                 : (c & 0xf8) == 0xf0 ? 4u
                                      : 1u;
    if (i + count > input.size())
      throw std::runtime_error("Invalid UTF-8 query");
    auto character = input.substr(i, count);
    auto folded = normalize(character);
    if (!folded.empty())
      result += folded;
    else if (!(count == 2 && c == 0xcc) && !(count == 2 && c == 0xcd))
      result += character;
    i += count;
  }
  auto begin = result.find_first_not_of(" \t\r\n");
  if (begin == std::string::npos)
    return {};
  return result.substr(begin, result.find_last_not_of(" \t\r\n") - begin + 1);
}
std::vector<std::string> splitWords(const std::string &text) {
  std::istringstream stream(text);
  std::vector<std::string> out;
  std::string word;
  while (stream >> word)
    out.push_back(word);
  return out;
}
std::string compactPostcode(std::string_view value) {
  std::string out;
  for (unsigned char c : value)
    if (c < 128 && std::isalnum(c))
      out += char(std::tolower(c));
  return out;
}
bool oneEdit(const std::string &a, const std::string &b) {
  if (a.size() > b.size() + 1 || b.size() > a.size() + 1)
    return false;
  std::size_t i = 0, j = 0;
  int edits = 0;
  while (i < a.size() && j < b.size()) {
    if (a[i] == b[j]) {
      ++i;
      ++j;
      continue;
    }
    if (++edits > 1)
      return false;
    if (a.size() > b.size())
      ++i;
    else if (b.size() > a.size())
      ++j;
    else {
      ++i;
      ++j;
    }
  }
  return true;
}
const std::set<std::string> geographic = {
    "administrative", "borough",      "city",          "district", "hamlet",
    "locality",       "municipality", "neighbourhood", "parish",   "quarter",
    "region",         "suburb",       "town",          "village"};
bool isGeographic(const Place &p) {
  return geographic.count(normalize(p.fields[1])) ||
         geographic.count(normalize(p.fields[3]));
}
std::string address(const Place &p) {
  return p.fields[4] + (p.fields[4].empty() || p.fields[5].empty() ? "" : " ") +
         p.fields[5];
}
std::string city(const Place &p) {
  return !p.fields[7].empty()    ? p.fields[7]
         : !p.fields[16].empty() ? p.fields[16]
                                 : p.fields[17];
}
int quality(const Place &p) {
  if (!isGeographic(p))
    return address(p).empty() ? 0 : -1;
  const auto type = normalize(p.fields[1]);
  return (geographic.count(normalize(p.fields[3])) ? 0 : 10) +
         ((type == "administrative" || type == "district" ||
           type == "municipality" || type == "parish" || type == "region")
              ? 5
              : 0);
}
bool sameLocation(const Place &a, const Place &b) {
  if (foldSearch(a.name()) != foldSearch(b.name()))
    return false;
  if (a.id == b.id)
    return true;
  if (isGeographic(a) != isGeographic(b))
    return false;
  if (isGeographic(a)) {
    auto ac = normalize(city(a)), bc = normalize(city(b));
    return (ac.empty() || bc.empty() || ac == bc) &&
           distance(a.point, b.point) <= 3000;
  }
  auto ak = normalize(a.fields[2].empty() ? a.fields[1] : a.fields[2]),
       bk = normalize(b.fields[2].empty() ? b.fields[1] : b.fields[2]);
  if (!ak.empty() && !bk.empty() && ak != bk)
    return false;
  auto aa = normalize(address(a)), ba = normalize(address(b));
  return (aa.empty() || ba.empty() || aa == ba) &&
         distance(a.point, b.point) <= 40;
}
std::optional<double> matchScore(const Place &p, const std::string &query,
                                 const std::vector<std::string> &tokens,
                                 bool postcodeQuery) {
  static const std::map<std::string, std::string> aliases = {
      {"cafe", "cafe coffee espresso"},
      {"restaurant", "restaurant food eat dinner lunch"},
      {"pub", "pub bar drinks nightlife"},
      {"hotel", "hotel accommodation lodging stay"},
      {"museum", "museum culture attraction"},
      {"hospital", "hospital health emergency"},
      {"pharmacy", "pharmacy chemist medicine"},
      {"fuel", "fuel petrol gas station"},
      {"parking", "parking car park"},
      {"viewpoint", "viewpoint miradouro vista attraction"}};
  std::vector<std::string> fields(5);
  fields[0] = foldSearch(p.fields[0]);
  for (int i = 8; i <= 15; ++i)
    fields[1] += " " + foldSearch(p.fields[i]);
  for (int i : {3, 7, 16, 17})
    fields[2] += " " + foldSearch(p.fields[i]);
  for (int i : {4, 5, 6, 7})
    fields[3] += " " + foldSearch(p.fields[i]);
  for (int i : {2, 1, 3})
    fields[4] += " " + foldSearch(p.fields[i]);
  for (int i : {2, 1}) {
    auto it = aliases.find(p.fields[i]);
    if (it != aliases.end())
      fields[4] += " " + it->second;
  }
  std::vector<std::vector<std::string>> words;
  for (auto &f : fields)
    words.push_back(splitWords(f));
  auto code = compactPostcode(p.fields[6]), wanted = compactPostcode(query);
  bool exactPost = postcodeQuery && !code.empty() && code == wanted,
       prefixPost = postcodeQuery && !code.empty() &&
                    code.compare(0, wanted.size(), wanted) == 0;
  std::smatch parsed;
  bool exactAddress = false, prefixAddress = false, partialAddress = false;
  if (std::regex_match(
          query, parsed,
          std::regex("^([0-9]+[a-z]?(?:[-/][0-9]+[a-z]?)?)\\s+(.+)$"))) {
    auto street = foldSearch(p.fields[5]);
    bool house = foldSearch(p.fields[4]) == parsed[1].str();
    auto wantedStreet = parsed[2].str();
    exactAddress = house && street == wantedStreet;
    prefixAddress =
        house && street.compare(0, wantedStreet.size(), wantedStreet) == 0;
    partialAddress = house && street.find(wantedStreet) != std::string::npos;
  }
  double score = 0;
  for (auto &token : tokens) {
    int best = 100000;
    for (std::size_t f = 0; f < words.size(); ++f)
      for (auto &word : words[f]) {
        int match = word == token                               ? 0
                    : word.compare(0, token.size(), token) == 0 ? 1
                    : word.find(token) != std::string::npos     ? 2
                    : token.size() >= 4 && oneEdit(token, word) ? 3
                                                                : 10000;
        best = std::min(best, match * 10 + int(f));
      }
    if (best >= 100000) {
      if (exactPost || prefixPost || exactAddress || prefixAddress ||
          partialAddress)
        continue;
      return std::nullopt;
    }
    score += best;
  }
  auto name = foldSearch(p.fields[0]);
  score -= name == query                               ? 40
           : name.compare(0, query.size(), query) == 0 ? 20
           : name.find(query) != std::string::npos     ? 8
                                                       : 0;
  score -= exactPost ? 120 : prefixPost ? 70 : 0;
  score -= exactAddress ? 140 : prefixAddress ? 110 : partialAddress ? 80 : 0;
  return score;
}
} // namespace
std::vector<Place> Search::query(std::string_view input, Point anchor,
                                 std::size_t limit) const {
  if (!valid(anchor) || limit > 1000)
    throw std::invalid_argument("Invalid search options");
  auto text = foldSearch(input);
  if (text.size() < 2 || text.size() > 256 || !limit)
    return {};
  auto compact = compactPostcode(input);
  const bool postcode =
      std::regex_match(
          compact, std::regex("[a-z]{1,2}[0-9][a-z0-9]?(?:[0-9][a-z]{2})?")) ||
      std::regex_match(std::string(input),
                       std::regex("[0-9]{4}(?:-?[0-9]{0,3})?"));
  auto words = postcode ? std::vector<std::string>{compact} : splitWords(text);
  std::vector<std::vector<uint32_t>> lists;
  for (auto &word : words) {
    auto ids = postings(word, false);
    if (!ids.empty())
      lists.push_back(std::move(ids));
  }
  // Preserve useful prefix lookup when the package has no exact query token.
  if (lists.empty() && !words.empty()) {
    auto ids = postings(words.back(), true);
    if (!ids.empty())
      lists.push_back(std::move(ids));
  }
  if (lists.empty())
    return {};
  std::sort(lists.begin(), lists.end(),
            [](const auto &a, const auto &b) { return a.size() < b.size(); });
  auto useful = std::max<std::size_t>(100000, lists[0].size() * 100);
  lists.erase(
      std::remove_if(lists.begin() + 1, lists.end(),
                     [&](const auto &list) { return list.size() > useful; }),
      lists.end());
  if (lists.size() > 4)
    lists.resize(4);
  auto ids = std::move(lists[0]);
  for (std::size_t i = 1; i < lists.size(); ++i) {
    std::vector<uint32_t> next;
    std::set_intersection(ids.begin(), ids.end(), lists[i].begin(),
                          lists[i].end(), std::back_inserter(next));
    ids = std::move(next);
  }
  std::vector<Place> matches;
  for (auto id : ids) {
    auto p = record(id);
    auto score = matchScore(p, text, words, postcode);
    if (!score || p.fields[0].empty())
      continue;
    p.score = *score;
    p.meters = distance(anchor, p.point);
    matches.push_back(std::move(p));
  }
  std::stable_sort(matches.begin(), matches.end(),
                   [](const Place &a, const Place &b) {
                     if (a.score != b.score)
                       return a.score < b.score;
                     if (a.meters != b.meters)
                       return a.meters < b.meters;
                     return a.name() < b.name();
                   });
  std::vector<Place> unique;
  for (auto &candidate : matches) {
    auto existing =
        std::find_if(unique.begin(), unique.end(), [&](const Place &p) {
          return sameLocation(p, candidate);
        });
    if (existing != unique.end()) {
      if (quality(candidate) < quality(*existing)) {
        auto score = std::min(existing->score, candidate.score);
        *existing = std::move(candidate);
        existing->score = score;
      }
    } else if (unique.size() < limit)
      unique.push_back(std::move(candidate));
  }
  return unique;
}
std::vector<Place> Search::addresses(std::string_view input, Point anchor,
                                     std::size_t limit) const {
  if (!valid(anchor) || limit > 1000)
    throw std::invalid_argument("Invalid address options");
  auto text = normalize(input), compact = compactPostcode(input);
  auto raw = splitWords(text);
  if (text.empty() || !limit)
    return {};
  std::string house, postcode;
  for (auto &word : raw) {
    if (house.empty() &&
        std::regex_match(word, std::regex("[0-9]+[a-z]?(?:[-/][0-9]+[a-z]?)?")))
      house = word;
    if (postcode.empty() &&
        std::regex_match(word, std::regex("[0-9]{4}-?[0-9]{0,3}")))
      postcode = compactPostcode(word);
  }
  if (postcode.empty() &&
      std::regex_match(compact,
                       std::regex("[a-z]{1,2}[0-9][a-z0-9]?[0-9][a-z]{2}")))
    postcode = compact;
  std::vector<std::string> tokens;
  auto add = [&](const std::string &w) {
    if ((w.size() >= 2 ||
         (!w.empty() && std::isdigit(static_cast<unsigned char>(w[0])))) &&
        std::find(tokens.begin(), tokens.end(), w) == tokens.end())
      tokens.push_back(w);
  };
  if (!house.empty())
    add(house);
  for (auto &word : raw)
    if (word != house && word != postcode)
      add(word);
  if (!postcode.empty())
    add(postcode);
  static const std::set<std::string> generic = {
      "a",     "as",    "da",        "das",    "de",      "do",
      "dos",   "e",     "of",        "the",    "alameda", "avenida",
      "av",    "beco",  "boulevard", "blvd",   "calcada", "close",
      "court", "ct",    "drive",     "dr",     "estrada", "lane",
      "ln",    "largo", "place",     "pl",     "praca",   "praceta",
      "road",  "rd",    "rua",       "street", "st",      "travessa",
      "way"};
  std::vector<std::vector<uint32_t>> lists;
  for (auto &word : tokens) {
    if (!std::isdigit(static_cast<unsigned char>(word[0])) &&
        (word.size() < 3 || generic.count(word)))
      continue;
    auto ids = postings(word, false);
    if (ids.empty())
      return {};
    lists.push_back(std::move(ids));
  }
  if (lists.empty())
    return {};
  std::sort(lists.begin(), lists.end(),
            [](const auto &a, const auto &b) { return a.size() < b.size(); });
  if (lists.size() > 4)
    lists.resize(4);
  auto ids = std::move(lists[0]);
  for (std::size_t i = 1; i < lists.size(); ++i) {
    std::vector<uint32_t> next;
    std::set_intersection(ids.begin(), ids.end(), lists[i].begin(),
                          lists[i].end(), std::back_inserter(next));
    ids = std::move(next);
  }
  std::string streetQuery;
  for (auto &word : tokens)
    if (word != house && word != postcode) {
      if (!streetQuery.empty())
        streetQuery += ' ';
      streetQuery += word;
    }
  std::vector<Place> matches;
  std::set<std::string> seen;
  for (auto id : ids) {
    auto p = record(id);
    auto kind = normalize(p.fields[1].empty() ? p.fields[2] : p.fields[1]);
    auto name = normalize(p.fields[0]);
    auto street = normalize(p.fields[5].empty() ? p.fields[0] : p.fields[5]);
    auto number = normalize(p.fields[4]);
    auto code = compactPostcode(p.fields[6]);
    auto context = normalize(city(p));
    auto hay = name + ' ' + street + ' ' + number + ' ' + code + ' ' + context;
    bool all = true;
    for (auto &word : tokens)
      if (hay.find(word) == std::string::npos) {
        all = false;
        break;
      }
    if (!all)
      continue;
    double score = kind == "address" ? 0 : 18;
    if (!house.empty())
      score += number == house ? -45 : kind == "address" ? 30 : 0;
    if (!postcode.empty())
      score += code == postcode ? -35 : !code.empty() ? 20 : 0;
    if (!streetQuery.empty())
      score -= street == streetQuery || name == streetQuery ? 30
               : street.compare(0, streetQuery.size(), streetQuery) == 0 ||
                       name.compare(0, streetQuery.size(), streetQuery) == 0
                   ? 18
               : street.find(streetQuery) != std::string::npos ||
                       name.find(streetQuery) != std::string::npos
                   ? 8
                   : 0;
    p.meters = distance(anchor, p.point);
    p.score = score + std::min(p.meters / 50000, 8.0);
    auto key = normalize(p.name()) + '|' + normalize(p.fields[7]) + '|' +
               std::to_string(std::floor(p.point.lat * 1000 + .5)) + '|' +
               std::to_string(std::floor(p.point.lon * 1000 + .5));
    if (!seen.insert(key).second)
      continue;
    matches.push_back(std::move(p));
  }
  std::stable_sort(
      matches.begin(), matches.end(), [](const Place &a, const Place &b) {
        return a.score != b.score ? a.score < b.score : a.meters < b.meters;
      });
  if (matches.size() > limit)
    matches.resize(limit);
  return matches;
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
      << ",\"distanceMeters\":" << p.meters << ",\"matchScore\":" << p.score
      << ",\"address\":" << jsonString(address(p))
      << ",\"city\":" << jsonString(city(p))
      << ",\"amenity\":" << jsonString(p.fields[2])
      << ",\"place\":" << jsonString(p.fields[3])
      << ",\"type\":" << jsonString(p.fields[1]) << '}';
  }
  return s.str() + ']';
}
} // namespace atlas
