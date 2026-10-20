#include "atlas/core.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>
using namespace atlas;
void check(bool value,const char* message) { if(!value) throw std::runtime_error(message); }
int main() {
 try {
  // A loop's exit runs within 2 m of its approach. Stateless nearest matching
  // selects the exit from one noisy fix, despite over 100 m of untravelled loop.
  Route r;
  r.points={{40,-8},{40.001,-8},{40.001,-7.999},{40,-7.999},{40,-7.99998},{40.001,-7.99998},{40.002,-7.99998}};
  for(std::size_t i=1;i<r.points.size();++i) r.meters+=distance(r.points[i-1],r.points[i]);
  r.seconds=r.meters/8;
  GuidanceSession session;
  auto first=session.update({40.0001,-8},5,8,100,r);
  auto ambiguous=session.update({40.00017,-7.99998},5,8,101,r);
  check(ambiguous.position.segment==0,"ambiguous loop must remain on approach");
  check(ambiguous.position.along>first.position.along+5,"progress must not rewind");
  // Sustained, unambiguous changes still recover rather than freezing forever.
  GuidanceSession recovery;
  recovery.update(r.points.front(),5,8,100,r);
  recovery.update(r.points[2],5,8,101,r);
  recovery.update(r.points[2],5,8,102,r);
  auto accepted=recovery.update(r.points[2],5,8,103,r);
  check(accepted.position.along>150,"sustained new position must eventually be accepted");
  GuidanceSession poor;
  auto base=poor.update(r.points.front(),5,8,100,r);
  for(int accuracy: {60,100}) {
   auto g=poor.update(r.points[2],accuracy,8,101+accuracy,r);
   check(g.state==Guidance::State::reduced,"poor GPS must not reroute");
   check(std::abs(g.position.along-base.position.along)<.01,"poor GPS must not advance");
  }
  Route straight;
  straight.points={{40,-8},{40.0045,-8}};
  straight.meters=distance(straight.points[0],straight.points[1]);
  straight.seconds=straight.meters/8;
  GuidanceSession gap;
  gap.update(straight.points.front(),5,8,100,straight);
  for(int second=1;second<=16;++second)
   gap.update({40+second*8.0/111320,-8},100,8,100+second,straight);
  // The motion filter can temporarily report zero while reacquiring GPS.
  auto fresh=gap.update({40+136.0/111320,-8},5,0,117,straight);
  check(fresh.state==Guidance::State::normal && fresh.position.along>130,
      "recovery travel budget must use time since last reliable projection, not last poor fix");
  std::cout<<"Navigation loop ambiguity, recovery and poor GPS passed\n";
 } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}

