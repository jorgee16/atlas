#include "roam/toll-point-extractor.hpp"

#include <osmium/io/any_input.hpp>
#include <osmium/visitor.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace roam {

namespace {

std::string tagValue(
  const osmium::TagList& tags,
  const char* key
) {
  const char* value = tags[key];
  return value ? value : "";
}

bool truthy(std::string_view value) {
  return value == "yes" ||
    value == "true" ||
    value == "1" ||
    value == "designated";
}

bool electronic(const osmium::TagList& tags) {
  for (const char* key : {
    "toll:electronic",
    "payment:electronic_toll_collection"
  }) {
    if (const char* raw = tags[key]) {
      if (truthy(std::string_view {raw})) {
        return true;
      }
    }
  }
  return false;
}

std::string roadReference(const osmium::TagList& tags) {
  for (const char* key : {
    "road_ref",
    "road:ref",
    "ref"
  }) {
    if (const char* raw = tags[key]) {
      return raw;
    }
  }
  return {};
}

std::string kindFor(const osmium::TagList& tags) {
  const std::string_view barrier =
    tags["barrier"] ? tags["barrier"] : "";
  const std::string_view highway =
    tags["highway"] ? tags["highway"] : "";

  if (barrier == "toll_booth") return "toll_booth";
  if (highway == "toll_gantry") return "toll_gantry";
  if (barrier == "toll_gantry") return "toll_gantry";
  return {};
}

class Handler final : public osmium::handler::Handler {
public:
  explicit Handler(std::vector<TollPoint>& points)
    : points_(points) {
  }

  void node(const osmium::Node& node) {
    if (!node.location().valid()) {
      return;
    }

    const auto kind = kindFor(node.tags());
    if (kind.empty()) {
      return;
    }

    points_.push_back({
      node.id(),
      node.location().lat(),
      node.location().lon(),
      tagValue(node.tags(), "name"),
      tagValue(node.tags(), "ref"),
      tagValue(node.tags(), "operator"),
      roadReference(node.tags()),
      kind,
      electronic(node.tags())
    });
  }

private:
  std::vector<TollPoint>& points_;
};

}

std::vector<TollPoint> TollPointExtractor::extract(
  const std::filesystem::path& osmPath
) const {
  std::vector<TollPoint> points;
  Handler handler {points};

  osmium::io::Reader reader {
    osmPath.string(),
    osmium::osm_entity_bits::node
  };

  osmium::apply(reader, handler);
  reader.close();

  return points;
}

}
