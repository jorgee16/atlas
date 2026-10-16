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
    GuidanceSession session;
    auto a = session.update(drive->points.back(), 5, 0, 1, *drive);
    check(a.state == Guidance::State::arrived, "arrival");
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
