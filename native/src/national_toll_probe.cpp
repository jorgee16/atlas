#include "atlas/core.hpp"
#include <algorithm>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
using namespace atlas;
static std::string read(const char *path){std::ifstream f(path);if(!f)throw std::runtime_error("Missing national tariff input");std::ostringstream s;s<<f.rdbuf();return s.str();}
int main(int argc,char **argv){try{
  if(argc!=4)throw std::runtime_error("graph country road-table required");
  Graph graph(argv[1]);const auto csv=read(argv[3]);const auto prices=TollTariffs::parse(csv,argv[2]);
  std::string strictCsv,line;std::istringstream lines(csv);
  while(std::getline(lines,line))if(line.rfind("# referenceEstimate=",0)!=0&&line.rfind("# referenceSourceRoads=",0)!=0)strictCsv+=line+'\n';
  const auto strict=TollTariffs::parse(strictCsv,argv[2]);
  struct Candidate{uint32_t from,edge;double meters;};std::map<std::string,Candidate> candidates;
  std::unordered_map<uint32_t,std::optional<std::string>> refs;
  for(uint32_t from=0;from<graph.nodeCount();++from)for(uint32_t edge=graph.offset(from);edge<graph.offset(from+1);++edge){
    const auto e=graph.edge(edge);if(!e.allows(Profile::drive)||e.target==from||!e.distanceDm)continue;
    auto it=refs.find(e.road);
    if(it==refs.end()){const auto road=graph.road(e.road);it=refs.emplace(e.road,(road.flags&4)?std::optional<std::string>(road.ref):std::nullopt).first;}
    if(!it->second)continue;
    const auto label=it->second->empty()?"(no reference)":*it->second;
    const double meters=e.distanceDm/10.;const auto previous=candidates.find(label);
    if(previous==candidates.end()||meters>previous->second.meters)candidates[label]={from,edge,meters};
  }
  if(candidates.empty())throw std::runtime_error("No real toll-marked road probes");
  bool comma=false;std::cout<<"{\"roadReferences\":"<<candidates.size()<<",\"probes\":[";
  auto emit=[&](const std::string &id,int vehicle,const std::optional<Route>&before,const std::optional<Route>&after){
    if(!before||!after)throw std::runtime_error("Real routing failed for "+id);
    if(!after->tollPriceComplete)throw std::runtime_error("Unpriced real route: "+id);
    if(after->referenceTollMeters>0&&(after->tollPriceExact||after->tollEuros<=0))throw std::runtime_error("Reference incorrectly exact/free: "+id);
    if(comma)std::cout<<',';
    comma=true;
    std::cout<<"{\"id\":"<<jsonString(id)<<",\"vehicleClass\":"<<vehicle<<",\"before\":"<<routeJson(*before)<<",\"after\":"<<routeJson(*after)<<'}';
  };
  for(const auto &item:candidates)for(const int vehicle:prices.classes){
    const auto c=item.second;RouteOptions options;options.tariffCountry=argv[2];options.vehicleClass=vehicle;
    options.initialEdge=c.edge;options.initialSnap=graph.point(c.from);options.tariffs=&strict;
    const auto before=route(graph,c.from,graph.edge(c.edge).target,options);
    options.tariffs=&prices;const auto after=route(graph,c.from,graph.edge(c.edge).target,options);
    if(!after||after->tolledMeters<=0||std::find(after->edges.begin(),after->edges.end(),c.edge)==after->edges.end())throw std::runtime_error("Probe did not actually traverse the selected toll edge: "+item.first);
    emit(item.first,vehicle,before,after);
  }
  struct Trip{const char *id;Point from,to;};
  const Trip trips[]={ {"Lisboa-Cascais",{38.7223,-9.1393},{38.6979,-9.4213}},
    {"Lisboa-Faro",{38.7223,-9.1393},{37.0194,-7.9322}},
    {"Porto-Braga",{41.1579,-8.6291},{41.5454,-8.4265}},
    {"Figueira-Coimbra",{40.1508,-8.8618},{40.2033,-8.4103}} };
  for(const auto &trip:trips)for(const int vehicle:prices.classes){
    RouteOptions options;options.tariffCountry=argv[2];options.vehicleClass=vehicle;options.tariffs=&strict;
    const auto before=routeFromPosition(graph,trip.from,trip.to,options,std::nullopt);
    options.tariffs=&prices;const auto after=routeFromPosition(graph,trip.from,trip.to,options,std::nullopt);
    emit(trip.id,vehicle,before,after);
  }
  std::cout<<"]}\n";return 0;
}catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}}
