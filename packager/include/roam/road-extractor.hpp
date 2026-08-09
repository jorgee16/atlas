#pragma once

#include "roam/road-graph.hpp"

#include <filesystem>

namespace roam {

class RoadExtractor {
public:
  RoadGraph extract(
    const std::filesystem::path& osmPath
  ) const;
};

}
