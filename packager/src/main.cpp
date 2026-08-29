#include "roam/poi-extractor.hpp"
#include "roam/road-extractor.hpp"
#include "roam/routing-writer.hpp"
#include "roam/spatial-index.hpp"
#include "roam/toll-point-extractor.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

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

    auto& properties =
      feature["properties"];

    const auto addIfPresent = [
      &properties
    ](
      const char* key,
      const std::string& value
    ) {
      if (!value.empty()) {
        properties[key] = value;
      }
    };

    addIfPresent("place", poi.place);
    addIfPresent("alt_name", poi.altName);
    addIfPresent("short_name", poi.shortName);
    addIfPresent("official_name", poi.officialName);
    addIfPresent("loc_name", poi.localName);
    addIfPresent("name:pt", poi.portugueseName);
    addIfPresent("name:en", poi.englishName);
    addIfPresent("municipality", poi.municipality);
    addIfPresent("district", poi.district);
    addIfPresent("postal_code", poi.postcode);

    if (poi.searchOnly) {
      properties["search_only"] = true;
    }

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
  bool routingIncluded,
  const fs::path& output
) {
  nlohmann::json metadata = {
    {"id", region},
    {"poiCount", pois.size()},
    {"version", 2},
    {
      "routing",
      {
        {"included", routingIncluded},
        {"profile", "car"},
        {"directory", "routing"}
      }
    }
  };

  std::ofstream stream {
    output
  };

  stream
    << metadata.dump(2)
    << '\n';
}

std::vector<roam::Poi> writePois(
  const fs::path& input,
  const fs::path& output
) {
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

  return pois;
}

void writeTollPoints(
  const fs::path& input,
  const fs::path& output
) {
  roam::TollPointExtractor extractor;
  const auto points = extractor.extract(input);

  nlohmann::json document;
  document["version"] = 1;
  document["points"] = nlohmann::json::array();

  for (const auto& point : points) {
    document["points"].push_back({
      {"osmId", point.osmId},
      {"lat", point.lat},
      {"lon", point.lon},
      {"name", point.name},
      {"ref", point.reference},
      {"operator", point.operatorName},
      {"roadRef", point.roadReference},
      {"kind", point.kind},
      {"electronic", point.electronic}
    });
  }

  std::ofstream stream {
    output / "toll-points.json"
  };

  stream
    << document.dump(2)
    << '\n';

  std::cout
    << "Extracted "
    << points.size()
    << " OSM toll points\n";
}

void writeRouting(
  const std::string& region,
  const fs::path& input,
  const fs::path& output
) {
  roam::RoadExtractor extractor;

  auto graph =
    extractor.extract(input);

  std::cout
    << "Extracted "
    << graph.nodes.size()
    << " topology nodes, "
    << graph.edges.size()
    << " directed road edges, "
    << graph.roads.size()
    << " named road records, "
    << graph.turnRestrictions.size()
    << " turn restrictions, and "
    << graph.geometryPoints.size()
    << " retained geometry points\n";

  roam::RoutingWriter::write(
    region,
    std::move(graph),
    output / "routing"
  );

  writeTollPoints(
    input,
    output / "routing"
  );
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
        << "<input.osm.pbf>\n"
        << "  roam-packager pack-pois "
        << "<region-id> "
        << "<input.osm.pbf>\n"
        << "  roam-packager pack-routing "
        << "<region-id> "
        << "<input.osm.pbf>\n";

      return 1;
    }

    const std::string command =
      argv[1];

    if (
      command != "pack" &&
      command != "pack-pois" &&
      command != "pack-routing"
    ) {
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

    std::vector<roam::Poi> pois;

    if (
      command == "pack" ||
      command == "pack-pois"
    ) {
      pois = writePois(
        input,
        output
      );
    }

    if (
      command == "pack" ||
      command == "pack-routing"
    ) {
      writeRouting(
        region,
        input,
        output
      );
    }

    if (command != "pack-routing") {
      writeMetadata(
        region,
        pois,
        command == "pack",
        output / "metadata.json"
      );
    }

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
