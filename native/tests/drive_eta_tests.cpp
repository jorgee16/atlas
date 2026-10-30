#include "atlas/core.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
using namespace atlas;
void check(bool ok,const char *message){if(!ok)throw std::runtime_error(message);}
double calibrated(const std::string &root,const std::string &name) {
  Graph graph(root+"/eta-"+name);auto r=route(graph,0,2);
  check(bool(r),"ETA fixture must have a real legal path");
  const auto original=*r;
  calibrateDriveEta(*r,graph);
  check(r->edges==original.edges && r->meters==original.meters &&
      r->points.size()==original.points.size() &&
      r->maneuvers.size()==original.maneuvers.size(),"ETA must not change route topology");
  for(std::size_t i=0;i<r->points.size();++i)
    check(distance(r->points[i],original.points[i])<1e-9,"ETA must preserve route geometry");
  for(std::size_t i=0;i<r->maneuvers.size();++i)
    check(r->maneuvers[i].at==original.maneuvers[i].at,"ETA must preserve maneuver progress");
  return r->seconds;
}
int main(int argc,char **argv){try {
  const std::string root=argc>1?argv[1]:"/tmp/atlas-native-fixtures";
  const auto single=calibrated(root,"single"),split=calibrated(root,"split");
  check(std::abs(single-split)<1e-6,"Straight mainline ETA must not depend on OSM way IDs");
  check(std::abs(calibrated(root,"turn")-single-2)<1e-6,"Real sharp turn must retain delay");
  check(std::abs(calibrated(root,"ramp")-single-2)<1e-6,"Actual ramp transition must retain delay");
  check(std::abs(calibrated(root,"toll-gate")-single-2)<1e-6,"Toll boundary must retain delay");
  const auto local=calibrated(root,"local");
  check(std::abs(calibrated(root,"junction")-local-6)<1e-6,"Local junction must retain delay");
  check(std::abs(calibrated(root,"restricted")-local-6)<1e-6,"Restricted junction must retain delay");
  std::cout<<"ETA segmentation, real turns, ramps, local junctions and geometry regressions passed\n";
  return 0;
}catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}}
