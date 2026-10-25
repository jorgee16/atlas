#include "atlas/core.hpp"
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
using namespace atlas;
void check(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
template<class F> void rejects(F f){bool failed=false;try{f();}catch(const std::exception&){failed=true;}check(failed,"invalid table accepted");}
int main(int argc,char** argv){try{
 check(argc==2,"production CSV required");std::ifstream file(argv[1]);check(bool(file),"missing production CSV");std::ostringstream buffer;buffer<<file.rdbuf();
 const auto csv=buffer.str();auto pt=TollTariffs::parse(csv,"Portugal");
 check(pt.classes==std::vector<int>({1,2,3,4}),"official classes");
 check(pt.version=="2026102501"&&pt.currency=="EUR"&&pt.year=="2026","provenance");
 check(std::abs(*pt.sectionPrice("A5","Estádio Nacional / Oeiras",1)-.4)<1e-9,"official class1");
 check(std::abs(*pt.estimate("A5",23800,1)-2.5)<1e-9,"A5 published section chain");
 for(int c=2;c<=4;++c)check(std::abs(*pt.estimate("A5",23800,c)-4.8)<1e-9,"classes are source prices, not multipliers");
 check(!pt.estimate("A2",10000,1)&&!pt.estimate("A4",10000,1)&&!pt.estimate("A13",10000,1),"mixed-concession/bridge policy");
 check(!pt.estimate("unknown",100,1)&&!pt.estimate("A5",100,5),"unknown never free");
 check(!pt.estimate("A5",-1,1)&&!pt.estimate("A5",NAN,1)&&!pt.estimate("A5",INFINITY,1),"invalid distances");
 check(pt.estimate(" EN6 ; A 5",1000,1).has_value(),"OSM multiple references");
 rejects([&]{TollTariffs::parse(csv,"Spain");});
 const std::string second="# country=Testland\n# currency=JPY\n# year=2026\n# version=2\n# fractionDigits=0\n# source=https://example.test/fixture\nroad;section;km;class1;class5\nT1;paid;10;100;230\nT0;free;1;0;0\n";
 auto jp=TollTariffs::parse(second,"Testland");check(jp.classes==std::vector<int>({1,5})&&jp.fractionDigits==0,"generic classes/currency");
 check(*jp.estimate("T1",10000,5)==230&&*jp.estimate("T0",100,5)==0,"independent prices and explicit free section");
 check(!jp.estimate("A5",1000,1),"no previous-country leakage");
 for(auto tail:{std::string("T1;paid;10;1;2\n"),std::string("BAD;broken;0;1;2\n"),std::string("BAD;broken;1;nan;2\n"),std::string("BAD;broken;1;-1;2\n")})rejects([&]{TollTariffs::parse(second+tail,"Testland");});
 rejects([&]{TollTariffs::parse(second+"# currency=EUR\n","Testland");});
 auto bad=second;bad.replace(bad.find("class5"),6,"class1");rejects([&]{TollTariffs::parse(bad,"Testland");});
 std::cout<<"Official tariff and country-policy tests passed\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
