#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace atlas {
// Price-free, directed, graph-bound evidence. Geometry and tariffs have separate lifetimes.
class Graph;
struct Route;
class TollTariffs;
using TollGraphDigests=std::map<std::string,std::string>;
struct TollChargeBinding {
  uint32_t edge=0,from=0,to=0;
  double offsetMeters=0;
  std::string chargeId;
  double edgeLengthMeters=0;
};
struct TollEdgeTraversal {
  uint32_t edge=0,from=0,to=0;
  double beginMeters=0,endMeters=0;
  std::string road;
  bool tolled=false;
};
struct TollCrossingSequence {
  std::vector<std::string> chargeIds;
  bool complete=false;
};
/** Only reviewed, complete mappings can certify crossings. The caller supplies
 * SHA-256 values computed from the loaded graph, not a region name/version.
 * This component does not infer a plaza from a road name, distance or GPS. */
class TollCrossingMatcher {
public:
  TollCrossingMatcher(TollGraphDigests boundGraph,std::string country,
      std::unordered_set<uint32_t> coveredEdges,std::vector<TollChargeBinding> bindings,
      bool reviewed);
  static TollCrossingMatcher parse(std::string_view csv);
  void validateGraph(const Graph &graph) const;
  std::optional<TollCrossingSequence> match(const TollGraphDigests &loadedGraph,
      const std::string &country,const std::vector<TollEdgeTraversal> &traversals) const;
private:
  TollGraphDigests graph_;
  std::string country_;
  std::unordered_set<uint32_t> coveredEdges_;
  std::unordered_map<uint32_t,std::vector<TollChargeBinding>> bindings_;
  bool reviewed_=false;
};
bool applyFixedTollCharges(const Graph &graph,Route &route,const TollTariffs &prices,
    const TollCrossingMatcher &matcher,const TollGraphDigests &actualGraph);
} // namespace atlas
