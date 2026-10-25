#include "atlas/toll_crossings.hpp"
#include <iostream>
#include <stdexcept>
using namespace atlas;
void check(bool b,const char*m){if(!b)throw std::runtime_error(m);}
template<class F>void rejects(F f){bool fail=false;try{f();}catch(const std::exception&){fail=true;}check(fail,"ambiguous evidence accepted");}
int main(){try{
 TollGraphDigests graph;
 for(const auto &name:{"nodes.bin","edges.bin","geometry.bin","roads.bin","strings.bin","restrictions.bin","spatial-index.bin"})graph[name]=std::string(64,'a');
 const std::vector<TollChargeBinding> bindings={{7,1,2,30,"gate:1",100},{7,1,2,70,"gate:2",100},{8,2,1,20,"gate:1",100}};
 TollCrossingMatcher matcher(graph,"Testland",{7,8},bindings,true);
 auto q=matcher.match(graph,"Testland",{{7,1,2,0,100,"T1",true}});
 check(q&&q->complete&&q->chargeIds==std::vector<std::string>({"gate:1","gate:2"}),"ordered physical crossings");
 q=matcher.match(graph,"Testland",{{7,1,2,31,100,"T1",true}});
 check(q&&q->chargeIds==std::vector<std::string>({"gate:2"}),"start after a gate cannot charge it again");
 q=matcher.match(graph,"Testland",{{7,1,2,0,30,"T1",true}});check(q&&q->chargeIds.empty(),"destination before gate");
 q=matcher.match(graph,"Testland",{{8,2,1,0,100,"T1",true}});check(q&&q->chargeIds==std::vector<std::string>({"gate:1"}),"directional binding");
 check(!matcher.match(graph,"Testland",{{7,2,1,0,100,"T1",true}}),"wrong direction rejected");
 check(!matcher.match(graph,"Otherland",{}),"cross-country proof rejected");
 auto changed=graph;changed["edges.bin"]=std::string(64,'b');check(!matcher.match(changed,"Testland",{}),"changed graph rejected");
 TollCrossingMatcher unreviewed(graph,"Testland",{7,8},bindings,false);check(!unreviewed.match(graph,"Testland",{}),"unreviewed mappings cannot quote");
 q=matcher.match(graph,"Testland",{{7,1,2,0,100,"T1",true},{8,2,1,0,100,"T1",true},{7,1,2,0,100,"T1",true},{9,2,1,0,100,"T1",true}});
 check(q&&!q->complete&&q->chargeIds.size()==5,"uncertified edge makes total incomplete, genuine repeats preserved");
 rejects([&]{TollCrossingMatcher m(graph,"Testland",{7,8},{{7,1,2,30,"one",100},{7,1,2,30,"two",100}},true);});
 rejects([&]{TollCrossingMatcher m({},"Testland",{7,8},bindings,true);});
 std::cout<<"Directed toll-crossing evidence tests passed\n";return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
