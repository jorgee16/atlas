#include "atlas/toll_crossings.hpp"
#include "atlas/core.hpp"
#include <sstream>
#include <limits>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <cctype>

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
    std::unordered_set<uint32_t> edges,std::vector<TollChargeBinding> bindings,bool reviewed,std::vector<TollNetworkBinding> networks)
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
  for(auto &v:networks){
    if(!coveredEdges_.count(v.edge)||v.from==v.to||!std::isfinite(v.beginMeters)||!std::isfinite(v.endMeters)||
        v.beginMeters<0||v.endMeters<=v.beginMeters||v.network.empty()||v.network.size()>128||
        !std::all_of(v.network.begin(),v.network.end(),[](unsigned char c){return std::isalnum(c)||c=='-'||c=='_';}))throw std::invalid_argument("Invalid ticket-network coverage");
    auto &same=networks_[v.edge];for(const auto &old:same)if(std::max(old.beginMeters,v.beginMeters)<std::min(old.endMeters,v.endMeters))throw std::invalid_argument("Overlapping ticket-network evidence");
    same.push_back(std::move(v));
  }
}
std::optional<TollCrossingSequence> TollCrossingMatcher::match(const TollGraphDigests &loaded,
    const std::string &country,const std::vector<TollEdgeTraversal> &traversals,std::string *reason) const {
  const auto reject=[&](const char *why)->std::optional<TollCrossingSequence>{if(reason)*reason=why;return std::nullopt;};
  if(reason)reason->clear();
  if(!reviewed_)return reject("unreviewed_mapping");
  if(loaded!=graph_)return reject("graph_hash");
  if(country!=country_)return reject("country");
  TollCrossingSequence result;result.complete=true;
  std::optional<uint32_t> previous;
  std::optional<std::string> openNetwork;
  for(const auto &leg:traversals) {
    if(previous && *previous!=leg.from)return reject("direction");
    previous=leg.to;
    if(!std::isfinite(leg.beginMeters)||!std::isfinite(leg.endMeters)||leg.beginMeters<0||leg.endMeters<leg.beginMeters||leg.from==leg.to)return reject("interval");
    if(!coveredEdges_.count(leg.edge)){result.complete=false;result.unreviewedEdges.push_back(leg.edge);}
    const auto network=networks_.find(leg.edge);
    if(network!=networks_.end())for(const auto &v:network->second){
      if(v.from!=leg.from||v.to!=leg.to)return reject("direction");
      if(std::max(v.beginMeters,leg.beginMeters)<std::min(v.endMeters,leg.endMeters))result.networks.insert(v.network);
    }
    const auto it=bindings_.find(leg.edge);
    std::vector<std::pair<double,std::string>> ticketEvents;
    if(it!=bindings_.end())for(const auto &binding:it->second) {
      if(binding.from!=leg.from||binding.to!=leg.to)return reject("direction");
      if(leg.endMeters>binding.edgeLengthMeters)return reject("interval");
      // Traversal intervals are [begin,end). A fix after the gate cannot charge
      // it again; a real later repeat of this directed edge remains chargeable.
      if(binding.offsetMeters>=leg.beginMeters&&binding.offsetMeters<leg.endMeters)
        {result.chargeIds.push_back(binding.chargeId);
         if(binding.chargeId.rfind("entry:",0)==0||binding.chargeId.rfind("exit:",0)==0)
           ticketEvents.emplace_back(binding.offsetMeters,binding.chargeId);}

    }
    // Sweep the actual clipped path. A previous valid journey on this same
    // network must not certify a later unobserved entry or post-exit segment.
    std::vector<double> boundaries={leg.beginMeters,leg.endMeters};
    for(const auto &v:ticketEvents)boundaries.push_back(v.first);
    if(network!=networks_.end())for(const auto &v:network->second){
      boundaries.push_back(std::clamp(v.beginMeters,leg.beginMeters,leg.endMeters));
      boundaries.push_back(std::clamp(v.endMeters,leg.beginMeters,leg.endMeters));}
    std::sort(boundaries.begin(),boundaries.end());
    boundaries.erase(std::unique(boundaries.begin(),boundaries.end()),boundaries.end());
    for(size_t i=0;i<boundaries.size();++i){
      const double at=boundaries[i];
      for(const auto &event:ticketEvents)if(event.first==at){
        const auto &id=event.second;auto a=id.find(':'),b=id.find(':',a+1);
        if(b==std::string::npos){result.ticketCoverageComplete=false;continue;}
        const auto name=id.substr(a+1,b-a-1);
        if(id.rfind("entry:",0)==0){if(openNetwork)result.ticketCoverageComplete=false;openNetwork=name;}
        else {if(!openNetwork||*openNetwork!=name)result.ticketCoverageComplete=false;openNetwork.reset();}
      }
      if(i+1==boundaries.size()||network==networks_.end())continue;
      const double middle=at+(boundaries[i+1]-at)/2;
      for(const auto &v:network->second)if(v.beginMeters<=middle&&middle<v.endMeters&&
          (!openNetwork||*openNetwork!=v.network))result.ticketCoverageComplete=false;
    }
  }
  if(reason&&!result.complete)*reason="unreviewed_edge";
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
bool TollCrossingMatcher::allowsAvoidance(uint32_t edge,uint32_t from,double begin,double end,
    bool graphToll,const TollTariffs *fixed,int vehicleClass) const {
  if(!std::isfinite(begin)||!std::isfinite(end)||begin<0||end<begin)return false;
  if(begin==end)return true;
  if(!coveredEdges_.count(edge))return !graphToll;
  const auto net=networks_.find(edge);
  if(net!=networks_.end())for(const auto &v:net->second)
    if(v.from!=from||std::max(v.beginMeters,begin)<std::min(v.endMeters,end))return false;
  const auto group=bindings_.find(edge);
  if(group==bindings_.end())return true;
  for(const auto &b:group->second){
    if(b.from!=from||begin<0||end> b.edgeLengthMeters||end<begin)return false;
    if(b.offsetMeters<begin||b.offsetMeters>=end)continue;
    if(b.chargeId.rfind("entry:",0)==0||b.chargeId.rfind("exit:",0)==0)return false;
    const auto value=fixed?fixed->fixedCharge(b.chargeId,vehicleClass):std::nullopt;
    if(!value||*value>0)return false;
  }
  return true;
}
TollCrossingMatcher TollCrossingMatcher::parse(std::string_view csv) {
  if(csv.empty()||csv.size()>2*1024*1024)throw std::invalid_argument("Invalid crossing index size");
  std::istringstream input{std::string(csv)};std::string line;std::map<std::string,std::string> metadata;
  std::unordered_set<uint32_t> coverage;std::vector<TollChargeBinding> bindings;bool header=false;
  std::vector<TollNetworkBinding> networks;
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
    } else if(c[0]=="network") {
      networks.push_back({indexNumber(c[1]),indexNumber(c[2]),indexNumber(c[3]),metersNumber(c[4]),metersNumber(c[5]),c[6]});
    } else throw std::invalid_argument("Unknown crossing evidence row");
    if(coverage.size()+bindings.size()>100000)throw std::invalid_argument("Crossing index too large");
  }
  TollGraphDigests graph;
  for(const auto &m:metadata)if(m.first.rfind("graph.",0)==0)graph[m.first.substr(6)]=m.second;
  if(!header||(metadata["reviewed"]!="true"&&metadata["reviewed"]!="false"))throw std::invalid_argument("Missing crossing review declaration");
  return TollCrossingMatcher(std::move(graph),metadata["country"],std::move(coverage),std::move(bindings),metadata["reviewed"]=="true",std::move(networks));
}
void TollCrossingMatcher::validateGraph(const Graph &graph) const {
  for(const auto edge:coveredEdges_)if(edge>=graph.edgeCount())throw std::invalid_argument("Certified edge is absent from loaded graph");
  for(const auto &group:bindings_)for(const auto &binding:group.second) {
    if(binding.from>=graph.nodeCount()||binding.to>=graph.nodeCount()||binding.edge<graph.offset(binding.from)||binding.edge>=graph.offset(binding.from+1))throw std::invalid_argument("Crossing from-node does not match loaded graph");
    const auto edge=graph.edge(binding.edge);
    if(edge.target!=binding.to||!edge.allows(Profile::drive)||std::abs(edge.distanceDm/10.-binding.edgeLengthMeters)>0.0001)throw std::invalid_argument("Crossing direction/length does not match loaded graph");
  }
  for(const auto &group:networks_)for(const auto &v:group.second){
    if(v.from>=graph.nodeCount()||v.to>=graph.nodeCount()||v.edge<graph.offset(v.from)||v.edge>=graph.offset(v.from+1))throw std::invalid_argument("Invalid network source node");
    const auto edge=graph.edge(v.edge);
    if(edge.target!=v.to||!edge.allows(Profile::drive)||v.endMeters>edge.distanceDm/10.+.000001)throw std::invalid_argument("Network direction/interval differs from loaded graph");
  }
}
bool applyFixedTollCharges(const Graph &graph,Route &route,const TollTariffs &prices,
    const TollCrossingMatcher &matcher,const TollGraphDigests &actualGraph) {
  return applyTollCharges(graph,route,&prices,nullptr,matcher,actualGraph);
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
  return applyTollCharges(graph,route,nullptr,&prices,matcher,actualGraph);
}
bool applyTollCharges(const Graph &graph,Route &route,const TollTariffs *fixed,
    const TollTariffs *fares,const TollCrossingMatcher &matcher,const TollGraphDigests &actualGraph) {
  if(!fixed&&!fares)return false;
  const auto *identity=fixed?fixed:fares;
  const bool wasExact=route.tollPriceExact;
  route.tollCoverageVerified=false;route.tollCrossingsVerified=false;
  route.tollNetworkTraversal=false;route.tollFlagsDisproved=false;route.tollUnreviewedEdges=0;route.firstUnreviewedTollEdge=-1;
  const auto fail=[&](std::string reason){
    route.tollPricingReason=reason;route.tollPriceComplete=false;route.tollPriceExact=false;
    route.tollRoads.clear();route.pricedTollMeters=0;route.referenceTollMeters=0;
    return false;
  };
  if(identity->country!=route.tollCountry)return fail("country");
  if((fixed&&fixed->scheme!="fixed-crossing")||(fares&&fares->scheme!="entry-exit"))return fail("scheme");
  if(fixed&&fares&&(fixed->country!=fares->country||fixed->currency!=fares->currency||
      fixed->fractionDigits!=fares->fractionDigits||fixed->year!=fares->year))return fail("catalog_identity");
  std::vector<TollEdgeTraversal> traversal;
  for(const auto &leg:route.legs){const auto full=graph.edge(leg.edge).distanceDm/10.;
    traversal.push_back({leg.edge,leg.from,leg.to,std::clamp(full-leg.distance,0.,full),full,leg.road.ref,(leg.road.flags&4)!=0});}
  const auto proof=matcher.match(actualGraph,route.tollCountry,traversal,&route.tollPricingReason);
  if(!proof)return fail(route.tollPricingReason.c_str());
  route.tollCoverageVerified=proof->complete;
  route.tollCrossingsVerified=!proof->chargeIds.empty();route.tollNetworkTraversal=!proof->networks.empty();
  route.tollUnreviewedEdges=uint32_t(proof->unreviewedEdges.size());
  route.firstUnreviewedTollEdge=proof->unreviewedEdges.empty()?-1:int64_t(proof->unreviewedEdges.front());
  if(!proof->complete){
    bool flagged=false,allFlaggedFree=true;
    for(const auto &leg:traversal)if(leg.tolled){
      flagged=true;auto local=matcher.match(actualGraph,route.tollCountry,{leg});
      allFlaggedFree=allFlaggedFree&&local&&local->complete&&local->chargeIds.empty()&&local->networks.empty();
    }
    // A reviewed free interval can disprove a stale paid flag without
    // certifying the unreviewed rest of the trip as free or zero-priced.
    route.tollFlagsDisproved=flagged&&allFlaggedFree;
    if(route.tollFlagsDisproved&&!route.tollCrossingsVerified&&!route.tollNetworkTraversal){
      route.tollPriceComplete=false;route.tollPriceExact=false;return false;
    }
    if(wasExact)return fail("unreviewed_edge");
    if(route.tolledMeters<=0&&(route.tollCrossingsVerified||route.tollNetworkTraversal)){
      route.tollPriceComplete=false;route.tollPriceExact=false;
    }
    return false;
  }
  std::vector<std::string> tickets,fixedIds;
  for(const auto &id:proof->chargeIds)
    (id.rfind("entry:",0)==0||id.rfind("exit:",0)==0?tickets:fixedIds).push_back(id);
  const bool needsTickets=!tickets.empty()||route.tollNetworkTraversal;
  if(needsTickets&&!fares)return fail("missing_fare_provider");
  if(!fixedIds.empty()&&!fixed)return fail("missing_fare_provider");
  const auto hasClass=[&](const TollTariffs *p){return p&&std::find(p->classes.begin(),p->classes.end(),route.tollVehicleClass)!=p->classes.end();};
  if((!fixedIds.empty()&&!hasClass(fixed))||(needsTickets&&!hasClass(fares)))return fail("class");
  std::vector<TollJourney> journeys;
  if(needsTickets){if(!proof->ticketCoverageComplete)return fail("missing_mapping");auto parsed=entryExitJourneys(tickets);if(!parsed)return fail("missing_mapping");journeys=*parsed;
    std::unordered_set<std::string> observed;for(const auto &j:journeys)observed.insert(j.network);
    for(const auto &n:proof->networks)if(!observed.count(n))return fail("missing_mapping");
  }
  const auto scale=std::pow(10.,identity->fractionDigits);int64_t units=0;
  std::vector<TollRoadCharge> breakdown;
  for(const auto &id:fixedIds){
    auto value=fixed->fixedCharge(id,route.tollVehicleClass);auto info=fixed->fixedChargeInfo(id);
    if(!value||!info)return fail("missing_fare");
    units+=std::llround(*value*scale);
    TollRoadCharge charge;charge.road=info->road;charge.name=info->name;charge.chargeId=id;charge.amount=*value;charge.exact=true;
    breakdown.push_back(std::move(charge));
  }
  for(const auto &j:journeys){auto value=fares->entryExitFare(j,route.tollVehicleClass);if(!value)return fail("missing_fare");
    units+=std::llround(*value*scale);
    TollRoadCharge charge;charge.road=j.network;charge.name=j.entry+" → "+j.exit;
    charge.chargeId=j.network+":"+j.entry+":"+j.exit;charge.amount=*value;charge.exact=true;breakdown.push_back(std::move(charge));
  }
  // Preserve the legacy none state for a fully reviewed genuinely free path.
  if(proof->chargeIds.empty()&&!needsTickets&&route.tolledMeters<=0){route.tollPricingReason.clear();return false;}
  route.tollEuros=double(units)/scale;route.tollPriceExact=true;route.tollPriceComplete=true;
  route.tollPricingReason.clear();route.pricedTollMeters=route.tolledMeters;route.referenceTollMeters=0;
  const auto *usedIdentity=needsTickets&&fixedIds.empty()?fares:fixed?fixed:fares;
  route.tollRoads=std::move(breakdown);route.tollCountry=usedIdentity->country;route.tollCurrency=usedIdentity->currency;
  route.tollYear=usedIdentity->year;route.tollFractionDigits=usedIdentity->fractionDigits;
  route.tollVehicleClasses=usedIdentity->classes;route.tollSource=usedIdentity->source;route.tollVersion=usedIdentity->version;
  if(fixed&&fares&&!fixedIds.empty()&&needsTickets){route.tollSource=fixed->source+"\n"+fares->source;
    route.tollVersion=fixed->version+"+"+fares->version;}
  return true;
}
} // namespace atlas
