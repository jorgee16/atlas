#pragma once

#include "roam/poi.hpp"

#include <filesystem>
#include <vector>

namespace roam {

class SpatialIndex {
public:
  static void write(
    const std::vector<Poi>& pois,
    const std::filesystem::path& output,
    double cellSizeDegrees = 0.01
  );
};

}
