#include "atlas/core.hpp"
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
    check(route(toll, 0, 2)->tollEuros > 0, "toll estimate");
    Graph profile(root + "/profile");
    check(route(profile, 0, 2, walk)->meters == 170, "walk access flags");
    check(normalize("Café São João") == "cafe sao joao", "accent folding");
    check(normalize("Cafe\xcc\x81") == "cafe", "combining marks");
    Search search(root + "/search/search-index.bin",
                  root + "/search/search-records.bin");
    auto result = search.query("cafe cen", {40, -8});
    check(result.size() == 1 && result[0].name() == "Café Central",
          "prefix search");
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
    check(impossible.state == Guidance::State::reduced &&
              std::abs(impossible.position.along - established.position.along) < .01,
          "first implausible projection holds the cursor");
    auto repeated = continuity.update(drive->points.back(), 5, 1, 102, *drive);
    check(repeated.state == Guidance::State::reduced &&
              std::abs(repeated.position.along - established.position.along) < .01,
          "second implausible projection still holds the cursor");
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
