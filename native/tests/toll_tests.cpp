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
 check(argc==3,"production road and plaza CSVs required");std::ifstream file(argv[1]);check(bool(file),"missing production CSV");std::ostringstream buffer;buffer<<file.rdbuf();
 const auto csv=buffer.str();auto pt=TollTariffs::parse(csv,"Portugal");
 check(pt.classes==std::vector<int>({1,2,3,4}),"official classes");
 check(pt.version=="2026102601"&&pt.currency=="EUR"&&pt.year=="2026","provenance");
 check(std::abs(*pt.sectionPrice("A5","Estádio Nacional / Oeiras",1)-.4)<1e-9,"official class1");
 check(std::abs(*pt.estimate("A5",23800,1)-2.5)<1e-9,"A5 published section chain");
 for(int c=2;c<=4;++c)check(std::abs(*pt.estimate("A5",23800,c)-4.8)<1e-9,"classes are source prices, not multipliers");
 check(!pt.estimate("A2",10000,1)&&!pt.estimate("A4",10000,1)&&!pt.estimate("A13",10000,1),"mixed-concession/bridge policy");
 for(const auto &ref:{"A22","A23","A24","A25","A 25;IP5"})for(int vehicle=1;vehicle<=4;++vehicle) {
   check(pt.explicitlyFree(ref,vehicle)&&pt.estimate(ref,50000,vehicle)==0.,"statutory free road is zero despite stale graph flags");
 }
 check(!pt.explicitlyFree("A4",1)&&!pt.explicitlyFree("A13",1)&&!pt.explicitlyFree("A28",1),"mixed concessions never zeroed by road name");
 check(!pt.estimate("A25;A1",1000,1)&&!pt.estimate("A1;A25",1000,1),"ambiguous free/paid aliases stay unavailable");
 check(!pt.estimate("A25",1000,99),"unsupported class cannot silently acquire a price");
 check(!pt.estimate("unknown",100,1)&&!pt.estimate("A5",100,5),"unknown never free");
 check(!pt.estimate("A5",-1,1)&&!pt.estimate("A5",NAN,1)&&!pt.estimate("A5",INFINITY,1),"invalid distances");
 check(pt.estimate(" EN6 ; A 5",1000,1).has_value(),"OSM multiple references");
 rejects([&]{TollTariffs::parse(csv,"Spain");});
 for(const std::string policy:{"# freeRoads=T2,T2\n# freeRoadSource=https://example.test/law\n", "# freeRoads=\n# freeRoadSource=https://example.test/law\n", "# freeRoads=T2\n# freeRoadSource=http://example.test/law\n", "# freeRoadSource=https://example.test/law\n"}) {
   const std::string base="# country=Testland\n# currency=EUR\n# year=2026\n# source=https://example.test/prices\nroad;section;km;class1\nT1;paid;1;1.00\n";
   rejects([&]{TollTariffs::parse(base+policy,"Testland");});
 }
 const std::string second="# country=Testland\n# currency=JPY\n# year=2026\n# version=2\n# fractionDigits=0\n# source=https://example.test/fixture\nroad;section;km;class1;class5\nT1;paid;10;100;230\nT0;free;1;0;0\n";
 auto jp=TollTariffs::parse(second,"Testland");check(jp.classes==std::vector<int>({1,5})&&jp.fractionDigits==0,"generic classes/currency");
 check(*jp.estimate("T1",10000,5)==230&&*jp.estimate("T0",100,5)==0,"independent prices and explicit free section");
 check(!jp.estimate("A5",1000,1),"no previous-country leakage");
 for(auto tail:{std::string("T1;paid;10;1;2\n"),std::string("BAD;broken;0;1;2\n"),std::string("BAD;broken;1;nan;2\n"),std::string("BAD;broken;1;-1;2\n")})rejects([&]{TollTariffs::parse(second+tail,"Testland");});
 rejects([&]{TollTariffs::parse(second+"# currency=EUR\n","Testland");});
 auto bad=second;bad.replace(bad.find("class5"),6,"class1");rejects([&]{TollTariffs::parse(bad,"Testland");});
 std::ifstream fixedFile(argv[2]);check(bool(fixedFile),"missing fixed charge CSV");std::ostringstream fixedBuffer;fixedBuffer<<fixedFile.rdbuf();
 auto charges=TollTariffs::parse(fixedBuffer.str(),"Portugal");
 rejects([&]{TollTariffs::parse(fixedBuffer.str()+"# freeRoads=A5\n# freeRoadSource=https://example.test/law\n","Portugal");});
 check(charges.scheme=="fixed-crossing"&&!charges.estimate("A5",1000,1),"fixed charges cannot become road averages");
 check(std::abs(*charges.fixedCharge("brisa:0501",1)-1.60)<1e-9,"published Carcavelos PV class1 crossing");
 for(int c=2;c<=4;++c)check(std::abs(*charges.fixedCharge("brisa:0501",c)-3.10)<1e-9,"published Carcavelos PV heavy classes");
 check(std::abs(*charges.sumFixedCharges({"brisa:0502","brisa:0503"},1)-1.60)<1e-9,"sum of identified crossings uses integer minor units");
 check(std::abs(*charges.sumFixedCharges({"brisa:0502","brisa:0502"},1)-1.40)<1e-9,"a real repeated crossing must be charged again");
 check(!charges.sumFixedCharges({"unknown"},1)&&!charges.fixedCharge("brisa:0501",5),"unknown charge/class is not zero");
 check(!pt.fixedCharge("brisa:0501",1),"road and fixed providers are isolated");
 rejects([&]{TollTariffs::parse(fixedBuffer.str()+"brisa:0501;A5;duplicate;1;2;3;4\n","Portugal");});
 auto wrongScheme=fixedBuffer.str();wrongScheme.replace(wrongScheme.find("fixed-crossing"),14,"road-average");
 rejects([&]{TollTariffs::parse(wrongScheme,"Portugal");});
 std::cout<<"Official tariff and country-policy tests passed\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
