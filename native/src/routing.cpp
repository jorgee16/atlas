#include "atlas/core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <unordered_set>
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
std::vector<uint32_t> Graph::destinationCandidates(
    Point p, Profile profile, uint32_t componentId,
    double radius, std::size_t limit) const {
  if (!valid(p) || !std::isfinite(radius) || radius<=0 ||
      radius>10000 || limit==0 || limit>64)
    throw std::invalid_argument("Invalid destination access search");
  const double cell=grid_.u32(8)/1e6, rad=3.141592653589793/180;
  const int cx=int(std::floor(p.lon/cell)),cy=int(std::floor(p.lat/cell));
  const int rx=int(std::ceil(radius/(111320*std::max(
      std::cos(p.lat*rad),.01)*cell)))+1;
  const int ry=int(std::ceil(radius/(111320*cell)))+1;
  const auto base=24+std::size_t(grid_.u32(12))*16;
  std::vector<std::pair<double,uint32_t>> near;
  for(uint32_t i=0;i<grid_.u32(12);++i) {
    const auto o=24+std::size_t(i)*16;
    const int x=grid_.i32(o),y=grid_.i32(o+4);
    if(x<cx-rx||x>cx+rx||y<cy-ry||y>cy+ry)continue;
    const auto begin=grid_.u32(o+8),count=grid_.u32(o+12);
    for(uint32_t j=0;j<count;++j) {
      const auto n=grid_.u32(base+(std::size_t(begin)+j)*4);
      if(component(n)!=componentId ||
          !(profileMasks_[n]&(profile==Profile::drive?1:2)))continue;
      const auto d=distance(p,point(n));
      if(d<=radius)near.emplace_back(d,n);
    }
  }
  std::sort(near.begin(),near.end(),[](const auto &a,const auto &b){
    return a.first!=b.first?a.first<b.first:a.second<b.second;
  });
  std::vector<uint32_t> out;
  out.reserve(limit);
  // Avoid retrying many nodes at the same dead-end road approach.
  for(const auto &[meters,n]:near) {
    bool duplicate=false;
    for(const auto chosen:out)
      if(distance(point(n),point(chosen))<65.){duplicate=true;break;}
    if(duplicate)continue;
    out.push_back(n);
    if(out.size()==limit)break;
  }
  return out;
}
std::optional<DirectedRoadStart> Graph::nearestDirected(
    Point p, Profile profile, double heading, double tolerance) const {
  if (!valid(p) || !std::isfinite(heading) || heading < 0 ||
      !std::isfinite(tolerance) || tolerance <= 0) return {};
  // Search nearby directional ROAD EDGES, not arbitrary nearby road nodes.
  // A position on a two-way road must not pick its opposite travel direction.
  const double cell=grid_.u32(8)/1e6;
  const double rad=3.141592653589793/180;
  const double mx=111320*std::max(std::cos(p.lat*rad),.01);
  const int cx=int(std::floor(p.lon/cell)), cy=int(std::floor(p.lat/cell));
  const int rx=int(std::ceil(240./(mx*cell)))+1;
  const int ry=int(std::ceil(240./(111320.*cell)))+1;
  const auto base=24+std::size_t(grid_.u32(12))*16;
  std::optional<DirectedRoadStart> selected;
  double scoreBest=std::numeric_limits<double>::infinity();
  for(uint32_t cellIndex=0;cellIndex<grid_.u32(12);++cellIndex) {
    const auto o=24+std::size_t(cellIndex)*16;
    const int x=grid_.i32(o), y=grid_.i32(o+4);
    if(x<cx-rx || x>cx+rx || y<cy-ry || y>cy+ry)continue;
    const auto begin=grid_.u32(o+8),count=grid_.u32(o+12);
    for(uint32_t k=0;k<count;++k) {
      const auto n=grid_.u32(base+(std::size_t(begin)+k)*4);
      if(distance(p,point(n))>240.)continue;
      for(uint32_t ei=offset(n);ei<offset(n+1);++ei) {
        const auto e=edge(ei);
        if(!e.allows(profile))continue;
        std::vector<Point> line{point(n)};
        appendGeometry(e,line);
        for(std::size_t i=1;i<line.size();++i) {
          const auto a=line[i-1], b=line[i];
          const double dx=(b.lon-a.lon)*mx, dy=(b.lat-a.lat)*111320.;
          const double den=dx*dx+dy*dy;
          if(den<1e-5)continue;
          const double xx=(a.lon-p.lon)*mx,yy=(a.lat-p.lat)*111320.;
          const double fraction=std::clamp(-(xx*dx+yy*dy)/den,0.,1.);
          const Point projected{a.lat+(b.lat-a.lat)*fraction,
                                a.lon+(b.lon-a.lon)*fraction};
          const double proximity=distance(p,projected);
          if(proximity>tolerance)continue;
          const double angular=std::abs(std::remainder(heading-bearing(a,b),360.));
          if(angular>55.)continue;
          double remaining=distance(projected,b);
          for(std::size_t j=i+1;j<line.size();++j)
            remaining+=distance(line[j-1],line[j]);
          if(remaining<4.)continue;
          const double score=proximity+angular*.19+std::min(remaining,150.)*.015;
          if(score<scoreBest) {
            scoreBest=score;
            selected=DirectedRoadStart{n,ei,projected};
          }
        }
      }
    }
  }
  return selected;
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
std::optional<Route> route(const Graph &g, uint32_t start, uint32_t goal,
                           const RouteOptions &op) {
  if (start >= g.nodeCount() || goal >= g.nodeCount() ||
      !std::isfinite(op.sharedEdgePenaltySecondsPerKm) ||
      op.sharedEdgePenaltySecondsPerKm < 0 ||
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
    if (currentNode == goal && !(op.initialEdge && item.state == start)) {
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
        from = e.target;
      }
      // Trim the edge geometry behind the current GPS projection. Without
      // this, the preview starts at a graph intersection BEHIND the car and
      // guidance may appear to point in the opposite direction.
      if(op.initialEdge && op.initialSnap && !r.legs.empty() &&
         !r.edges.empty() && r.edges.front()==*op.initialEdge) {
        const std::size_t last=r.legs.front().last;
        std::size_t segment=0;
        double nearest=std::numeric_limits<double>::infinity();
        Point snapped{};
        const double mx=111320*std::max(
            std::cos(op.initialSnap->lat*3.141592653589793/180),.01);
        for(std::size_t i=1;i<=last;++i) {
          const auto a=r.points[i-1], b=r.points[i];
          const double dx=(b.lon-a.lon)*mx,dy=(b.lat-a.lat)*111320.;
          const double x=(a.lon-op.initialSnap->lon)*mx;
          const double y=(a.lat-op.initialSnap->lat)*111320.;
          const double den=dx*dx+dy*dy;
          const double t=den>0?std::clamp(-(x*dx+y*dy)/den,0.,1.):0.;
          const Point projected{a.lat+(b.lat-a.lat)*t,
                                a.lon+(b.lon-a.lon)*t};
          const double d=distance(projected,*op.initialSnap);
          if(d<nearest) {nearest=d;segment=i-1;snapped=projected;}
        }
        if(nearest<=8.0 && segment<last) {
          double total=0,discarded=0;
          for(std::size_t i=1;i<=last;++i)
            total+=distance(r.points[i-1],r.points[i]);
          for(std::size_t i=1;i<=segment;++i)
            discarded+=distance(r.points[i-1],r.points[i]);
          discarded+=distance(r.points[segment],snapped);
          const double fraction=total>1.0?
              std::clamp(discarded/total,0.,1.):0.;
          const double clippedMeters=r.legs.front().distance*fraction;
          const double clippedSeconds=r.legs.front().duration*fraction;
          std::vector<Point> cropped{snapped};
          cropped.insert(cropped.end(),r.points.begin()+segment+1,
                         r.points.end());
          r.points=std::move(cropped);
          r.legs.front().distance-=clippedMeters;
          r.legs.front().duration-=clippedSeconds;
          r.meters-=clippedMeters;
          r.seconds-=clippedSeconds;
          for(std::size_t i=0;i<r.legs.size();++i) {
            auto &leg=r.legs[i];
            if(i>0) {
              leg.first-=segment;
              leg.startDistance-=clippedMeters;
            }
            leg.last-=segment;
          }
        }
      }
      // Price only the portion ACTUALLY driven: initial GPS projection can
      // clip the first edge. The old implementation priced it before clipping.
      // Missing tariff coverage is NOT equivalent to a zero-euro journey.
      r.tollCountry=op.tariffCountry;
      r.tollVehicleClass=op.vehicleClass;
      if(op.tariffs){
        r.tollCountry=op.tariffs->country;
        r.tollCurrency=op.tariffs->currency;
        r.tollYear=op.tariffs->year;
        r.tollSource=op.tariffs->source;
        r.tollVersion=op.tariffs->version;
        r.tollFractionDigits=op.tariffs->fractionDigits;
        r.tollVehicleClasses=op.tariffs->classes;
      }
      std::unordered_map<std::string, std::size_t> tollRoadIndex;
      bool allExplicitlyFree=true;std::vector<std::string> freeSources;
      for(const auto &leg:r.legs)if(op.profile==Profile::drive &&
                                     (leg.road.flags & 4)){
        r.tolledMeters+=leg.distance;
        const bool explicitlyFree=op.tariffs && op.tariffs->explicitlyFree(leg.road.ref,op.vehicleClass);
        allExplicitlyFree=allExplicitlyFree&&explicitlyFree;
        if(explicitlyFree){const auto source=op.tariffs->freeSourceFor(leg.road.ref,op.vehicleClass);if(!source.empty()&&std::find(freeSources.begin(),freeSources.end(),source)==freeSources.end())freeSources.push_back(source);}
        const auto knownAmount=op.tariffs
            ? op.tariffs->estimate(leg.road.ref,leg.distance,op.vehicleClass)
            : std::nullopt;
        const auto reference=(!knownAmount&&op.tariffs)?op.tariffs->referenceEstimate(leg.road.ref,leg.distance,op.vehicleClass):std::nullopt;
        const auto amount=knownAmount?knownAmount:reference;
        // Road refs are a graph hint, not exact entry/exit tariff sections.
        // Report uncovered distances without pretending they are toll-free.
        const auto roadLabel=leg.road.ref.empty()
            ? (leg.road.name.empty()?std::string("Unknown road"):leg.road.name)
            : leg.road.ref;
        auto found=tollRoadIndex.find(roadLabel);
        if(found==tollRoadIndex.end()){
          found=tollRoadIndex.emplace(roadLabel,r.tollRoads.size()).first;
          TollRoadCharge item;item.road=roadLabel;item.exact=true;r.tollRoads.push_back(std::move(item));
        }
        auto &breakdown=r.tollRoads[found->second];
        breakdown.exact=breakdown.exact&&explicitlyFree;
        breakdown.meters+=leg.distance;
        if(amount){
          if(reference){breakdown.referenceMeters+=leg.distance;r.referenceTollMeters+=leg.distance;}
          else {breakdown.pricedMeters+=leg.distance;r.pricedTollMeters+=leg.distance;}
          breakdown.amount+=*amount;
          r.tollEuros+=*amount;
        } else {
          breakdown.complete=false;
          r.tollPriceComplete=false;
        }
      }
      r.tollPriceExact=r.tolledMeters>0&&r.tollPriceComplete&&allExplicitlyFree;
      for(const auto &source:freeSources)r.tollSource+="\n"+source;
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
      // Force a physically confirmed initial travel direction. Following
      // turns and turn restrictions remain handled by normal graph routing.
      if(currentNode==start && item.state==start &&
         op.initialEdge && i!=*op.initialEdge) continue;
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
      // Preserve the incoming approach at the first junction when starting
      // from confirmed vehicle heading, even without an OSM turn restriction.
      // Otherwise the node-only A* state can propose an instant reversal.
      const bool firstDirectedArrival =
          op.profile == Profile::drive && op.initialEdge &&
          currentNode == start && item.state == start;
      if (op.profile == Profile::drive &&
          (g.restricted(e.target) || firstDirectedArrival)) {
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
      // Toll-price penalty affects ranking only, never ETA. When a road
      // has no published tariff, do not invent a non-zero euro amount.
      const auto edgeEstimate=op.tariffs && (flags & 4)
          ? op.tariffs->estimate(g.road(e.road).ref,e.distanceDm/10.,
                                 op.vehicleClass)
          : std::nullopt;
      double penalty =
          op.profile == Profile::drive && op.penaltyMinutesPerEuro > 0 &&
                  edgeEstimate
              ? std::round(*edgeEstimate * op.penaltyMinutesPerEuro * 6000)
              : 0;
      if (op.profile == Profile::drive &&
          op.sharedEdgePenaltySecondsPerKm > 0 &&
          op.discouragedEdges.count(i) != 0) {
        // Penalize overlap in A* search, not real driving time/ETA.
        // A physically legal alternative may share the first/last road.
        penalty += std::round(e.distanceDm / 10000. *
                              op.sharedEdgePenaltySecondsPerKm * 100.);
      }
      if (op.profile == Profile::drive && op.initialEdge && item.state >= n &&
          predecessors[item.state] == int64_t(start) && incomingFrom >= 0 &&
          !(g.roadFlags(uint32_t(incomingRoad)) & 1) && !(flags & 1)) {
        // Prefer a legal turn farther along the road over a 180-degree
        // reversal at the very next junction. Do not ban it entirely: an
        // actual dead-end still needs a last-resort turnaround route.
        const double approach = bearing(g.point(uint32_t(incomingFrom)),
                                        g.point(currentNode));
        const double departure = bearing(g.point(currentNode),g.point(e.target));
        if (std::abs(std::remainder(departure-approach,360.0)) >= 150.0)
          penalty += 24000.0; // 4 min, A* edge costs are centiseconds.
      }
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
std::optional<Route> routeFromPosition(const Graph &g, Point from, Point to,
                                       const RouteOptions &op,
                                       std::optional<double> travelHeading) {
  if (!valid(from) || !valid(to))
    throw std::invalid_argument("Invalid route coordinates");
  // The direction of a moving vehicle remains a HARD constraint; never
  // fall back to wrong-way routing merely to reach a difficult POI.
  auto options=op;
  std::optional<uint32_t> start;
  if(travelHeading && op.profile==Profile::drive) {
    if(!std::isfinite(*travelHeading)||*travelHeading<0)
      throw std::invalid_argument("Invalid driving heading");
    const auto directed=g.nearestDirected(from,op.profile,*travelHeading);
    if(!directed)return {};
    start=directed->node;
    options.initialEdge=directed->edge;
    options.initialSnap=directed->snapped;
  } else start=g.nearest(from,op.profile);
  if(!start)return {};
  const auto componentId=g.component(*start);
  const auto originalGoal=g.nearest(to,op.profile);
  // Preserve the exact same route as before for ordinary reachable POIs.
  // Only invoke access recovery after the original goal fails or belongs
  // to a disconnected road network (airport perimeter, car park, campus).
  if(originalGoal && g.component(*originalGoal)==componentId) {
    auto original=route(g,*start,*originalGoal,options);
    if(original) {
      original->destinationAccessMeters=distance(to,original->points.back());
      return original;
    }
  }
  const auto candidates=g.destinationCandidates(
      to,op.profile,componentId,5000,12);
  for(auto destination:candidates) {
    if(originalGoal && destination==*originalGoal)continue;
    if(options.cancelled&&options.cancelled())
      throw std::runtime_error("Route cancelled");
    auto answer=route(g,*start,destination,options);
    if(!answer)continue;
    answer->destinationAccessMeters=distance(to,answer->points.back());
    return answer;
  }
  return {};
}
std::vector<std::string> principalRoadRefs(const Route &r,
                                           std::size_t limit) {
  struct Frequency { std::size_t first; double meters; };
  std::map<std::string, Frequency> refs;
  for (std::size_t i = 0; i < r.legs.size(); ++i) {
    std::string chunk;
    const auto add = [&]() {
      std::string key;
      for (unsigned char c : chunk)
        if (!std::isspace(c)) key += char(std::toupper(c));
      chunk.clear();
      // Only genuine signed highway references, not arbitrary road names.
      const std::string prefixes[] = {"IC","IP","EN","A","N"};
      bool validRef = false;
      for (const auto &prefix : prefixes) {
        if (key.size() <= prefix.size() ||
            key.compare(0,prefix.size(),prefix) != 0) continue;
        const auto suffix = key.substr(prefix.size());
        validRef = std::isdigit(static_cast<unsigned char>(suffix.front())) &&
            std::isdigit(static_cast<unsigned char>(suffix.back())) &&
            std::all_of(suffix.begin(),suffix.end(),
                        [](unsigned char c) {
                          return std::isdigit(c) != 0 || c == '-';
                        });
        break;
      }
      if (!validRef) return;
      auto it = refs.find(key);
      if (it == refs.end()) refs.emplace(key,Frequency{i,r.legs[i].distance});
      else it->second.meters += r.legs[i].distance;
    };
    for (const char c : r.legs[i].road.ref) {
      if (c == ';' || c == ',' || c == '/') add();
      else chunk += c;
    }
    add();
  }
  if (!limit || refs.empty()) return {};
  const double cutoff = std::min(5000.,std::max(500.,r.meters*0.015));
  std::vector<std::pair<std::string,Frequency>> options(refs.begin(),refs.end());
  const auto substantial = std::count_if(options.begin(),options.end(),
      [&](const auto &v) {return v.second.meters >= cutoff;});
  if (substantial) options.erase(
      std::remove_if(options.begin(),options.end(),
        [&](const auto &v) {return v.second.meters < cutoff;}),
      options.end());
  std::sort(options.begin(),options.end(),[](const auto &a,const auto &b) {
    return a.second.meters > b.second.meters;
  });
  if (options.size() > limit) options.resize(limit);
  std::sort(options.begin(),options.end(),[](const auto &a,const auto &b) {
    return a.second.first < b.second.first;
  });
  std::vector<std::string> result;
  for (const auto &entry : options) result.push_back(entry.first);
  return result;
}
std::string routeJson(const Route &r) {
  const auto monetaryScale=std::pow(10.0,r.tollFractionDigits);
  const auto roundedMoney=[&](double amount,double referenceMeters){
    const double units=std::round(amount*monetaryScale);
    return (referenceMeters>0&&amount>0?std::max(1.,units):units)/monetaryScale;
  };
  std::ostringstream s;
  s.precision(12);
  s << "{\"destinationAccessMeters\":" << r.destinationAccessMeters
    << ",\"distanceMeters\":" << r.meters
    << ",\"durationSeconds\":" << r.seconds << ",\"tollEuros\":";
  if(r.tolledMeters>0 && !r.tollPriceComplete) s << "null";
  else s << roundedMoney(r.tollEuros,r.referenceTollMeters);
  // Currency-neutral result and itinerary order for future countries.
  // tollEuros remains for backward compatibility with older Android code.
  s << ",\"tollAmount\":";
  if(r.tolledMeters>0 && !r.tollPriceComplete) s << "null";
  else s << roundedMoney(r.tollEuros,r.referenceTollMeters);
  s << ",\"tollRoads\":[";
  for(std::size_t i=0;i<r.tollRoads.size();++i){
    if(i)s << ',';
    const auto &road=r.tollRoads[i];
    s << "{\"road\":" << jsonString(road.road)
      << ",\"meters\":" << road.meters
      << ",\"pricedMeters\":" << road.pricedMeters
      << ",\"referenceMeters\":" << road.referenceMeters
      << ",\"pricingConfidence\":" << jsonString(!road.complete?"unavailable":road.exact?"exact":road.referenceMeters>0?"low":"standard")
      << ",\"pricing\":" << jsonString(road.complete?(road.exact?"exact":"estimate"):"unavailable")
      << ",\"chargeId\":" << jsonString(road.chargeId)
      << ",\"name\":" << jsonString(road.name)
      << ",\"amount\":";
    if(road.complete)s << roundedMoney(road.amount,road.referenceMeters);
    else s << "null";
    s << '}';
  }
  s << ']';
  s << ",\"tollPricing\":" << jsonString(r.tolledMeters==0?"none":
          r.tollPriceComplete?(r.tollPriceExact?"exact":"estimate"):"unavailable")
    << ",\"tolledMeters\":" << r.tolledMeters
    << ",\"pricedTollMeters\":" << r.pricedTollMeters
    << ",\"referenceTollMeters\":" << r.referenceTollMeters
    << ",\"tollPricingConfidence\":" << jsonString(r.tolledMeters==0?"none":!r.tollPriceComplete?"unavailable":r.tollPriceExact?"exact":r.referenceTollMeters>0?"low":"standard")
    << ",\"tollEstimationMethod\":" << jsonString(r.tolledMeters==0?"none":!r.tollPriceComplete?"unavailable":r.referenceTollMeters>0?"road-or-country-reference":r.tollPriceExact?"verified":"section-road-average")
    << ",\"tollCountry\":" << jsonString(r.tollCountry)
    << ",\"tollCurrency\":" << jsonString(r.tollCurrency)
    << ",\"tollTariffYear\":" << jsonString(r.tollYear)
    << ",\"tollTariffSource\":" << jsonString(r.tollSource)
    << ",\"tollTariffVersion\":" << jsonString(r.tollVersion)
    << ",\"tollFractionDigits\":" << r.tollFractionDigits
    << ",\"tollVehicleClass\":" << r.tollVehicleClass
    << ",\"tollVehicleClasses\":[";
  for(std::size_t i=0;i<r.tollVehicleClasses.size();++i){if(i)s<<',';s<<r.tollVehicleClasses[i];}
  s << ']'
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
      << ",\"point\":" << m.point
      << ",\"turnLanes\":" << jsonString(m.turnLanes)
      << ",\"exitNumber\":" << m.exitNumber << '}';
  }
  // Display-only anchors: preserve the exact roundabout entry/exit junction.
  // This metadata never changes geometry, lengths, maneuvers or matching.
  s << "],\"visualProtectedPoints\":[";
  bool protectedPointWritten = false;
  for (std::size_t i = 1; i < r.legs.size(); ++i) {
    if (bool(r.legs[i-1].road.flags & 1) == bool(r.legs[i].road.flags & 1)) continue;
    if (protectedPointWritten) s << ',';
    s << r.legs[i].first;
    protectedPointWritten = true;
  }
  s << "],\"mainRoads\":[";
  const auto roadRefs = principalRoadRefs(r);
  for (std::size_t i=0;i<roadRefs.size();++i) {
    if (i) s << ',';
    s << jsonString(roadRefs[i]);
  }
  const bool hasTolls = std::any_of(r.legs.begin(),r.legs.end(),
      [](const Leg &leg) {return (leg.road.flags & 4) != 0;});
  s << "],\"hasTolls\":" << (hasTolls?"true":"false")
    << ",\"edgeIndexes\":[";
  for (std::size_t i = 0; i < r.edges.size(); ++i) {
    if (i)
      s << ',';
    s << r.edges[i];
  }
  s << "]}";
  return s.str();
}
} // namespace atlas

