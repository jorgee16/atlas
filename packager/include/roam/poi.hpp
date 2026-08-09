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
  std::string place;
  std::string altName;
  std::string shortName;
  std::string officialName;
  std::string localName;
  std::string portugueseName;
  std::string englishName;
  std::string municipality;
  std::string district;
  std::string postcode;
  bool searchOnly {};
};

}
