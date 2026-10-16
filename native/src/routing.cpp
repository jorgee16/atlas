#include "atlas/core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <queue>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace atlas {
namespace {
void length(const Binary &b, std::size_t expected) {
  if (b.size() != expected)
    throw std::runtime_error("Invalid binary asset length");
}
std::string file(const std::string &d, const char *f) { return d + "/" + f; }
} // namespace
Graph::Graph(const std::string &d)
    : nodes_(file(d, "nodes.bin")), edges_(file(d, "edges.bin")),
      geometry_(file(d, "geometry.bin")), roads_(file(d, "roads.bin")),
      strings_(file(d, "strings.bin")),
      restrictions_(file(d, "restrictions.bin")),
      grid_(file(d, "spatial-index.bin")) {
  nodes_.header("RNOD", 6, 16);
  edges_.header("REDG", 6, 20);
  geometry_.header("RGEO", 6, 24);
  roads_.header("RROD", 6, 16);
  strings_.header("RSTR", 6, 12);
  restrictions_.header("RTRN", 6, 16);
  grid_.header("RGRD", 6, 24);
  auto n = nodeCount(), e = edgeCount(), r = roads_.u32(8);
  if (!n || nodes_.u32(12) != 12 || edges_.u32(8) != n ||
      edges_.u32(16) != 20 || roads_.u32(12) != 36 || geometry_.u32(16) != 8 ||
      geometry_.u32(20) != 8 || restrictions_.u32(12) != 16 ||
      grid_.u32(20) != 16 || grid_.u32(8) == 0 || grid_.u32(16) != n)
    throw std::runtime_error("Inconsistent routing metadata");
  length(nodes_, 16 + std::size_t(n) * 12);
  length(edges_, 20 + (std::size_t(n) + 1) * 4 + std::size_t(e) * 20);
  length(roads_, 16 + std::size_t(r) * 36);
  length(strings_, 12 + std::size_t(strings_.u32(8)));
  length(geometry_, 24 + std::size_t(geometry_.u32(8)) * 8 +
                        std::size_t(geometry_.u32(12)) * 8);
  auto nr = restrictions_.u32(8);
  length(restrictions_, 16 + std::size_t(nr) * 16);
  length(grid_, 24 + std::size_t(grid_.u32(12)) * 16 + std::size_t(n) * 4);
  if (offset(0) != 0 || offset(n) != e)
    throw std::runtime_error("Invalid edge offset endpoints");
  profileMasks_.resize(n);
  for (uint32_t i = 0; i < n; ++i) {
    if (!valid(point(i)) || offset(i) > offset(i + 1) || offset(i + 1) > e)
      throw std::runtime_error("Invalid graph topology");
    for (auto j = offset(i); j < offset(i + 1); ++j) {
      auto ed = edge(j);
      if (ed.target >= n || ed.road >= r ||
          (ed.geometry & 0x1fffffff) >= geometry_.u32(8))
        throw std::runtime_error("Invalid edge reference");
      uint8_t mask = (ed.allows(Profile::drive) ? 1 : 0) |
                     (ed.allows(Profile::walk) ? 2 : 0);
      profileMasks_[i] |= mask;
      profileMasks_[ed.target] |= mask;
    }
  }
  for (uint32_t i = 0; i < geometry_.u32(8); ++i) {
    auto start = geometry_.u32(24 + std::size_t(i) * 8),
         count = geometry_.u32(28 + std::size_t(i) * 8);
    if (uint64_t(start) + count > geometry_.u32(12))
      throw std::runtime_error("Invalid geometry arc");
  }
  for (uint32_t i = 0; i < r; ++i)
    for (unsigned j = 0; j < 8; ++j)
      (void)stringAt(roads_.u32(16 + std::size_t(i) * 36 + j * 4));
  restrictionOffsets_.resize(std::size_t(n) + 1);
  uint32_t prev = 0;
  for (uint32_t i = 0; i < nr; ++i) {
    auto o = 16 + std::size_t(i) * 16;
    auto via = restrictions_.u32(o);
    if (via >= n || via < prev || restrictions_.u32(o + 4) >= r ||
        restrictions_.u32(o + 8) >= r)
      throw std::runtime_error("Invalid turn restriction");
    ++restrictionOffsets_[via + 1];
    prev = via;
  }
  for (std::size_t i = 1; i < restrictionOffsets_.size(); ++i)
    restrictionOffsets_[i] += restrictionOffsets_[i - 1];
  int32_t px = std::numeric_limits<int32_t>::min(), py = px;
  for (uint32_t i = 0; i < grid_.u32(12); ++i) {
    auto o = 24 + std::size_t(i) * 16;
    auto x = grid_.i32(o), y = grid_.i32(o + 4);
    if ((i && (x < px || (x == px && y <= py))) ||
        uint64_t(grid_.u32(o + 8)) + grid_.u32(o + 12) > n)
      throw std::runtime_error("Invalid spatial cell");
    px = x;
    py = y;
  }
  auto entries = 24 + std::size_t(grid_.u32(12)) * 16;
  for (uint32_t i = 0; i < n; ++i)
    if (grid_.u32(entries + std::size_t(i) * 4) >= n)
      throw std::runtime_error("Invalid spatial node");
}
Point Graph::point(uint32_t n) const {
  if (n >= nodeCount())
    throw std::out_of_range("Invalid node");
  return {nodes_.f32(16 + std::size_t(n) * 12),
          nodes_.f32(20 + std::size_t(n) * 12)};
}
uint32_t Graph::component(uint32_t n) const {
  (void)point(n);
  return nodes_.u32(24 + std::size_t(n) * 12);
}
uint32_t Graph::offset(uint32_t n) const {
  if (n > nodeCount())
    throw std::out_of_range("Invalid node offset");
  return edges_.u32(20 + std::size_t(n) * 4);
}
Edge Graph::edge(uint32_t e) const {
  if (e >= edgeCount())
    throw std::out_of_range("Invalid edge");
  auto o = 20 + (std::size_t(nodeCount()) + 1) * 4 + std::size_t(e) * 20;
  auto a = edges_.u32(o + 8);
  return {edges_.u32(o),      edges_.u32(o + 4), a & 0xffffff, a,
          edges_.u32(o + 12), edges_.u32(o + 16)};
}
std::string Graph::stringAt(uint32_t o) const {
  if (o >= strings_.u32(8))
    throw std::runtime_error("Invalid road string offset");
  std::size_t end = 12 + o;
  while (end < strings_.size() && strings_.u8(end))
    ++end;
  if (end == strings_.size())
    throw std::runtime_error("Unterminated road string");
  return std::string(strings_.text(12 + o, end - 12 - o));
}
Road Graph::road(uint32_t r, bool reversed) const {
  if (r >= roads_.u32(8))
    throw std::out_of_range("Invalid road");
  auto o = 16 + std::size_t(r) * 36;
  auto lanes = stringAt(roads_.u32(o + (reversed ? 24 : 20)));
  if (lanes.empty())
    lanes = stringAt(roads_.u32(o + 16));
  return {stringAt(roads_.u32(o)), stringAt(roads_.u32(o + 4)),
          stringAt(roads_.u32(o + 8)), lanes, roads_.u32(o + 32)};
}
uint32_t Graph::roadFlags(uint32_t r) const {
  if (r >= roads_.u32(8))
    throw std::out_of_range("Invalid road");
  return roads_.u32(48 + std::size_t(r) * 36);
}
bool Graph::restricted(uint32_t n) const {
  return restrictionOffsets_.at(n) !=
         restrictionOffsets_.at(std::size_t(n) + 1);
}
bool Graph::turnAllowed(uint32_t n, int64_t incoming, uint32_t outgoing,
                        int64_t from, uint32_t target) const {
  if (incoming < 0)
    return true;
  bool only = false, match = false;
  for (auto i = restrictionOffsets_.at(n);
       i < restrictionOffsets_.at(std::size_t(n) + 1); ++i) {
    auto o = 16 + std::size_t(i) * 16;
    auto a = restrictions_.u32(o + 4), b = restrictions_.u32(o + 8);
    if (a != incoming)
      continue;
    if (!(restrictions_.u32(o + 12) & 1)) {
      if (a == b && b == outgoing && from >= 0) {
        if (target == from)
          return false;
        continue;
      }
      if (b == outgoing)
        return false;
    } else {
      only = true;
      if (b == outgoing && (a != b || from < 0 || target != from))
        match = true;
    }
  }
  return !only || match;
}
std::optional<uint32_t> Graph::nearest(Point p, Profile profile,
                                       double radius) const {
  if (!valid(p) || !std::isfinite(radius) || radius < 0 || radius > 100000)
    throw std::invalid_argument("Invalid road snapping input");
  double cell = grid_.u32(8) / 1e6;
  int cx = int(std::floor(p.lon / cell)), cy = int(std::floor(p.lat / cell));
  int rx =
      int(std::ceil(
          radius /
          (111320 * std::max(std::cos(p.lat * 3.141592653589793 / 180), .01) *
           cell))) +
      1;
  int ry = int(std::ceil(radius / (111320 * cell))) + 1;
  double best = radius;
  std::optional<uint32_t> found;
  auto base = 24 + std::size_t(grid_.u32(12)) * 16;
  // Scan existing cells inside the bounds; unlike a rectangular empty-cell loop
  // this is bounded by file size.
  for (uint32_t c = 0; c < grid_.u32(12); ++c) {
    auto o = 24 + std::size_t(c) * 16;
    auto x = grid_.i32(o), y = grid_.i32(o + 4);
    if (x < cx - rx || x > cx + rx || y < cy - ry || y > cy + ry)
      continue;
    auto begin = grid_.u32(o + 8), count = grid_.u32(o + 12);
    for (uint32_t j = 0; j < count; ++j) {
      auto n = grid_.u32(base + (std::size_t(begin) + j) * 4);
      if (!(profileMasks_[n] & (profile == Profile::drive ? 1 : 2)))
        continue;
      double d = distance(p, point(n));
      if (d <= best) {
        best = d;
        found = n;
      }
    }
  }
  return found;
}
void Graph::appendGeometry(const Edge &e, std::vector<Point> &out) const {
  auto arc = e.geometry & 0x1fffffff;
  auto o = 24 + std::size_t(arc) * 8;
  auto begin = geometry_.u32(o), count = geometry_.u32(o + 4);
  auto base = 24 + std::size_t(geometry_.u32(8)) * 8;
  for (uint32_t i = 0; i < count; ++i) {
    auto j = (e.geometry & 0x80000000u) ? begin + count - i - 1 : begin + i;
    auto at = base + std::size_t(j) * 8;
    Point p{geometry_.f32(at), geometry_.f32(at + 4)};
    if (!valid(p))
      throw std::runtime_error("Invalid geometry point");
    out.push_back(p);
  }
  out.push_back(point(e.target));
}
double tollRate(std::string ref, int cls) {
  static const std::map<std::string, double> rates = {
      {"A1", .073},  {"A2", .074},  {"A3", .099},  {"A4", .096},  {"A5", .105},
      {"A6", .110},  {"A8", .080},  {"A9", .108},  {"A10", .109}, {"A11", .080},
      {"A12", .080}, {"A13", .080}, {"A14", .080}, {"A15", .107}, {"A16", .080},
      {"A17", .108}, {"A19", .080}, {"A21", .080}, {"A23", .080}, {"A24", .080},
      {"A25", .080}, {"A28", .080}, {"A29", .080}, {"A32", .080}, {"A33", .080},
      {"A41", .080}, {"A42", .080}, {"A43", .080}};
  static const double mult[] = {1, 1, 1.75, 2.25, 2.5};
  std::string token;
  double value = .08;
  for (char c : ref + ";") {
    if (c == ';' || c == ',' || c == '/') {
      auto it = rates.find(token);
      if (it != rates.end()) {
        value = it->second;
        break;
      }
      token.clear();
    } else if (!std::isspace(static_cast<unsigned char>(c)))
      token += char(std::toupper(static_cast<unsigned char>(c)));
  }
  return value * mult[cls >= 1 && cls <= 4 ? cls : 1];
}
std::optional<Route> route(const Graph &g, uint32_t start, uint32_t goal,
                           const RouteOptions &op) {
  if (start >= g.nodeCount() || goal >= g.nodeCount() ||
      !std::isfinite(op.penaltyMinutesPerEuro) || op.penaltyMinutesPerEuro < 0)
    throw std::invalid_argument("Invalid routing options");
  if (g.component(start) != g.component(goal))
    return {};
  struct Arrival {
    uint32_t node, road, from;
  };
  struct Item {
    double priority, cost;
    std::size_t state;
    bool operator<(const Item &b) const { return priority > b.priority; }
  };
  // Dense predecessor arrays avoid allocating a large object (and padding) per
  // mainland node.
  const auto n = std::size_t(g.nodeCount());
  std::vector<double> costs(n, std::numeric_limits<double>::infinity());
  std::vector<int64_t> predecessors(n, -1);
  std::vector<uint32_t> predecessorEdges(n);
  std::vector<Arrival> virtualStates;
  std::unordered_map<uint64_t, std::size_t> arrivals;
  auto nodeOf = [&](std::size_t s) {
    return s < n ? uint32_t(s) : virtualStates.at(s - n).node;
  };
  std::priority_queue<Item> q;
  auto heuristic = [&](uint32_t node) {
    return std::floor(distance(g.point(node), g.point(goal)) / (140 / 3.6) *
                      100);
  };
  costs[start] = 0;
  q.push({heuristic(start), 0, start});
  uint32_t expanded = 0;
  while (!q.empty()) {
    if (op.cancelled && op.cancelled())
      throw std::runtime_error("Route cancelled");
    auto item = q.top();
    q.pop();
    if (item.cost != costs[item.state])
      continue;
    const auto currentNode = nodeOf(item.state);
    if (currentNode == goal) {
      Route r;
      r.expanded = expanded;
      for (int64_t state = int64_t(item.state); state >= 0;
           state = predecessors[std::size_t(state)]) {
        r.nodes.push_back(nodeOf(std::size_t(state)));
        if (predecessors[std::size_t(state)] >= 0)
          r.edges.push_back(predecessorEdges[std::size_t(state)]);
      }
      std::reverse(r.nodes.begin(), r.nodes.end());
      std::reverse(r.edges.begin(), r.edges.end());
      r.points.push_back(g.point(start));
      auto from = start;
      for (auto index : r.edges) {
        auto e = g.edge(index);
        auto road = g.road(e.road, e.geometry & 0x80000000u);
        auto first = r.points.size() - 1;
        g.appendGeometry(e, r.points);
        double meters = e.distanceDm / 10.,
               seconds =
                   op.profile == Profile::walk
                       ? std::max(1., std::round(meters / 1.4 * 100)) / 100
                       : e.durationCs / 100.;
        r.legs.push_back({index, from, e.target, first, r.points.size() - 1,
                          meters, seconds, r.meters, road});
        r.meters += meters;
        r.seconds += seconds;
        if (op.profile == Profile::drive && (road.flags & 4))
          r.tollEuros += meters / 1000 * tollRate(road.ref, op.vehicleClass);
        from = e.target;
      }
      makeManeuvers(r, g);
      return r;
    }
    if (++expanded > op.maxExpanded)
      throw std::runtime_error("Offline route exceeds expansion limit");
    const int64_t incomingRoad =
        item.state < n ? -1 : int64_t(virtualStates[item.state - n].road);
    const int64_t incomingFrom =
        item.state < n ? -1 : int64_t(virtualStates[item.state - n].from);
    for (auto i = g.offset(currentNode); i < g.offset(currentNode + 1); ++i) {
      auto e = g.edge(i);
      if (!e.allows(op.profile))
        continue;
      auto flags = g.roadFlags(e.road);
      if (op.profile == Profile::drive &&
          ((op.avoidTolls && (flags & 4)) ||
           !g.turnAllowed(currentNode, incomingRoad, e.road, incomingFrom,
                          e.target)))
        continue;
      auto target = std::size_t(e.target);
      if (op.profile == Profile::drive && g.restricted(e.target)) {
        uint64_t key = (uint64_t(e.target) << 32) | i;
        auto it = arrivals.find(key);
        if (it == arrivals.end()) {
          target = costs.size();
          arrivals.emplace(key, target);
          virtualStates.push_back({e.target, e.road, currentNode});
          costs.push_back(std::numeric_limits<double>::infinity());
          predecessors.push_back(-1);
          predecessorEdges.push_back(0);
        } else
          target = it->second;
      }
      double base =
          op.profile == Profile::walk
              ? std::max(1., std::round(e.distanceDm / 10. / 1.4 * 100))
              : e.durationCs;
      double penalty =
          op.profile == Profile::drive && (flags & 4) &&
                  op.penaltyMinutesPerEuro > 0
              ? std::round(e.distanceDm / 10000. *
                           tollRate(g.road(e.road).ref, op.vehicleClass) *
                           op.penaltyMinutesPerEuro * 6000)
              : 0;
      double next = item.cost + base + penalty;
      if (next < costs[target]) {
        costs[target] = next;
        predecessors[target] = int64_t(item.state);
        predecessorEdges[target] = i;
        q.push({next + heuristic(e.target), next, target});
      }
    }
  }
  return {};
}
std::string routeJson(const Route &r) {
  std::ostringstream s;
  s.precision(12);
  s << "{\"distanceMeters\":" << r.meters
    << ",\"durationSeconds\":" << r.seconds << ",\"tollEuros\":" << r.tollEuros
    << ",\"expandedNodes\":" << r.expanded << ",\"points\":[";
  for (std::size_t i = 0; i < r.points.size(); ++i) {
    if (i)
      s << ',';
    s << '[' << r.points[i].lon << ',' << r.points[i].lat << ']';
  }
  s << "],\"maneuvers\":[";
  for (std::size_t i = 0; i < r.maneuvers.size(); ++i) {
    if (i)
      s << ',';
    auto &m = r.maneuvers[i];
    s << "{\"type\":" << jsonString(m.type)
      << ",\"instruction\":" << jsonString(m.instruction)
      << ",\"road\":" << jsonString(m.road) << ",\"at\":" << m.at
      << ",\"point\":" << m.point << '}';
  }
  s << "],\"edgeIndexes\":[";
  for (std::size_t i = 0; i < r.edges.size(); ++i) {
    if (i)
      s << ',';
    s << r.edges[i];
  }
  s << "]}";
  return s.str();
}
} // namespace atlas
