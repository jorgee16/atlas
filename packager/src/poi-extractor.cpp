#include "roam/poi-extractor.hpp"

#include <osmium/handler.hpp>
#include <osmium/io/any_input.hpp>
#include <osmium/visitor.hpp>

#include <string_view>

namespace roam {

namespace {

std::string classify(
  std::string_view amenity,
  std::string_view tourism,
  std::string_view leisure,
  std::string_view historic
) {
  if (
    amenity == "cafe" ||
    amenity == "coffee_shop" ||
    amenity == "ice_cream"
  ) {
    return "cafe";
  }

  if (
    amenity == "restaurant" ||
    amenity == "fast_food" ||
    amenity == "food_court"
  ) {
    return "restaurant";
  }

  if (
    amenity == "pub" ||
    amenity == "bar"
  ) {
    return "pub";
  }

  if (
    !tourism.empty() ||
    !historic.empty() ||
    amenity == "theatre" ||
    amenity == "cinema" ||
    amenity == "arts_centre" ||
    leisure == "park" ||
    leisure == "garden" ||
    leisure == "nature_reserve"
  ) {
    return "attraction";
  }

  return {};
}

class PoiHandler final :
  public osmium::handler::Handler {
public:
  explicit PoiHandler(
    std::vector<Poi>& output
  )
    : output_(output) {
  }

  void node(
    const osmium::Node& node
  ) {
    if (!node.location().valid()) {
      return;
    }

    const char* name =
      node.tags()["name"];

    if (!name) {
      return;
    }

    const char* amenityRaw =
      node.tags()["amenity"];

    const char* tourismRaw =
      node.tags()["tourism"];

    const char* leisureRaw =
      node.tags()["leisure"];

    const char* historicRaw =
      node.tags()["historic"];

    const std::string_view amenity =
      amenityRaw
        ? amenityRaw
        : "";

    const std::string_view tourism =
      tourismRaw
        ? tourismRaw
        : "";

    const std::string_view leisure =
      leisureRaw
        ? leisureRaw
        : "";

    const std::string_view historic =
      historicRaw
        ? historicRaw
        : "";

    const auto type =
      classify(
        amenity,
        tourism,
        leisure,
        historic
      );

    if (type.empty()) {
      return;
    }

    Poi poi;

    poi.id = node.id();
    poi.lat = node.location().lat();
    poi.lon = node.location().lon();

    poi.name = name;
    poi.amenity =
      !amenity.empty()
        ? std::string(amenity)
        : !tourism.empty()
          ? std::string(tourism)
          : !leisure.empty()
            ? std::string(leisure)
            : std::string(historic);

    poi.type = type;

    output_.push_back(
      std::move(poi)
    );
  }

private:
  std::vector<Poi>& output_;
};

}

std::vector<Poi>
PoiExtractor::extract(
  const std::filesystem::path& pbfPath
) const {
  std::vector<Poi> pois;

  osmium::io::Reader reader {
    pbfPath.string(),
    osmium::osm_entity_bits::node
  };

  PoiHandler handler {pois};

  osmium::apply(
    reader,
    handler
  );

  reader.close();

  return pois;
}

}
