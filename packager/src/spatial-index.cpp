#include "roam/spatial-index.hpp"

#include <nlohmann/json.hpp>

#include <cmath>
#include <fstream>
#include <map>
#include <string>
#include <vector>

namespace roam {

void SpatialIndex::write(
  const std::vector<Poi>& pois,
  const std::filesystem::path& output,
  const double cellSizeDegrees
) {
  std::map<
    std::string,
    std::vector<std::size_t>
  > cells;

  for (
    std::size_t i = 0;
    i < pois.size();
    ++i
  ) {
    const auto& poi =
      pois[i];

    const auto x =
      static_cast<long long>(
        std::floor(
          poi.lon /
          cellSizeDegrees
        )
      );

    const auto y =
      static_cast<long long>(
        std::floor(
          poi.lat /
          cellSizeDegrees
        )
      );

    const auto key =
      std::to_string(x) +
      ":" +
      std::to_string(y);

    cells[key].push_back(i);
  }

  nlohmann::json document;

  document["kind"] =
    "uniform-grid";

  document["cellSizeDegrees"] =
    cellSizeDegrees;

  document["cells"] =
    cells;

  std::ofstream stream {
    output
  };

  stream
    << document.dump(2)
    << '\n';
}

}
