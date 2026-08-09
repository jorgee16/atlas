#pragma once

#include "roam/road-graph.hpp"

#include <filesystem>
#include <string>

namespace roam {

class RoutingWriter {
public:
  static constexpr double spatialCellSizeDegrees =
    0.005;

  static void write(
    const std::string& region,
    RoadGraph graph,
    const std::filesystem::path& outputDirectory
  );
};

}
