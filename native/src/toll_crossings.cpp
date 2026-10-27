#include "atlas/toll_crossings.hpp"
#include "atlas/core.hpp"
#include <sstream>
#include <limits>
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
    if(!coveredEdges_.count(leg.edge))result.complete=false;
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

namespace {
std::string trimmed(std::string s) {
  auto a=s.find_first_not_of(" \t\r");return a==std::string::npos?std::string():s.substr(a,s.find_last_not_of(" \t\r")-a+1);
}
std::vector<std::string> cells(const std::string &s) {
  std::vector<std::string> out;std::size_t a=0;
  for(std::size_t i=0;i<=s.size();++i)if(i==s.size()||s[i]==';'){out.push_back(trimmed(s.substr(a,i-a)));a=i+1;}
  return out;
}
uint32_t indexNumber(const std::string &s) {
  if(s.empty()||!std::all_of(s.begin(),s.end(),[](unsigned char c){return c>='0'&&c<='9';}))throw std::invalid_argument("Invalid graph index");
  const auto n=std::stoull(s);if(n>std::numeric_limits<uint32_t>::max())throw std::invalid_argument("Graph index overflow");return uint32_t(n);
}
double metersNumber(const std::string &s) {
  std::size_t used=0;const auto n=std::stod(s,&used);
  if(used!=s.size()||!std::isfinite(n)||n<0||n>1e9)throw std::invalid_argument("Invalid crossing distance");
  return n;
}
}
TollCrossingMatcher TollCrossingMatcher::parse(std::string_view csv) {
  if(csv.empty()||csv.size()>2*1024*1024)throw std::invalid_argument("Invalid crossing index size");
  std::istringstream input{std::string(csv)};std::string line;std::map<std::string,std::string> metadata;
  std::unordered_set<uint32_t> coverage;std::vector<TollChargeBinding> bindings;bool header=false;
  while(std::getline(input,line)) {
    line=trimmed(line);if(line.empty())continue;
    if(line[0]=='#') {
      const auto at=line.find('=');if(at==std::string::npos)continue;
      if(!metadata.emplace(trimmed(line.substr(1,at-1)),trimmed(line.substr(at+1))).second)throw std::invalid_argument("Duplicate crossing metadata");
      continue;
    }
    if(!header) {
      if(line!="kind;edge;from;to;offsetMeters;edgeLengthMeters;chargeId")throw std::invalid_argument("Invalid crossing index columns");
      header=true;continue;
    }
    auto c=cells(line);if(c.size()!=7)throw std::invalid_argument("Invalid crossing index row");
    if(c[0]=="coverage") {
      if(!coverage.insert(indexNumber(c[1])).second||std::any_of(c.begin()+2,c.end(),[](const auto &x){return !x.empty();}))throw std::invalid_argument("Invalid/duplicate certified edge");
    } else if(c[0]=="crossing") {
      bindings.push_back({indexNumber(c[1]),indexNumber(c[2]),indexNumber(c[3]),metersNumber(c[4]),c[6],metersNumber(c[5])});
    } else throw std::invalid_argument("Unknown crossing evidence row");
    if(coverage.size()+bindings.size()>100000)throw std::invalid_argument("Crossing index too large");
  }
  TollGraphDigests graph;
  for(const auto &m:metadata)if(m.first.rfind("graph.",0)==0)graph[m.first.substr(6)]=m.second;
  if(!header||(metadata["reviewed"]!="true"&&metadata["reviewed"]!="false"))throw std::invalid_argument("Missing crossing review declaration");
  return TollCrossingMatcher(std::move(graph),metadata["country"],std::move(coverage),std::move(bindings),metadata["reviewed"]=="true");
}
void TollCrossingMatcher::validateGraph(const Graph &graph) const {
  for(const auto edge:coveredEdges_)if(edge>=graph.edgeCount())throw std::invalid_argument("Certified edge is absent from loaded graph");
  for(const auto &group:bindings_)for(const auto &binding:group.second) {
    if(binding.from>=graph.nodeCount()||binding.to>=graph.nodeCount()||binding.edge<graph.offset(binding.from)||binding.edge>=graph.offset(binding.from+1))throw std::invalid_argument("Crossing from-node does not match loaded graph");
    const auto edge=graph.edge(binding.edge);
    if(edge.target!=binding.to||!edge.allows(Profile::drive)||std::abs(edge.distanceDm/10.-binding.edgeLengthMeters)>0.0001)throw std::invalid_argument("Crossing direction/length does not match loaded graph");
  }
}
bool applyFixedTollCharges(const Graph &graph,Route &route,const TollTariffs &prices,
    const TollCrossingMatcher &matcher,const TollGraphDigests &actualGraph) {
  if(prices.scheme!="fixed-crossing"||route.tolledMeters<=0||route.tollCountry!=prices.country)return false;
  std::vector<TollEdgeTraversal> traversal;
  traversal.reserve(route.legs.size());
  for(const auto &leg:route.legs) {
    const auto full=graph.edge(leg.edge).distanceDm/10.;
    traversal.push_back({leg.edge,leg.from,leg.to,std::clamp(full-leg.distance,0.,full),full,leg.road.ref,(leg.road.flags&4)!=0});
  }
  const auto proof=matcher.match(actualGraph,prices.country,traversal);
  if(!proof||!proof->complete)return false;
  const auto total=prices.sumFixedCharges(proof->chargeIds,route.tollVehicleClass);
  if(!total)return false;
  std::vector<TollRoadCharge> charges;
  for(const auto &id:proof->chargeIds) {
    const auto info=prices.fixedChargeInfo(id);const auto amount=prices.fixedCharge(id,route.tollVehicleClass);
    if(!info||!amount)return false;
    TollRoadCharge charge;charge.road=info->road;charge.name=info->name;charge.chargeId=id;charge.amount=*amount;charge.exact=true;charges.push_back(std::move(charge));
  }
  if(charges.empty()) {
    TollRoadCharge free;free.road=std::find_if(route.legs.begin(),route.legs.end(),[](const auto&l){return(l.road.flags&4)!=0;})->road.ref;
    free.name="No charged plaza on this traversal";free.exact=true;charges.push_back(std::move(free));
  }
  // Only monetary metadata changes. Authoritative path, progress, geometry,
  // maneuver positions, distance and ETA remain untouched.
  route.tollEuros=*total;route.tollPriceExact=true;route.tollPriceComplete=true;
  route.pricedTollMeters=route.tolledMeters;route.tollRoads=std::move(charges);
  route.tollCountry=prices.country;route.tollCurrency=prices.currency;route.tollYear=prices.year;
  route.tollSource=prices.source;route.tollVersion=prices.version;route.tollFractionDigits=prices.fractionDigits;route.tollVehicleClasses=prices.classes;
  return true;
}
std::optional<std::vector<TollJourney>> entryExitJourneys(const std::vector<std::string> &events) {
  if(events.empty())return std::nullopt;
  std::vector<TollJourney> result;
  std::optional<TollJourney> open;
  for(const auto &event:events) {
    const auto a=event.find(':'),b=event.find(':',a==std::string::npos?0:a+1);
    if(a==std::string::npos||b==std::string::npos||event.find(':',b+1)!=std::string::npos)return std::nullopt;
    const auto kind=event.substr(0,a),network=event.substr(a+1,b-a-1),station=event.substr(b+1);
    const auto valid=[](const std::string &s){return !s.empty()&&s.size()<=128&&std::all_of(s.begin(),s.end(),[](unsigned char c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_';});};
    if(!valid(network)||!valid(station))return std::nullopt;
    if(kind=="entry") {
      if(open)return std::nullopt;
      open=TollJourney{network,station,{}};
    } else if(kind=="exit") {
      if(!open||open->network!=network)return std::nullopt;
      open->exit=station;result.push_back(*open);open.reset();
    } else return std::nullopt;
  }
  return open?std::nullopt:std::optional<std::vector<TollJourney>>(std::move(result));
}
bool applyEntryExitTollCharges(const Graph &graph,Route &route,const TollTariffs &prices,
    const TollCrossingMatcher &matcher,const TollGraphDigests &actualGraph) {
  if(prices.scheme!="entry-exit"||route.tolledMeters<=0||route.tollCountry!=prices.country)return false;
  std::vector<TollEdgeTraversal> traversal;
  for(const auto &leg:route.legs) {
    const auto full=graph.edge(leg.edge).distanceDm/10.;
    traversal.push_back({leg.edge,leg.from,leg.to,std::clamp(full-leg.distance,0.,full),full,leg.road.ref,(leg.road.flags&4)!=0});
  }
  const auto proof=matcher.match(actualGraph,prices.country,traversal);
  if(!proof||!proof->complete)return false;
  const auto journeys=entryExitJourneys(proof->chargeIds);if(!journeys)return false;
  const auto total=prices.sumEntryExitFares(*journeys,route.tollVehicleClass);if(!total)return false;
  std::vector<TollRoadCharge> charges;
  for(const auto &journey:*journeys) {
    const auto amount=prices.entryExitFare(journey,route.tollVehicleClass);if(!amount)return false;
    TollRoadCharge charge;charge.road=journey.network;charge.name=journey.entry+" → "+journey.exit;
    charge.chargeId=journey.network+":"+journey.entry+":"+journey.exit;
    charge.amount=*amount;charge.exact=true;charges.push_back(std::move(charge));
  }
  // Reject incomplete evidence before touching any route metadata.
  route.tollEuros=*total;route.tollPriceExact=true;route.tollPriceComplete=true;
  route.pricedTollMeters=route.tolledMeters;route.tollRoads=std::move(charges);
  route.tollCountry=prices.country;route.tollCurrency=prices.currency;route.tollYear=prices.year;
  route.tollSource=prices.source;route.tollVersion=prices.version;route.tollFractionDigits=prices.fractionDigits;route.tollVehicleClasses=prices.classes;
  return true;
}
} // namespace atlas
