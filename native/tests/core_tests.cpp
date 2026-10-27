#include "atlas/core.hpp"
#include "atlas/toll_crossings.hpp"
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
using namespace atlas;
static void check(bool ok, const char *msg) {
  if (!ok)
    throw std::runtime_error(msg);
}
template <class F> void rejects(F f) {
  bool caught = false;
  try {
    f();
  } catch (const std::exception &) {
    caught = true;
  }
  check(caught, "Expected rejection");
}
int main(int argc, char **argv) {
  try {
    const std::string root = argc > 1 ? argv[1] : "/tmp/atlas-native-fixtures";
    Graph graph(root + "/basic");
    // Display metadata protects entry/exit but does not pin every roundabout
    // shape vertex or mutate the engine's authoritative route.
    Route displayMetadata;
    displayMetadata.points={{40,-8},{40.0001,-8},{40.0002,-8}};
    displayMetadata.legs.resize(4);
    displayMetadata.legs[0].road.flags=0;
    displayMetadata.legs[1].road.flags=1; displayMetadata.legs[1].first=1;
    displayMetadata.legs[2].road.flags=1; displayMetadata.legs[2].first=2;
    displayMetadata.legs[3].road.flags=0; displayMetadata.legs[3].first=2;
    displayMetadata.meters=123; displayMetadata.seconds=45;
    const auto displayJson=routeJson(displayMetadata);
    check(displayJson.find("\"visualProtectedPoints\":[1,2]")!=std::string::npos,
          "roundabout entry and exit are exact visual anchors");
    check(displayMetadata.points.size()==3 && displayMetadata.meters==123 && displayMetadata.seconds==45,
          "display metadata never mutates routing geometry, distance or ETA");
    auto drive = route(graph, 0, 2);
    check(drive.has_value(), "drive route");
    check(std::abs(drive->seconds - 8) < .001, "fastest drive path");
    check(drive->points.size() == 4, "restored geometry");
    RouteOptions walk;
    walk.profile = Profile::walk;
    auto walking = route(graph, 0, 2, walk);
    check(walking && std::abs(walking->meters - 170) < .001,
          "shortest walking path");
    check(!route(graph, 0, 4), "disconnected graph");
    check(!route(graph, 2, 0), "directed graph");
    check(route(graph, 0, 0)->seconds == 0, "same node");
    check(graph.nearest({40, -8}, Profile::drive, 20) == 0, "profile snapping");
    check(!graph.nearest({0, 0}, Profile::drive, 20), "snap radius");
    rejects([&] { route(graph, 99, 0); });
    rejects([&] { graph.nearest({91, 0}, Profile::drive); });
    RouteOptions cancelled;
    cancelled.cancelled = [] { return true; };
    rejects([&] { route(graph, 0, 2, cancelled); });
    RouteOptions limited;
    limited.maxExpanded = 0;
    rejects([&] { route(graph, 0, 2, limited); });
    Graph toll(root + "/toll");
    RouteOptions avoid;
    avoid.avoidTolls = true;
    check(route(toll, 0, 2, avoid)->seconds == 20, "avoid tolls");
    const auto sampleTariffs=TollTariffs::parse(
      "# country=Portugal\n# currency=EUR\n# year=2026\n"
      "# source=https://www.imt-ip.pt/\n"
      "road;section;km;class1;class2;class3;class4\n"
      "A1;Test section;10;1.00;1.80;2.30;2.60\n","Portugal");
    RouteOptions paid;
    paid.tariffs=&sampleTariffs;
    auto tolled=route(toll,0,2,paid);
    check(tolled && tolled->tollPriceComplete && tolled->tollEuros>0,
          "loaded country tariff estimates tolled route");
    check(tolled->pricedTollMeters>0 &&
          tolled->pricedTollMeters==tolled->tolledMeters,
          "price coverage matches all tolled edges");
    check(routeJson(*tolled).find("\"tollPricing\":\"estimate\"")!=std::string::npos,
          "only show price as estimate, not an official quoted total");
    check(tolled->tollRoads.size()==1 && tolled->tollRoads[0].road=="A1",
          "toll breakdown groups individual OSM edges under their charged road");
    check(tolled->tollRoads[0].complete &&
          tolled->tollRoads[0].pricedMeters==tolled->tollRoads[0].meters,
          "breakdown reports only validated tariff-covered distance");
    const auto paidJson=routeJson(*tolled);
    check(paidJson.find("\"tollRoads\"")!=std::string::npos &&
          paidJson.find("\"tollAmount\"")!=std::string::npos,
          "currency-neutral route total and ordered per-road explanation");
    const auto freeTariffs=TollTariffs::parse(
      "# country=Testland\n# currency=EUR\n# year=2026\n# source=https://example.test/prices\n"
      "# freeRoads=A1\n# freeRoadSource=https://example.test/statute\n"
      "road;section;km;class1\nT1;paid;10;1.00\n","Testland");
    auto freeOptions=paid;freeOptions.tariffs=&freeTariffs;
    const auto exempt=route(toll,0,2,freeOptions);
    check(exempt&&exempt->tollEuros==0&&exempt->tollPriceExact&&exempt->tollPriceComplete,"explicit statutory zero overrides stale graph flags");
    check(exempt->edges==tolled->edges&&exempt->meters==tolled->meters&&exempt->seconds==tolled->seconds,"free-road pricing never changes routing");
    check(exempt->tollRoads.front().exact&&routeJson(*exempt).find("https://example.test/statute")!=std::string::npos,"zero price retains official provenance");
    // Synthetic graph fixtures verify pricing invariants; real A5 journeys
    // are validated separately against SHA-verified Portugal graph files.
    const auto fixedFixture=TollTariffs::parse(
      "# country=Testland\n# currency=EUR\n# year=2026\n# version=1\n"
      "# scheme=fixed-crossing\n# source=https://example.test/fixture\n"
      "charge;road;name;class1;class4\ngate:1;T1;Fixture plaza;2.25;9.00\n","Testland");
    TollGraphDigests identity;
    for(const auto &name:{"nodes.bin","edges.bin","geometry.bin","roads.bin","strings.bin","restrictions.bin","spatial-index.bin"})identity[name]=std::string(64,'a');
    std::unordered_set<uint32_t> certified;
    for(const auto &leg:tolled->legs)certified.insert(leg.edge);
    const auto first=tolled->legs.front();const auto full=toll.edge(first.edge).distanceDm/10.;
    TollCrossingMatcher fixedProof(identity,"Testland",certified,{{first.edge,first.from,first.to,full/2,"gate:1",full}},true);
    fixedProof.validateGraph(toll);
    auto exact=*tolled;exact.tollCountry="Testland";
    const auto originalPoints=exact.points;const auto originalEdges=exact.edges;
    check(applyFixedTollCharges(toll,exact,fixedFixture,fixedProof,identity),"complete directed fixture proof enables exact base tariff");
    check(exact.tollPriceExact && std::abs(exact.tollEuros-2.25)<1e-9,"fixed price is independent of driven km");
    check(exact.edges==originalEdges && exact.points.size()==originalPoints.size() && exact.seconds==tolled->seconds && exact.meters==tolled->meters,
          "pricing never changes path, distance or ETA");
    for(std::size_t i=0;i<originalPoints.size();++i)check(exact.points[i].lat==originalPoints[i].lat && exact.points[i].lon==originalPoints[i].lon,"pricing never changes geographic geometry");
    check(routeJson(exact).find("\"tollPricing\":\"exact\"")!=std::string::npos,"exact quote is serialized only after full evidence");
    auto foreign=*tolled;foreign.tollCountry="Otherland";
    check(!applyFixedTollCharges(toll,foreign,fixedFixture,fixedProof,identity),"cross-country price application rejected");
    auto changedIdentity=identity;changedIdentity["edges.bin"]=std::string(64,'b');
    check(!applyFixedTollCharges(toll,exact,fixedFixture,fixedProof,changedIdentity),"another graph cannot reuse an exact proof");

    const auto ticketFixture=TollTariffs::parse(
      "# country=Testland\n# currency=JPY\n# year=2026\n# version=1\n# fractionDigits=0\n"
      "# scheme=entry-exit\n# source=https://example.test/fixture\n"
      "network;entry;exit;class1;class4\nnetwork;one;two;125;811\n","Testland");
    const auto last=tolled->legs.back();const auto lastFull=toll.edge(last.edge).distanceDm/10.;
    TollCrossingMatcher ticketProof(identity,"Testland",certified,
      {{first.edge,first.from,first.to,full/3,"entry:network:one",full},
       {last.edge,last.from,last.to,lastFull/2,"exit:network:two",lastFull}},true);
    ticketProof.validateGraph(toll);
    auto ticketRoute=*tolled;ticketRoute.tollCountry="Testland";
    check(applyEntryExitTollCharges(toll,ticketRoute,ticketFixture,ticketProof,identity),"complete directed entry/exit proof enables a published pair");
    check(ticketRoute.tollPriceExact&&ticketRoute.tollEuros==125&&ticketRoute.tollCurrency=="JPY","ticket fares keep independent currency and class amounts");
    check(ticketRoute.edges==tolled->edges&&ticketRoute.meters==tolled->meters&&ticketRoute.seconds==tolled->seconds&&ticketRoute.maneuvers.size()==tolled->maneuvers.size(),"ticket pricing never changes navigation");
    for(std::size_t i=0;i<tolled->points.size();++i)check(ticketRoute.points[i].lat==tolled->points[i].lat&&ticketRoute.points[i].lon==tolled->points[i].lon,"ticket pricing preserves authoritative geometry");
    auto incompleteTicket=*tolled;incompleteTicket.tollCountry="Testland";
    const auto beforeIncomplete=routeJson(incompleteTicket);
    TollCrossingMatcher exitOnly(identity,"Testland",certified,{{last.edge,last.from,last.to,lastFull/2,"exit:network:two",lastFull}},true);
    check(!applyEntryExitTollCharges(toll,incompleteTicket,ticketFixture,exitOnly,identity)&&routeJson(incompleteTicket)==beforeIncomplete,"missing entry never publishes a partial or zero ticket price");
    check(!applyEntryExitTollCharges(toll,ticketRoute,ticketFixture,ticketProof,changedIdentity),"ticket evidence is graph-version bound");

    const auto ukTariffs=TollTariffs::parse(
      "# country=United Kingdom\n# currency=GBP\n# year=2026\n"
      "# source=https://example.test/tariffs\n"
      "road;section;km;class1;class2;class3;class4\n"
      "M6;example;10;1.50;2.50;3.50;4.50\n","United Kingdom");
    check(ukTariffs.currency=="GBP" &&
          std::abs(*ukTariffs.estimate("M6",1000,1)-0.15)<.00001,
          "country-independent table parses per-class prices in non-EUR currency");
    RouteOptions heavy=paid; heavy.vehicleClass=4;
    check(route(toll,0,2,heavy)->tollEuros>tolled->tollEuros,
          "read real per-class tariff values, not hard-coded class multipliers");
    auto unknown=route(toll,0,2);
    check(unknown && unknown->tolledMeters>0 &&
          !unknown->tollPriceComplete && unknown->tollEuros==0,
          "missing country table is not a zero-cost toll route");
    check(routeJson(*unknown).find("\"tollEuros\":null")!=std::string::npos,
          "missing tariff MUST serialize as null, not fake free");
    check(unknown->tollRoads.size()==1 && !unknown->tollRoads[0].complete,
          "missing country tariffs still list the tolled motorway");
    const auto unknownJson=routeJson(*unknown);
    check(unknownJson.find("\"tollAmount\":null")!=std::string::npos &&
          unknownJson.find("\"pricing\":\"unavailable\"")!=std::string::npos,
          "per-road breakdown cannot invent unavailable charges");

    check(!sampleTariffs.estimate("A28",1000,1),
          "no fictional fallback euro/km rates for unpriced roads");
    rejects([&] { TollTariffs::parse(
      "# country=Portugal\n# currency=EUR\n# year=2026\n"
      "# source=test\nroad;section;km;class1;class2;class3;class4\n"
      "A5;test;10;1;2;3;4\n","Spain"); });
    check(!route(toll,0,2,avoid)->tolledMeters,
          "avoid tolls must still route without tolled edges");
    Graph profile(root + "/profile");
    check(route(profile, 0, 2, walk)->meters == 170, "walk access flags");
    check(normalize("Café São João") == "cafe sao joao", "accent folding");
    check(normalize("Cafe\xcc\x81") == "cafe", "combining marks");
    Search search(root + "/search/search-index.bin",
                  root + "/search/search-records.bin");
    auto result = search.query("cafe cen", {40, -8});
    check(result.size() == 1 && result[0].name() == "Café Central",
          "prefix search");
    check(search.nearestLocality({40,-8})=="Cidade Central",
          "offline geographic fallback identifies nearby named locality");
    auto near = search.nearby({40, -8}, 3000, "");
    check(near.size() == 2, "nearby excludes cities");
    check(search.nearby({40, -8}, 3000, "cafe").size() == 1, "category search");
    // A real moving eastbound driver in the middle of the first street
    // must not be routed from an unrelated/behind intersection or westbound.
    const Point realStart{40.0,-7.9995};
    const auto eastStart=graph.nearestDirected(realStart,Profile::drive,90,22);
    check(eastStart.has_value(),"eastbound GPS fixes select a directed road");
    check(eastStart->node==0,"eastbound road edge starts from the west");
    RouteOptions headed;
    headed.initialEdge=eastStart->edge;
    headed.initialSnap=eastStart->snapped;
    const auto eastRoute=route(graph,eastStart->node,2,headed);
    check(eastRoute.has_value(),"eastbound route remains connected");
    check(distance(eastRoute->points.front(),realStart)<5,
          "initial route geometry begins at CURRENT GPS projection");
    check(eastRoute->points.size()>=2 &&
          std::abs(std::remainder(bearing(eastRoute->points[0],
                                          eastRoute->points[1])-90.0,360.0))<30,
          "first route segment follows confirmed eastbound heading");
    const auto rerouteForward=routeFromPosition(
        graph,realStart,{40,-7.998},RouteOptions{},90.0);
    check(rerouteForward && distance(rerouteForward->points.front(),realStart)<5,
          "live reroute begins at GPS and follows the legal directed edge");
    // No reverse directed edge exists on this one-way fixture.
    const auto westStart=graph.nearestDirected(realStart,Profile::drive,270,22);
    check(!westStart,"missing westbound edge must not fake reverse travel");
    check(!routeFromPosition(graph,realStart,{40,-7.998},RouteOptions{},270.0),
          "known westbound heading must not silently fall back to eastbound nearest-node route");
    auto candidates=graph.destinationCandidates(
        {40,-7.999},Profile::drive,graph.component(0),300,12);
    check(!candidates.empty() && candidates.front()==1,
          "spatial lookup finds real reachable road access");
    check(graph.destinationCandidates(
        {37,-25},Profile::drive,graph.component(0),300,12).empty(),
          "disconnected airport service road is not a drivable destination");
    auto access=routeFromPosition(graph,{40,-8},{40.001,-7.9988},
        RouteOptions{},std::nullopt);
    check(access && access->destinationAccessMeters>1 &&
          access->destinationAccessMeters<400,
          "route terminates on road and exposes remaining gap to POI");
    Graph airport(root+"/access");
    const Point internalNode{40.0003,-7.9986};
    const auto closest=airport.nearest(internalNode,Profile::drive,200);
    check(closest && airport.component(*closest)==1,
          "the closest POI node is isolated in airport service graph");
    const auto roadside=routeFromPosition(airport,{40,-8},internalNode,
        RouteOptions{},std::nullopt);
    check(roadside && roadside->points.size()>=2 &&
          airport.component(roadside->nodes.back())==0 &&
          roadside->destinationAccessMeters>20.0 &&
          roadside->destinationAccessMeters<250.0,
          "POI routing bypasses disconnected internal node in favor of reachable road");
    // Confirmed heading must prefer an onward legal loop to an immediate
    // on-the-spot hairpin, without making dead ends unreachable.
    Graph forwardLoop(root + "/directional-loop");
    RouteOptions liveHeading;
    liveHeading.initialEdge=forwardLoop.offset(0);
    auto safeTurnaround=route(forwardLoop,0,4,liveHeading);
    check(safeTurnaround && safeTurnaround->nodes.size()>=4 &&
          safeTurnaround->nodes[2]==2,
          "live reroute favors forward junction over instant U-turn");
    Graph deadEnd(root + "/directional-dead-end");
    RouteOptions deadEndHeading;
    deadEndHeading.initialEdge=deadEnd.offset(0);
    auto fallback=route(deadEnd,0,4,deadEndHeading);
    check(fallback && fallback->nodes.size()==3 && fallback->nodes[1]==1,
          "dead-end driving route retains a last-resort legal U-turn");
    auto p = progress({40, -8}, *drive);
    check(p.along < 1 && p.remaining == drive->meters, "route progress origin");
    auto end = progress(drive->points.back(), *drive);
    check(end.remaining < 1, "route progress destination");
    // Repeated GNSS wander on the route while stationary must not create
    // progress, reduce ETA, or advance maneuver distance.
    GuidanceSession stationary;
    const auto parked = stationary.update(drive->points.front(), 12, 0, 100, *drive);
    const auto nextRoadPoint = drive->points[1];
    for (int i = 1; i <= 60; ++i) {
      const auto noise = stationary.update(nextRoadPoint, 12, 0,
                                           100 + i, *drive);
      check(std::abs(noise.position.along - parked.position.along) < .01 &&
                std::abs(noise.position.remaining - parked.position.remaining) < .01 &&
                std::abs(noise.position.toManeuver - parked.position.toManeuver) < .01,
            "stationary GNSS wander cannot advance native guidance");
    }
    // Once motion is independently confirmed, progress can resume.
    bool progressedAfterMovement = false;
    for (int i = 1; i <= 4; ++i) {
      auto movingFix = stationary.update(nextRoadPoint, 5, 8, 160 + i, *drive);
      progressedAfterMovement |= movingFix.position.along > parked.position.along + 1;
    }
    check(progressedAfterMovement, "confirmed motion unfreezes route progress");
    // Regression: a vehicle was travelling, then the receiver degraded for
    // several seconds, then a 5m-accuracy fix projected 76m farther along.
    // The previously known 8 m/s MUST NOT be used as current movement.
    GuidanceSession recoveredAccuracy;
    const auto beforeLoss = recoveredAccuracy.update(
        drive->points.front(), 5, 8, 300, *drive);
    for (int i = 1; i <= 8; ++i) {
      auto weak = recoveredAccuracy.update(
          drive->points[1], 100, 0, 300 + i, *drive);
      check(std::abs(weak.position.along-beforeLoss.position.along)<.01,
            "poor accuracy must hold old route progress");
    }
    auto stoppedReacquisition = recoveredAccuracy.update(
        drive->points[1], 5, 0, 309, *drive);
    check(std::abs(stoppedReacquisition.position.along-beforeLoss.position.along)<.01,
          "GPS reacquisition without motion cannot teleport route progress");
    bool restoredProgress=false;
    for (int n=0; n<3; ++n) {
      auto resumingTravel = recoveredAccuracy.update(
          drive->points[1], 5, 8, 310+n, *drive);
      restoredProgress |= resumingTravel.position.along>beforeLoss.position.along+1;
    }
    check(restoredProgress,
          "three consistent good fixes must restore progress after bad GPS");
    GuidanceSession recentlyStopped;
    auto cruising = recentlyStopped.update(drive->points.front(), 5, 8, 200, *drive);
    auto stopJitter = recentlyStopped.update(drive->points[1], 5, 0, 201, *drive);
    check(std::abs(stopJitter.position.along - cruising.position.along) < .01,
          "first stationary fix after driving must not advance progress");
    // Nearby parallel road/route-loop projections must not teleport progress.
    GuidanceSession continuity;
    auto established = continuity.update(drive->points.front(), 5, 1, 100, *drive);
    auto impossible = continuity.update(drive->points.back(), 5, 1, 101, *drive);
    check(impossible.state == Guidance::State::checking &&
              std::abs(impossible.position.along - established.position.along) < .01,
          "first precise but implausible projection is checking, and holds the cursor");
    auto repeated = continuity.update(drive->points.back(), 5, 1, 102, *drive);
    check(repeated.state == Guidance::State::checking &&
              std::abs(repeated.position.along - established.position.along) < .01,
          "second precise but implausible projection is checking and still holds cursor");
    auto confirmed = continuity.update(drive->points.back(), 5, 1, 103, *drive);
    check(confirmed.state == Guidance::State::arrived,
          "repeated stable destination fixes eventually allow arrival");
    GuidanceSession session;
    auto a = session.update(drive->points.back(), 5, 0, 1, *drive);
    check(a.state == Guidance::State::arrived, "arrival");
    session.reset();
    auto fresh = session.update(drive->points.front(), 5, 0, 10, *drive);
    auto stale = session.update(drive->points.back(), 5, 0, 9, *drive);
    check(stale.state == Guidance::State::reduced &&
              std::abs(stale.position.along - fresh.position.along) < .01,
          "stale fix cannot jump route progress");
    session.reset();
    auto reliable = session.update(drive->points.front(), 5, 0, 1, *drive);
    auto uncertain = session.update({40.01, -8}, 100, 0, 2, *drive);
    check(uncertain.state == Guidance::State::reduced &&
          std::abs(uncertain.position.along - reliable.position.along) < .01,
          "poor GPS holds reliable route progress");
    session.reset();
    auto onRoute = session.update(drive->points.front(), 5, 0, 1, *drive);
    auto dubious = session.update({40.01, -8}, 5, 12, 2, *drive);
    check(dubious.state == Guidance::State::checking &&
          std::abs(dubious.position.along - onRoute.position.along) < .01,
          "off-route candidate keeps last confirmed marker position");
    auto delayed = session.update(drive->points.back(), 5, 0, 1.5, *drive);
    check(delayed.state == Guidance::State::reduced &&
          std::abs(delayed.position.along - onRoute.position.along) < .01,
          "delayed fix cannot recover unconfirmed off-route candidate");
    auto recovered = session.update(drive->points.front(), 5, 0, 3, *drive);
    check(recovered.state == Guidance::State::normal,
          "valid on-route fix recovers from checking");
    session.reset();
    check(session.update({40.01, -8}, 100, 0, 1, *drive).state ==
              Guidance::State::reduced,
          "poor GPS does not reroute");
    check(session.update({40.01, -8}, 5, 10, 2, *drive).state ==
              Guidance::State::checking,
          "first offroute checks");
    check(session.update({40.01, -8}, 5, 10, 5, *drive).state ==
              Guidance::State::checking,
          "second offroute checks");
    check(session.update({40.01, -8}, 5, 10, 8, *drive).state ==
              Guidance::State::reroute,
          "sustained offroute reroutes");
    check(jsonString("a\"\nb") == "\"a\\\"\\u000ab\"", "JSON escaping");
    MotionFilter motion;
    auto resting = motion.update({{40, -8}, 10, 1, 3., 0.});
    check(resting.speed == 0 && !resting.moving,
          "raw speed cannot establish motion");
    auto moving = motion.update({{40.0001, -8}, 5, 4, 3., 0.});
    check(moving.moving && moving.speed == 3,
          "displacement corroborates speed");
    auto stopped = motion.update({{40.0001, -8}, 5, 9, 3., 0.});
    check(!stopped.moving && stopped.speed == 0,
          "stationary jitter stops prediction");
    MotionFilter noSpeed;
    auto initial = noSpeed.update({{40, -8}, 5, 1, std::nullopt, std::nullopt});
    check(!initial.moving && initial.speed == 0, "no initial movement");
    auto estimated = noSpeed.update({{40.0001, -8}, 5, 4,
                                     std::nullopt, std::nullopt});
    check(estimated.moving && estimated.speed > 1,
          "infer speed when provider has no speed");
    // Reacquiring accurate GPS after being stationary with a 20 m fix
    // must not permanently suppress genuine 1.5 m/s walking. Prior code
    // used half the POOR anchor accuracy (10 m), so five 1.5 m steps
    // were still reported as stopped despite good new GNSS observations.
    MotionFilter walkingResume;
    const Point footStart{40, -8};
    auto parkedWalker = walkingResume.update(
        {footStart, 20, 10, 0., 0.});
    check(!parkedWalker.moving, "walker initially stationary");
    for (int i = 1; i <= 4; ++i) {
      auto p = Point{40 + (1.5 * i) / 111320., -8};
      auto motion = walkingResume.update({p, 5, 10. + i, 1.5, 0.});
      if (i <= 3)
        check(!motion.moving, "walking fix must confirm travel before moving");
      else
        check(motion.moving && motion.speed > .45,
              "walking resumes after confirmed accurate displacement");
    }
    MotionFilter stationaryNoMovement;
    stationaryNoMovement.update({footStart, 20, 10, 0., 0.});
    for (int i = 1; i <= 30; ++i) {
      auto jitter = Point{40 + ((i % 3) - 1) * 2.5 / 111320., -8};
      auto motion = stationaryNoMovement.update(
          {jitter, 20, 10. + i, 0., 0.});
      check(!motion.moving && motion.speed == 0,
            "stationary poor-GPS wander cannot establish movement");
    }
    // A parked car's indoor fixes can wander steadily, including dozens of
    // metres along the planned road. Neither poor no-speed telemetry nor
    // inaccurate GPS reporting a plausible speed confirms vehicle motion.
    MotionFilter indoorWander;
    const Point indoorStart{40, -8};
    indoorWander.update({indoorStart, 70, 1, std::nullopt, std::nullopt});
    for (int i = 1; i <= 35; ++i) {
      const auto drift = Point{40 + i * 2.0 / 111320., -8};
      const auto estimate = indoorWander.update(
          {drift, 70, 1. + i, std::nullopt, std::nullopt});
      check(!estimate.moving && estimate.speed == 0,
            "missing-speed indoor GPS drift must not become driving");
    }
    MotionFilter poorSpeed;
    poorSpeed.update({indoorStart, 75, 1, 3., 0.});
    for (int i = 1; i <= 35; ++i) {
      const auto drift = Point{40 + i * 3.0 / 111320., -8};
      const auto estimate = poorSpeed.update({drift, 65, 1. + i, 3., 0.});
      check(!estimate.moving && estimate.speed == 0,
            "poor GPS and reported speed cannot initialize phantom driving");
    }
    // Even accurately spaced GNSS fixes with provider speed zero must not
    // cause navigation progress when the receiver reports a stop.
    MotionFilter reportedStop;
    reportedStop.update({indoorStart, 5, 1, 0., 0.});
    for (int i = 1; i <= 6; ++i) {
      const auto point = Point{40 + i * 6.0 / 111320., -8};
      const auto estimate = reportedStop.update({point, 5, 1. + i, 0., 0.});
      check(!estimate.moving && estimate.speed == 0,
            "provider stop must veto inferred speed from drifting fixes");
    }
    // The speed filter and the native route-progress filter must agree.
    Route footRoute;
    footRoute.points = {footStart, {40.0002, -8}};
    footRoute.meters = distance(footRoute.points[0], footRoute.points[1]);
    footRoute.seconds = footRoute.meters / 1.5;
    GuidanceSession walkingGuidance;
    MotionFilter walkingSpeed;
    walkingGuidance.update(footStart, 20, 0, 10, footRoute);
    walkingSpeed.update({footStart, 20, 10, 0., 0.});
    double resumedAlong = 0;
    for (int i = 1; i <= 5; ++i) {
      auto p = Point{40 + (1.5 * i) / 111320., -8};
      auto motion = walkingSpeed.update({p, 5, 10. + i, 1.5, 0.});
      auto guidance = walkingGuidance.update(
          p, 5, motion.speed, 10. + i, footRoute);
      resumedAlong = guidance.position.along;
    }
    check(resumedAlong > 1.,
          "native guidance must advance once walking is confirmed");
    // A* route alternatives must change actual edges, not just labels.
    RouteOptions diverse;
    diverse.sharedEdgePenaltySecondsPerKm = 600.0;
    diverse.discouragedEdges.insert(drive->edges.begin(),drive->edges.end());
    auto otherCorridor = route(graph,0,2,diverse);
    check(otherCorridor && otherCorridor->edges != drive->edges,
          "overlap penalty chooses a distinct legal corridor");
    check(otherCorridor->seconds > drive->seconds,
          "route search penalties must NOT contaminate actual ETA");
    RouteOptions noDiversity;
    noDiversity.discouragedEdges=diverse.discouragedEdges;
    check(route(graph,0,2,noDiversity)->edges == drive->edges,
          "zero diversity penalty retains the real fastest route");
    Route named;
    named.meters=110000;
    Leg firstRoad{}; firstRoad.distance=26000;firstRoad.road.ref="A8";
    Leg secondRoad{};secondRoad.distance=16000;secondRoad.road.ref="IC17";
    Leg thirdRoad{};thirdRoad.distance=51000;thirdRoad.road.ref="A5; EN 9-2";
    Leg lastRoad{};lastRoad.distance=13000;lastRoad.road.ref="EN360";
    named.legs={firstRoad,secondRoad,thirdRoad,lastRoad};
    const auto names=principalRoadRefs(named);
    check(names.size()==4 && names[0]=="A8" && names[1]=="IC17" &&
          names[2]=="A5" && names[3]=="EN9-2",
          "brief signed motorway/IC/national references remain in travel order");
    check(routeJson(named).find("\"mainRoads\":[")!=std::string::npos,
          "main road references are serialized for Kotlin");
    auto originalSeconds = drive->seconds;
    calibrateDriveEta(*drive, graph);
    check(drive->seconds > originalSeconds,
          "drive ETA conservatively calibrated");
    check(carHeading(359, 1, 10, 5, 0) > 350 ||
              carHeading(359, 1, 10, 5, 0) < 10,
          "heading blends across north");
    auto bad = std::filesystem::path(root) / "bad";
    std::filesystem::remove_all(bad);
    std::filesystem::copy(root + "/basic", bad,
                          std::filesystem::copy_options::recursive);
    {
      std::fstream f(bad / "edges.bin",
                     std::ios::in | std::ios::out | std::ios::binary);
      f.seekp(20);
      char bytes[4] = {1, 0, 0, 0};
      f.write(bytes, 4);
    }
    rejects([&] { Graph broken(bad.string()); });
    std::filesystem::remove_all(bad);
    std::cout << "Native routing, search, binary validation and guidance tests "
                 "passed\n";
  } catch (const std::exception &e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}

