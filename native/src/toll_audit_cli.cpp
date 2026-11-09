// Issue #2 public-coordinate routing diagnostics. All weighted search candidates
// are retained; they are NOT all claimed to be visible Android alternatives.
#include "atlas/core.hpp"
#include "atlas/toll_crossings.hpp"
#include <fstream>
#include <iostream>
#include <sstream>
#include <set>
using namespace atlas;
std::string read(const std::string&p){std::ifstream f(p);if(!f)throw std::runtime_error(p);std::ostringstream s;s<<f.rdbuf();return s.str();}
int main(int argc,char**argv){try{
 if(argc!=4)throw std::runtime_error("graph assets actual-digests required");
 std::cout.precision(12);Graph g(argv[1]);std::string a=argv[2];auto prices=TollTariffs::parse(read(a+"/tolls/Portugal.csv"),"Portugal");
 auto fixed=TollTariffs::parse(read(a+"/toll-charges/Portugal.csv"),"Portugal");auto fares=TollTariffs::parse(read(a+"/toll-fares/Portugal.csv"),"Portugal");
 auto matcher=TollCrossingMatcher::parse(read(a+"/toll-bindings/Portugal/mainland.csv"));matcher.validateGraph(g);
 TollGraphDigests hashes;std::istringstream in(read(argv[3]));std::string l;
 while(std::getline(in,l)){auto i=l.find(';');hashes[l.substr(0,i)]=l.substr(i+1);}
 auto audit=[&](const std::string&id,Route r){
  calibrateDriveEta(r,g);auto before=routeJson(r);std::vector<TollEdgeTraversal> legs;
  for(auto &v:r.legs){auto full=g.edge(v.edge).distanceDm/10.;legs.push_back({v.edge,v.from,v.to,std::max(0.,full-v.distance),full,v.road.ref,(v.road.flags&4)!=0});}
  std::string reason;auto proof=matcher.match(hashes,"Portugal",legs,&reason);
  bool fp=applyTollCharges(g,r,&fixed,&fares,matcher,hashes);
  std::cout<<"{\"id\":"<<jsonString(id)<<",\"before\":"<<before<<",\"after\":"<<routeJson(r)<<",\"rejectionReason\":"<<jsonString(reason)<<",\"androidPrefilterWouldReject\":"<<(!proof||!proof->complete?"true":"false")<<",\"pricingApplied\":"<<(fp?"true":"false")<<",\"complete\":"<<(proof&&proof->complete?"true":"false")<<",\"events\":[";
  if(proof)for(size_t i=0;i<proof->chargeIds.size();++i){if(i)std::cout<<',';std::cout<<jsonString(proof->chargeIds[i]);}
  std::cout<<"],\"legs\":[";
  for(size_t i=0;i<legs.size();++i){auto &v=legs[i];auto p=matcher.match(hashes,"Portugal",{v});auto point=g.point(v.from);if(i)std::cout<<',';
   std::cout<<"{\"edge\":"<<v.edge<<",\"from\":"<<v.from<<",\"to\":"<<v.to<<",\"lat\":"<<point.lat<<",\"lon\":"<<point.lon<<",\"road\":"<<jsonString(v.road)<<",\"meters\":"<<r.legs[i].distance<<",\"begin\":"<<v.beginMeters<<",\"end\":"<<v.endMeters<<",\"graphToll\":"<<(v.tolled?"true":"false")<<",\"covered\":"<<(p&&p->complete?"true":"false")<<",\"events\":[";
   if(p)for(size_t j=0;j<p->chargeIds.size();++j){if(j)std::cout<<',';std::cout<<jsonString(p->chargeIds[j]);}std::cout<<"]}";
  }
  std::cout<<"]}\n"<<std::flush;
 };
 for(auto start:std::vector<std::pair<std::string,Point>>{{"public-south",{38.7195949,-9.4135005}},{"public-north",{38.725065,-9.414258}},{"manique-access",{38.7165,-9.415}},{"cascais-centre",{38.6996,-9.4204}},{"oeiras-access",{38.697,-9.311}},{"carcavelos-access",{38.687,-9.339}},{"barcarena-access",{38.737,-9.28}},{"belas-access",{38.776,-9.257}}}){
  RouteOptions op;op.tariffs=&prices;op.tariffCountry="Portugal";auto r=routeFromPosition(g,start.second,{38.81741,-9.14814},op,{});if(!r)continue;
  audit(start.first+"/recommended",*r);
  for(auto weight:{110.,300.,550.}){auto alt=op;alt.discouragedEdges.insert(r->edges.begin(),r->edges.end());alt.sharedEdgePenaltySecondsPerKm=weight;auto t=routeFromPosition(g,start.second,{38.81741,-9.14814},alt,{});if(t)audit(start.first+"/candidate-"+std::to_string(int(weight)),*t);}
  op.avoidTolls=true;op.tollTraversalAllowed=[&](uint32_t edge,uint32_t from,double begin,double end){
    return matcher.allowsAvoidance(edge,from,begin,end,(g.roadFlags(g.edge(edge).road)&4)!=0,&fixed,op.vehicleClass);};auto t=routeFromPosition(g,start.second,{38.81741,-9.14814},op,{});if(t)audit(start.first+"/avoid",*t);
 }
 return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
