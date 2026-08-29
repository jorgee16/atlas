#include "roam/toll-point-extractor.hpp"

#include <osmium/io/any_input.hpp>
#include <osmium/visitor.hpp>

#include <string>
#include <string_view>
#include <unordered_map>
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

class NodeHandler final : public osmium::handler::Handler {
public:
  explicit NodeHandler(std::vector<TollPoint>& points)
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

class WayEnrichmentHandler final : public osmium::handler::Handler {
public:
  explicit WayEnrichmentHandler(
    std::vector<TollPoint>& points
  ) : points_(points) {
    for (std::size_t index = 0; index < points_.size(); ++index) {
      indexes_.insert_or_assign(points_[index].osmId, index);
    }
  }

  void way(const osmium::Way& way) {
    const auto wayRef = tagValue(way.tags(), "ref");
    const auto wayName = tagValue(way.tags(), "name");
    const auto wayOperator = tagValue(way.tags(), "operator");

    for (const auto& node : way.nodes()) {
      const auto found = indexes_.find(node.ref());
      if (found == indexes_.end()) {
        continue;
      }

      auto& point = points_[found->second];

      // Toll nodes frequently carry only barrier/highway tags while the
      // containing motorway way carries the useful Axx reference. Preserve
      // explicit node metadata and fill only missing fields from the way.
      if (point.roadReference.empty() && !wayRef.empty()) {
        point.roadReference = wayRef;
      }
      if (point.name.empty() && !wayName.empty()) {
        point.name = wayName;
      }
      if (point.operatorName.empty() && !wayOperator.empty()) {
        point.operatorName = wayOperator;
      }
    }
  }

private:
  std::vector<TollPoint>& points_;
  std::unordered_map<std::int64_t, std::size_t> indexes_;
};

}

std::vector<TollPoint> TollPointExtractor::extract(
  const std::filesystem::path& osmPath
) const {
  std::vector<TollPoint> points;
  NodeHandler nodeHandler {points};

  osmium::io::Reader nodeReader {
    osmPath.string(),
    osmium::osm_entity_bits::node
  };

  osmium::apply(nodeReader, nodeHandler);
  nodeReader.close();

  if (!points.empty()) {
    WayEnrichmentHandler wayHandler {points};

    osmium::io::Reader wayReader {
      osmPath.string(),
      osmium::osm_entity_bits::way
    };

    osmium::apply(wayReader, wayHandler);
    wayReader.close();
  }

  return points;
}

}
