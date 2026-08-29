#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace roam {

struct TollPoint {
  std::int64_t osmId = 0;
  double lat = 0.0;
  double lon = 0.0;
  std::string name;
  std::string reference;
  std::string operatorName;
  std::string roadReference;
  std::string kind;
  bool electronic = false;
};

class TollPointExtractor {
public:
  std::vector<TollPoint> extract(
    const std::filesystem::path& osmPath
  ) const;
};

}
