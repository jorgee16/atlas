#include "roam/poi-extractor.hpp"
#include "roam/spatial-index.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace fs = std::filesystem;

namespace {

void writeGeoJson(
  const std::vector<roam::Poi>& pois,
  const fs::path& output
) {
  nlohmann::json document;

  document["type"] =
    "FeatureCollection";

  document["features"] =
    nlohmann::json::array();

  for (const auto& poi : pois) {
    nlohmann::json feature;

    feature["type"] =
      "Feature";

    feature["id"] =
      poi.id;

    feature["geometry"] = {
      {"type", "Point"},
      {
        "coordinates",
        {
          poi.lon,
          poi.lat
        }
      }
    };

    feature["properties"] = {
      {"name", poi.name},
      {"amenity", poi.amenity},
      {"type", poi.type}
    };

    document["features"]
      .push_back(
        std::move(feature)
      );
  }

  std::ofstream stream {
    output
  };

  stream
    << document.dump()
    << '\n';
}

void writeMetadata(
  const std::string& region,
  const std::vector<roam::Poi>& pois,
  const fs::path& output
) {
  nlohmann::json metadata = {
    {"id", region},
    {"poiCount", pois.size()},
    {"version", 1}
  };

  std::ofstream stream {
    output
  };

  stream
    << metadata.dump(2)
    << '\n';
}

}

int main(
  int argc,
  char** argv
) {
  try {
    if (argc != 4) {
      std::cerr
        << "Usage:\n"
        << "  roam-packager pack "
        << "<region-id> "
        << "<input.osm.pbf>\n";

      return 1;
    }

    const std::string command =
      argv[1];

    if (command != "pack") {
      throw std::runtime_error(
        "Unknown command: " +
        command
      );
    }

    const std::string region =
      argv[2];

    const fs::path input =
      argv[3];

    if (!fs::exists(input)) {
      throw std::runtime_error(
        "Input PBF does not exist."
      );
    }

    const fs::path output =
      fs::path("build") /
      region;

    fs::create_directories(
      output
    );

    std::cout
      << "Reading "
      << input
      << "...\n";

    roam::PoiExtractor extractor;

    const auto pois =
      extractor.extract(input);

    std::cout
      << "Extracted "
      << pois.size()
      << " POIs\n";

    writeGeoJson(
      pois,
      output / "pois.geojson"
    );

    roam::SpatialIndex::write(
      pois,
      output / "poi-index.json"
    );

    writeMetadata(
      region,
      pois,
      output / "metadata.json"
    );

    std::cout
      << "\nRegion package created:\n"
      << output
      << '\n';

    return 0;
  }
  catch (
    const std::exception& error
  ) {
    std::cerr
      << "roam-packager: "
      << error.what()
      << '\n';

    return 1;
  }
}
