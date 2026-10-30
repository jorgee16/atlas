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
 check(argc==4,"production road, plaza and entry/exit CSVs required");std::ifstream file(argv[1]);check(bool(file),"missing production CSV");std::ostringstream buffer;buffer<<file.rdbuf();
 const auto csv=buffer.str();auto pt=TollTariffs::parse(csv,"Portugal");
 check(pt.classes==std::vector<int>({1,2,3,4}),"official classes");
 check(pt.version=="2026102801"&&pt.currency=="EUR"&&pt.year=="2026","provenance");
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
 for(int c=1;c<=4;++c)for(const auto &ref:{"A2","A4","A7","A11","A12","A13","A16","A17","A19","A28","A29","A33","A42","PVG;IP1",""}) {
   const auto value=pt.referenceEstimate(ref,1000,c);
   check(value&&*value>0,"national reference estimation is positive and class-specific");
 }
 check(std::abs(*pt.referenceEstimate("A2",225200,1)-23.80)<1e-8,"partial road sources take precedence over country averages");
 check(!pt.referenceEstimate("A25;A1",1000,1)&&!pt.referenceEstimate("A5",1000,99),"reference estimates cannot bypass ambiguous free aliases or unsupported classes");
 for(int c:{3,4})check(pt.explicitlyFree("A41",c)&&pt.estimate("A41",10000,c)==0.,"statutory class-specific A41 exemption");
 check(pt.freeSourceFor("A41",3).find("1058701611")!=std::string::npos,"class exemption keeps its legal source");
 check(!pt.explicitlyFree("A41",1)&&pt.referenceEstimate("A41",1000,1).value_or(0)>0,"heavy exemption must not make light vehicles free");
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
 check(charges.fixedCharge("ascendi:grande-lisboa:01",1)==0.65,"published A16 Idanha price");
 check(charges.fixedCharge("ascendi:grande-lisboa:02",2)==1.10,"published A16 Sacotes independent class2 price");
 check(charges.fixedCharge("ascendi:grande-lisboa:03",4)==2.95,"published A16 Ranholas class4 price");
 check(charges.fixedCharge("ascendi:costa-de-prata:01",3)==1.40,"published A17 Mira gantry price");
 check(charges.fixedCharge("ascendi:grande-porto:03",3)==0.,"explicit published A41 heavy zero price");
 check(!charges.fixedCharge("ascendi:grande-lisboa:01",5)&&!charges.fixedCharge("A16",1),"no motorcycle eligibility or road-name crossing inference");
 check(!pt.fixedCharge("brisa:0501",1),"road and fixed providers are isolated");
 rejects([&]{TollTariffs::parse(fixedBuffer.str()+"brisa:0501;A5;duplicate;1;2;3;4\n","Portugal");});
 auto wrongScheme=fixedBuffer.str();wrongScheme.replace(wrongScheme.find("fixed-crossing"),14,"road-average");
 rejects([&]{TollTariffs::parse(wrongScheme,"Portugal");});
 std::ifstream ticketFile(argv[3]);check(bool(ticketFile),"missing production ticket CSV");std::ostringstream ticketBuffer;ticketBuffer<<ticketFile.rdbuf();
 auto tickets=TollTariffs::parse(ticketBuffer.str(),"Portugal");
 check(tickets.scheme=="entry-exit"&&!tickets.estimate("A3",10000,1),"entry/exit prices cannot become km estimates");
 check(tickets.entryExitFare({"brisa-published","0311","0316"},1)==3.85,"official Maia PV-Braga Sul published pair");
 check(tickets.entryExitFare({"brisa-published","0311","0316"},4)==9.60,"official class4 independent price");
 check(tickets.entryExitFare({"brisa-published","1411","0117"},1)==2.90,"official A14 pair");
 check(!tickets.entryExitFare({"brisa-published","0211","0222"},1),"south source date discrepancy is withheld");
 check(!tickets.entryExitFare({"other","0311","0316"},1)&&!tickets.entryExitFare({"brisa-published","0311","0316"},5),"network and class cannot fall back");
 check(tickets.sumEntryExitFares({{"brisa-published","0311","0316"},{"brisa-published","0311","0316"}},1)==7.70,"repeated actual journeys are charged twice");
 auto unapproved=ticketBuffer.str();unapproved.replace(unapproved.find("# status=active"),15,"# status=candidate");
 rejects([&]{TollTariffs::parse(unapproved,"Portugal");});
 std::cout<<"Official tariff and country-policy tests passed\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
