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
 std::string reason;
 check(!matcher.match(changed,"Testland",{},&reason)&&reason=="graph_hash","diagnostics distinguish the actual graph identity failure");
 check(!matcher.match(graph,"Otherland",{},&reason)&&reason=="country","diagnostics distinguish country leakage");
 auto partial=matcher.match(graph,"Testland",{{9,1,2,0,100,"local approach",false},{8,2,1,0,100,"T1",true}},&reason);
 check(partial&&!partial->complete&&reason=="unreviewed_edge"&&partial->unreviewedEdges==std::vector<uint32_t>{9},"report exact blocking edges without certifying unknown free approaches");
 check(partial->chargeIds==std::vector<std::string>{"gate:1"},"diagnostics preserve physical crossings even when coverage is incomplete");
 const auto prices=TollTariffs::parse("# country=Testland\n# currency=EUR\n# year=2026\n# version=1\n# scheme=fixed-crossing\n# source=https://example.test/prices\ncharge;road;name;class1;class4\ngate:1;T1;First;1.00;0.00\ngate:2;T1;Second;2.00;0.00\n","Testland");
 check(!matcher.allowsAvoidance(7,1,0,100,false,&prices,1),"stale free graph flags cannot bypass proven collection");
 check(matcher.allowsAvoidance(7,1,71,100,true,&prices,1),"start after both gates retains a real free traversal");
 check(!matcher.allowsAvoidance(7,1,31,100,false,&prices,1),"passing only the first gate does not skip the second");
 check(matcher.allowsAvoidance(7,1,0,100,true,&prices,4),"independently published class zero is respected");
 check(!matcher.allowsAvoidance(7,1,0,100,false,&prices,99),"unsupported class is not inferred free");
 check(!matcher.allowsAvoidance(9,1,0,100,true,&prices,1),"unreviewed flagged road remains potentially chargeable");
 TollCrossingMatcher unreviewed(graph,"Testland",{7,8},bindings,false);check(!unreviewed.match(graph,"Testland",{}),"unreviewed mappings cannot quote");
 q=matcher.match(graph,"Testland",{{7,1,2,0,100,"T1",true},{8,2,1,0,100,"T1",true},{7,1,2,0,100,"T1",true},{9,2,1,0,100,"T1",true}});
 check(q&&!q->complete&&q->chargeIds.size()==5,"uncertified edge makes total incomplete, genuine repeats preserved");
 rejects([&]{TollCrossingMatcher m(graph,"Testland",{7,8},{{7,1,2,30,"one",100},{7,1,2,30,"two",100}},true);});
 rejects([&]{TollCrossingMatcher m({},"Testland",{7,8},bindings,true);});
 const auto journeys=entryExitJourneys({"entry:network:one","exit:network:two","entry:network:one","exit:network:two"});
 check(journeys&&journeys->size()==2&&journeys->front().entry=="one"&&journeys->front().exit=="two","explicit repeated ticket journeys are preserved");
 const std::vector<std::vector<std::string>> incomplete={ {},{"entry:n:a"},{"exit:n:b"},
   {"entry:n:a","entry:n:b","exit:n:c"},{"entry:n:a","exit:other:b"},
   {"gate:one"},{"entry:n:a","exit:n:b","entry:n:c"},{"entry:n:a:extra","exit:n:b"}};
 for(const auto &events:incomplete)check(!entryExitJourneys(events),"incomplete, mixed or ambiguous ticket events cannot quote");
 std::cout<<"Directed toll-crossing evidence tests passed\n";return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
