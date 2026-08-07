#pragma once

#include "roam/poi.hpp"

#include <filesystem>
#include <vector>

namespace roam {

class PoiExtractor {
public:
  std::vector<Poi> extract(
    const std::filesystem::path& pbfPath
  ) const;
};

}
