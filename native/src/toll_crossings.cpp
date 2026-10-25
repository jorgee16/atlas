#include "atlas/toll_crossings.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace atlas {
namespace {
bool validDigests(const TollGraphDigests &digests) {
  static const std::vector<std::string> files={"nodes.bin","edges.bin","geometry.bin","roads.bin","strings.bin","restrictions.bin","spatial-index.bin"};
  if(digests.size()!=files.size())return false;
  for(const auto &file:files) {
    const auto it=digests.find(file);
    if(it==digests.end()||it->second.size()!=64||!std::all_of(it->second.begin(),it->second.end(),[](unsigned char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');}))return false;
  }
  return true;
}
}
TollCrossingMatcher::TollCrossingMatcher(TollGraphDigests graph,std::string country,
    std::unordered_set<uint32_t> edges,std::vector<TollChargeBinding> bindings,bool reviewed)
    :graph_(std::move(graph)),country_(std::move(country)),coveredEdges_(std::move(edges)),reviewed_(reviewed) {
  if(!validDigests(graph_)||country_.empty()||coveredEdges_.empty()||bindings.empty())throw std::invalid_argument("Missing graph/country/coverage evidence");
  for(auto &binding:bindings) {
    if(binding.from==binding.to||!std::isfinite(binding.offsetMeters)||binding.offsetMeters<0||binding.chargeId.empty()||!std::isfinite(binding.edgeLengthMeters)||binding.edgeLengthMeters<=0||binding.offsetMeters>=binding.edgeLengthMeters||!coveredEdges_.count(binding.edge))throw std::invalid_argument("Invalid directed crossing binding");
    auto &same=bindings_[binding.edge];
    for(const auto &other:same) {
      if(other.from!=binding.from||other.to!=binding.to||other.edgeLengthMeters!=binding.edgeLengthMeters||other.chargeId==binding.chargeId||std::abs(other.offsetMeters-binding.offsetMeters)<0.01)
        throw std::invalid_argument("Ambiguous/duplicate crossing binding");
    }
    same.push_back(std::move(binding));
  }
  for(auto &edge:bindings_)std::sort(edge.second.begin(),edge.second.end(),[](const auto&a,const auto&b){return a.offsetMeters<b.offsetMeters;});
}
std::optional<TollCrossingSequence> TollCrossingMatcher::match(const TollGraphDigests &loaded,
    const std::string &country,const std::vector<TollEdgeTraversal> &traversals) const {
  if(!reviewed_||loaded!=graph_||country!=country_)return std::nullopt;
  TollCrossingSequence result;result.complete=true;
  std::optional<uint32_t> previous;
  for(const auto &leg:traversals) {
    if(previous && *previous!=leg.from)return std::nullopt;
    previous=leg.to;
    if(!std::isfinite(leg.beginMeters)||!std::isfinite(leg.endMeters)||leg.beginMeters<0||leg.endMeters<leg.beginMeters||leg.from==leg.to)return std::nullopt;
    if(leg.tolled&&!coveredEdges_.count(leg.edge))result.complete=false;
    const auto it=bindings_.find(leg.edge);if(it==bindings_.end())continue;
    for(const auto &binding:it->second) {
      if(binding.from!=leg.from||binding.to!=leg.to||leg.endMeters>binding.edgeLengthMeters)return std::nullopt;
      // Traversal intervals are [begin,end). A fix after the gate cannot charge
      // it again; a real later repeat of this directed edge remains chargeable.
      if(binding.offsetMeters>=leg.beginMeters&&binding.offsetMeters<leg.endMeters)
        result.chargeIds.push_back(binding.chargeId);
    }
  }
  return result;
}
} // namespace atlas
