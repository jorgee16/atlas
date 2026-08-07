#pragma once

#include <cstdint>
#include <string>

namespace roam {

struct Poi {
  std::int64_t id {};

  double lat {};
  double lon {};

  std::string name;
  std::string amenity;
  std::string type;
};

}
