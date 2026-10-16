#include "atlas/core.hpp"
#include <iostream>
int main(int argc, char **argv) {
  try {
    if (argc < 4) {
      std::cerr << "Usage: atlas_route GRAPH_DIRECTORY START_NODE GOAL_NODE "
                   "[walk|drive] [avoid-tolls]\n";
      return 2;
    }
    atlas::Graph graph(argv[1]);
    atlas::RouteOptions options;
    if (argc > 4)
      options.profile = std::string(argv[4]) == "walk" ? atlas::Profile::walk
                                                       : atlas::Profile::drive;
    if (argc > 5)
      options.avoidTolls = std::string(argv[5]) == "avoid-tolls";
    auto r = atlas::route(graph, uint32_t(std::stoul(argv[2])),
                          uint32_t(std::stoul(argv[3])), options);
    std::cout << (r ? atlas::routeJson(*r) : "null") << '\n';
    return 0;
  } catch (const std::exception &e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
