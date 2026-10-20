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
