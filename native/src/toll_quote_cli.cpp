#include "atlas/core.hpp"
#include "atlas/toll_crossings.hpp"
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
std::string read(const char*path){std::ifstream f(path);if(!f)throw std::runtime_error("Missing proof input");std::ostringstream s;s<<f.rdbuf();return s.str();}
std::vector<std::string> fields(const std::string &line){std::vector<std::string> c;std::istringstream in(line);std::string s;while(std::getline(in,s,';'))c.push_back(s);return c;}
int main(int argc,char**argv){try{
 if(argc!=8)throw std::runtime_error("graph country road-prices fixed-prices bindings actual-digests cases required");
 atlas::Graph graph(argv[1]);auto road=atlas::TollTariffs::parse(read(argv[3]),argv[2]);auto fixed=atlas::TollTariffs::parse(read(argv[4]),argv[2]);
 auto matcher=atlas::TollCrossingMatcher::parse(read(argv[5]));matcher.validateGraph(graph);
 atlas::TollGraphDigests actual;std::istringstream hashes(read(argv[6]));std::string line;
 while(std::getline(hashes,line)){auto c=fields(line);if(c.size()!=2)throw std::runtime_error("Bad actual digest row");actual[c[0]]=c[1];}
 std::istringstream cases(read(argv[7]));std::getline(cases,line);bool comma=false;std::cout<<'[';
 while(std::getline(cases,line)){
   auto c=fields(line);if(c.size()!=8)throw std::runtime_error("Bad real-route proof case");
   atlas::RouteOptions op;op.tariffs=&road;op.tariffCountry=argv[2];op.vehicleClass=std::stoi(c[5]);
   auto route=atlas::routeFromPosition(graph,{std::stod(c[1]),std::stod(c[2])},{std::stod(c[3]),std::stod(c[4])},op);
   if(!route)throw std::runtime_error("No real route for proof case "+c[0]);
   atlas::calibrateDriveEta(*route,graph);const auto before=atlas::routeJson(*route);
   const bool applied=atlas::applyFixedTollCharges(graph,*route,fixed,matcher,actual);
   if(comma)std::cout<<',';
   comma=true;
   std::cout<<"{\"id\":"<<atlas::jsonString(c[0])<<",\"expectedPricing\":"<<atlas::jsonString(c[6])<<",\"expectedAmount\":"<<c[7]
     <<",\"applied\":"<<(applied?"true":"false")<<",\"before\":"<<before<<",\"after\":"<<atlas::routeJson(*route)<<'}';
 }
 std::cout<<"]\n";return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
