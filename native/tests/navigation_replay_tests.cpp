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
  // A first highly accurate GPS fix after a gap may reflect either real
  // travel or a GPS/route snap. Native guidance cannot treat an OLD 8m/s
  // velocity as current proof that 136m of driving really occurred.
  auto unconfirmed=gap.update({40+136.0/111320,-8},5,0,117,straight);
  check(unconfirmed.state==Guidance::State::normal &&
        std::abs(unconfirmed.position.along)<1,
      "accurate reacquisition with zero confirmed speed must hold progress");
  // Once independent movement is confirmed, a fresh, consistent position
  // may catch up to the observed route. Android handles foreground visual
  // repositioning separately, using recent consecutive real GPS fixes.
  bool recoveredAfterConsecutiveFixes=false;
  for (int second=0; second<3; ++second) {
    auto fresh=gap.update({40+(144.0+8.0*second)/111320,-8},
                          5,8,118+second,straight);
    recoveredAfterConsecutiveFixes |=
        fresh.state==Guidance::State::normal && fresh.position.along>140;
  }
  check(recoveredAfterConsecutiveFixes,
      "three consistent moving GPS fixes must restore progress after weak GPS");
  // Missed right exit: GPS remains accurate and the car demonstrably
  // continues east while the planned road turns north. This is a route
  // deviation, never a deterioration of the GPS receiver's accuracy.
  Route missedExit;
  missedExit.points={{40,-8},{40,-7.999},{40.001,-7.999}};
  for(std::size_t i=1;i<missedExit.points.size();++i)
    missedExit.meters+=distance(missedExit.points[i-1],missedExit.points[i]);
  missedExit.seconds=missedExit.meters/10.;
  GuidanceSession missed;
  bool checking=false, confirmed=false, recalculated=false;
  const double observedLons[]={
    -7.9994,-7.9992,-7.9990,-7.99887,-7.99870,-7.99850,
    -7.99840,-7.99830,-7.99820,-7.99810,-7.99800
  };
  for(int i=0;i<11;++i) {
    auto state=missed.update({40,observedLons[i]},5,10,500.+i,missedExit);
    if(i>=5) {
      check(state.state!=Guidance::State::reduced,
            "missed exit with accurate moving GNSS must not say GPS reduced");
      checking|=state.state==Guidance::State::checking;
      confirmed|=state.offRouteConfirmed;
      recalculated|=state.state==Guidance::State::reroute;
    }
  }
  check(checking && confirmed && recalculated,
        "missed exit must progress through checking, confirmed off-route and reroute");
  // A real approach may complete at zero speed; a GPS wander that jumps
  // from the beginning straight to the destination must never auto-arrive.
  GuidanceSession approachingDestination;
  auto nearEnd=straight.points.back();
  nearEnd.lat-=16.0/111320.0;
  auto approach=approachingDestination.update(nearEnd,5,8,200,straight);
  check(approach.position.remaining < 35.,
        "arrival precondition must be confirmed near destination");
  auto reached=approachingDestination.update(straight.points.back(),5,0,201,straight);
  check(reached.state==Guidance::State::arrived,
        "stationary last fix must confirm a previously approached destination");
  GuidanceSession falseArrival;
  falseArrival.update(straight.points.front(),5,0,200,straight);
  auto teleported=falseArrival.update(straight.points.back(),5,0,201,straight);
  check(teleported.state!=Guidance::State::arrived,
        "GPS drift near destination must not invent route completion");
  // A driver exits the mapped road using several real moving GPS fixes,
  // then parks 39 metres away on an unmapped private driveway.
  GuidanceSession privateLot;
  const double eastMetre=1.0/(111320.0*std::cos(40.0*3.141592653589793/180.0));
  auto lotPoint=[&](double along,double east)->Point {
    return {40.0+along/111320.0,-8.0+east*eastMetre};
  };
  privateLot.update(lotPoint(20,0),5,5,300,straight);
  privateLot.update(lotPoint(26,15),5,5,301,straight);
  privateLot.update(lotPoint(34,26),5,5,302,straight);
  auto departing=privateLot.update(lotPoint(42,37),5,5,303,straight);
  check(departing.state==Guidance::State::checking,
        "real sub-80m diversion must enter route-deviation checking");
  bool showedRealLocation=false,requestedNewRoute=false;
  for(int sec=304;sec<=312;++sec) {
    auto stopped=privateLot.update(lotPoint(43,39),5,0,sec,straight);
    showedRealLocation|=stopped.offRouteConfirmed;
    requestedNewRoute|=stopped.state==Guidance::State::reroute;
  }
  check(showedRealLocation,"parked driver must not remain snapped to old road");
  check(requestedNewRoute,"real sub-80m deviation must reroute after stopping");
  // A 55m apparently precise stationary offset alone is not real travel.
  GuidanceSession falseExit;
  falseExit.update(lotPoint(20,0),5,0,400,straight);
  for(int sec=401;sec<=415;++sec) {
    auto drift=falseExit.update(lotPoint(20,55),5,0,sec,straight);
    check(!drift.offRouteConfirmed && drift.state!=Guidance::State::reroute,
          "stationary GNSS wander must not become a verified departure");
  }
  std::cout<<"Navigation loop ambiguity, recovery and poor GPS passed\n";
 } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}

