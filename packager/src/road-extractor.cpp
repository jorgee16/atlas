#include "roam/road-extractor.hpp"

#include <osmium/handler/node_locations_for_ways.hpp>
#include <osmium/index/map/flex_mem.hpp>
#include <osmium/io/any_input.hpp>
#include <osmium/visitor.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace roam {

namespace {

constexpr double earthRadiusMeters =
  6'371'000.0;

constexpr double pi =
  3.14159265358979323846;

// Keep A* vertices close enough for practical endpoint snapping while still
// contracting the much denser OSM shape-point geometry.
constexpr double maximumTopologySegmentMeters =
  200.0;

// Two metres preserves visible road shape at street zoom while removing
// redundant survey points from the route geometry asset.
constexpr double geometryToleranceMeters =
  2.0;

struct RoadProfile {
  RoadClass roadClass;
  double defaultSpeedKmh;
  bool driveByDefault;
  bool walkByDefault;
};

enum class OneWayDirection {
  both,
  forward,
  reverse
};

std::string tagValue(
  const osmium::TagList& tags,
  const char* key
) {
  const char* value = tags[key];
  return value ? value : "";
}


bool isTruthyTagValue(std::string_view value) {
  return (
    value == "yes" ||
    value == "true" ||
    value == "1" ||
    value == "designated"
  );
}

bool isTolledForCars(const osmium::TagList& tags) {
  for (const char* key : {
    "toll:motorcar",
    "toll:motor_vehicle",
    "toll:vehicle",
    "toll"
  }) {
    if (const char* raw = tags[key]) {
      const std::string_view value {raw};
      if (isTruthyTagValue(value)) {
        return true;
      }
      if (value == "no" || value == "false" || value == "0") {
        return false;
      }
    }
  }
  return false;
}

bool isElectronicToll(const osmium::TagList& tags) {
  for (const char* key : {
    "toll:electronic",
    "payment:electronic_toll_collection"
  }) {
    if (const char* raw = tags[key]) {
      if (isTruthyTagValue(std::string_view {raw})) {
        return true;
      }
    }
  }
  return false;
}

std::optional<std::string_view>
restrictionValue(
  const osmium::TagList& tags
) {
  for (const char* key : {
    "restriction:motorcar",
    "restriction:motor_vehicle",
    "restriction:vehicle",
    "restriction"
  }) {
    if (const char* value = tags[key]) {
      return std::string_view {value};
    }
  }

  return std::nullopt;
}

bool exceptsCars(
  const osmium::TagList& tags
) {
  const char* raw = tags["except"];

  if (!raw) {
    return false;
  }

  const std::string_view value {raw};

  return (
    value.find("motorcar") !=
      std::string_view::npos ||
    value.find("motor_vehicle") !=
      std::string_view::npos ||
    value.find("vehicle") !=
      std::string_view::npos
  );
}

bool isCarRestriction(
  const osmium::Relation& relation
) {
  const char* type = relation.tags()["type"];

  return (
    type &&
    std::string_view {type} == "restriction" &&
    restrictionValue(relation.tags()).has_value() &&
    !exceptsCars(relation.tags())
  );
}

double toRadians(double degrees) {
  return degrees * pi / 180.0;
}

double distanceMeters(
  double fromLat,
  double fromLon,
  double toLat,
  double toLon
) {
  const double fromLatitude =
    toRadians(fromLat);

  const double toLatitude =
    toRadians(toLat);

  const double deltaLatitude =
    toRadians(toLat - fromLat);

  const double deltaLongitude =
    toRadians(toLon - fromLon);

  const double a =
    std::sin(deltaLatitude / 2.0) *
      std::sin(deltaLatitude / 2.0) +
    std::cos(fromLatitude) *
      std::cos(toLatitude) *
      std::sin(deltaLongitude / 2.0) *
      std::sin(deltaLongitude / 2.0);

  return earthRadiusMeters *
    2.0 *
    std::atan2(
      std::sqrt(a),
      std::sqrt(1.0 - a)
    );
}

std::optional<RoadProfile>
profileForHighway(
  std::string_view highway
) {
  if (highway == "motorway") {
    return RoadProfile {
      RoadClass::motorway,
      110.0,
      true,
      false
    };
  }

  if (highway == "motorway_link") {
    return RoadProfile {
      RoadClass::motorway,
      60.0,
      true,
      false
    };
  }

  if (highway == "trunk") {
    return RoadProfile {
      RoadClass::trunk,
      100.0,
      true,
      false
    };
  }

  if (highway == "trunk_link") {
    return RoadProfile {
      RoadClass::trunk,
      60.0,
      true,
      false
    };
  }

  if (highway == "primary") {
    return RoadProfile {
      RoadClass::primary,
      80.0,
      true,
      true
    };
  }

  if (highway == "primary_link") {
    return RoadProfile {
      RoadClass::primary,
      50.0,
      true,
      true
    };
  }

  if (highway == "secondary") {
    return RoadProfile {
      RoadClass::secondary,
      70.0,
      true,
      true
    };
  }

  if (highway == "secondary_link") {
    return RoadProfile {
      RoadClass::secondary,
      50.0,
      true,
      true
    };
  }

  if (highway == "tertiary") {
    return RoadProfile {
      RoadClass::tertiary,
      60.0,
      true,
      true
    };
  }

  if (highway == "tertiary_link") {
    return RoadProfile {
      RoadClass::tertiary,
      40.0,
      true,
      true
    };
  }

  if (
    highway == "residential" ||
    highway == "living_street"
  ) {
    return RoadProfile {
      RoadClass::residential,
      highway == "living_street"
        ? 10.0
        : 30.0,
      true,
      true
    };
  }

  if (highway == "service") {
    return RoadProfile {
      RoadClass::service,
      20.0,
      true,
      true
    };
  }

  if (
    highway == "unclassified" ||
    highway == "road"
  ) {
    return RoadProfile {
      RoadClass::other,
      highway == "unclassified"
        ? 50.0
        : 30.0,
      true,
      true
    };
  }

  if (highway == "track") {
    return RoadProfile {
      RoadClass::track,
      15.0,
      false,
      true
    };
  }

  if (
    highway == "footway" ||
    highway == "path" ||
    highway == "pedestrian" ||
    highway == "steps"
  ) {
    return RoadProfile {
      RoadClass::other,
      5.0,
      false,
      true
    };
  }

  return std::nullopt;
}

bool isDeniedAccess(
  std::string_view value
) {
  return (
    value == "no" ||
    value == "private" ||
    value == "agricultural" ||
    value == "forestry"
  );
}

bool permitsMotorVehicle(
  const osmium::TagList& tags
) {
  const char* motorcar =
    tags["motorcar"];

  if (motorcar) {
    return !isDeniedAccess(motorcar);
  }

  const char* motorVehicle =
    tags["motor_vehicle"];

  if (motorVehicle) {
    return !isDeniedAccess(motorVehicle);
  }

  const char* vehicle =
    tags["vehicle"];

  if (vehicle) {
    return !isDeniedAccess(vehicle);
  }

  const char* access =
    tags["access"];

  return !access ||
    !isDeniedAccess(access);
}

bool permitsFoot(
  const osmium::TagList& tags
) {
  const char* foot = tags["foot"];

  if (foot) {
    return !isDeniedAccess(foot);
  }

  const char* access = tags["access"];

  return !access || !isDeniedAccess(access);
}

bool permitsServiceRoad(
  const osmium::TagList& tags,
  std::string_view highway
) {
  if (highway != "service") {
    return true;
  }

  const char* serviceRaw =
    tags["service"];

  if (!serviceRaw) {
    return true;
  }

  const std::string_view service {
    serviceRaw
  };

  // Parking aisles and individual driveways dominate graph size without
  // materially helping point-to-point road navigation in the first profile.
  return (
    service != "parking_aisle" &&
    service != "driveway"
  );
}

std::optional<RoadProfile>
profileForWay(
  const osmium::Way& way
) {
  const char* highwayRaw =
    way.tags()["highway"];

  if (!highwayRaw) {
    return std::nullopt;
  }

  const std::string_view highway {
    highwayRaw
  };

  auto profile =
    profileForHighway(highway);

  if (!profile) {
    return std::nullopt;
  }

  profile->driveByDefault =
    profile->driveByDefault &&
    permitsMotorVehicle(way.tags()) &&
    permitsServiceRoad(
      way.tags(),
      highway
    );

  profile->walkByDefault =
    profile->walkByDefault &&
    permitsFoot(way.tags());

  if (
    !profile->driveByDefault &&
    !profile->walkByDefault
  ) {
    return std::nullopt;
  }

  return profile;
}

double parseSpeedKmh(
  const char* maxSpeed,
  double fallback
) {
  if (!maxSpeed) {
    return fallback;
  }

  char* end = nullptr;

  const double value =
    std::strtod(maxSpeed, &end);

  if (
    end == maxSpeed ||
    !std::isfinite(value) ||
    value <= 0.0
  ) {
    return fallback;
  }

  std::string_view suffix {end};

  const double speedKmh =
    suffix.find("mph") !=
      std::string_view::npos
      ? value * 1.609344
      : value;

  return std::clamp(
    speedKmh,
    5.0,
    130.0
  );
}

OneWayDirection oneWayDirection(
  const osmium::TagList& tags,
  std::string_view highway
) {
  const char* oneWayRaw =
    tags["oneway"];

  if (oneWayRaw) {
    const std::string_view oneWay {
      oneWayRaw
    };

    if (oneWay == "-1" || oneWay == "reverse") {
      return OneWayDirection::reverse;
    }

    if (
      oneWay == "yes" ||
      oneWay == "1" ||
      oneWay == "true"
    ) {
      return OneWayDirection::forward;
    }

    if (
      oneWay == "no" ||
      oneWay == "0" ||
      oneWay == "false"
    ) {
      return OneWayDirection::both;
    }
  }

  const char* junctionRaw =
    tags["junction"];

  const std::string_view junction =
    junctionRaw
      ? junctionRaw
      : "";

  if (
    highway == "motorway" ||
    highway == "motorway_link" ||
    junction == "roundabout" ||
    junction == "circular"
  ) {
    return OneWayDirection::forward;
  }

  return OneWayDirection::both;
}

OneWayDirection footDirection(
  const osmium::TagList& tags
) {
  const char* raw = tags["oneway:foot"];

  if (!raw) {
    return OneWayDirection::both;
  }

  const std::string_view value {raw};

  if (value == "-1" || value == "reverse") {
    return OneWayDirection::reverse;
  }

  if (
    value == "yes" || value == "1" ||
    value == "true"
  ) {
    return OneWayDirection::forward;
  }

  return OneWayDirection::both;
}

bool allowsDirection(
  OneWayDirection direction,
  bool forward
) {
  return direction == OneWayDirection::both ||
    (forward
      ? direction == OneWayDirection::forward
      : direction == OneWayDirection::reverse);
}

class AnchorReferenceHandler final :
  public osmium::handler::Handler {
public:
  explicit AnchorReferenceHandler(
    std::vector<osmium::object_id_type>&
      references
  )
    : references_(references) {
  }

  void way(const osmium::Way& way) {
    if (!profileForWay(way)) {
      return;
    }

    const auto& nodes = way.nodes();

    if (nodes.size() < 2) {
      return;
    }

    for (const auto& node : nodes) {
      references_.push_back(node.ref());
    }

    // A second occurrence makes every way endpoint an anchor. Shared nodes
    // naturally become anchors because they occur in multiple accepted ways.
    references_.push_back(
      nodes.front().ref()
    );

    references_.push_back(
      nodes.back().ref()
    );
  }

private:
  std::vector<osmium::object_id_type>&
    references_;
};

class RestrictionAnchorHandler final :
  public osmium::handler::Handler {
public:
  explicit RestrictionAnchorHandler(
    std::vector<osmium::object_id_type>&
      references
  )
    : references_(references) {
  }

  void relation(
    const osmium::Relation& relation
  ) {
    if (!isCarRestriction(relation)) {
      return;
    }

    for (const auto& member : relation.members()) {
      if (
        member.type() == osmium::item_type::node &&
        std::string_view {member.role()} == "via"
      ) {
        // The anchor reducer retains identifiers that occur at least twice.
        references_.push_back(member.ref());
        references_.push_back(member.ref());
      }
    }
  }

private:
  std::vector<osmium::object_id_type>&
    references_;
};

std::vector<osmium::object_id_type>
findRequiredAnchors(
  const std::filesystem::path& osmPath
) {
  std::vector<osmium::object_id_type>
    references;

  AnchorReferenceHandler handler {
    references
  };

  osmium::io::Reader reader {
    osmPath.string(),
    osmium::osm_entity_bits::way
  };

  osmium::apply(reader, handler);
  reader.close();

  RestrictionAnchorHandler restrictionHandler {
    references
  };

  osmium::io::Reader relationReader {
    osmPath.string(),
    osmium::osm_entity_bits::relation
  };

  osmium::apply(
    relationReader,
    restrictionHandler
  );

  relationReader.close();

  std::sort(
    references.begin(),
    references.end()
  );

  std::size_t output = 0;

  for (
    std::size_t index = 0;
    index < references.size();
  ) {
    const auto id = references[index];
    const auto start = index;

    while (
      index < references.size() &&
      references[index] == id
    ) {
      index += 1;
    }

    if (index - start > 1) {
      references[output] = id;
      output += 1;
    }
  }

  references.resize(output);
  references.shrink_to_fit();

  return references;
}

double pointSegmentDistanceMeters(
  const RoadGeometryPoint& point,
  const RoadGeometryPoint& start,
  const RoadGeometryPoint& end
) {
  const double referenceLatitude =
    toRadians(
      (start.lat + end.lat) / 2.0
    );

  const double longitudeScale =
    std::cos(referenceLatitude);

  const auto x = [longitudeScale](double lon) {
    return toRadians(lon) *
      earthRadiusMeters *
      longitudeScale;
  };

  const auto y = [](double lat) {
    return toRadians(lat) *
      earthRadiusMeters;
  };

  const double startX = x(start.lon);
  const double startY = y(start.lat);
  const double endX = x(end.lon);
  const double endY = y(end.lat);
  const double pointX = x(point.lon);
  const double pointY = y(point.lat);

  const double deltaX = endX - startX;
  const double deltaY = endY - startY;
  const double lengthSquared =
    deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared <= 0.0) {
    return std::hypot(
      pointX - startX,
      pointY - startY
    );
  }

  const double projection =
    std::clamp(
      (
        (pointX - startX) * deltaX +
        (pointY - startY) * deltaY
      ) /
        lengthSquared,
      0.0,
      1.0
    );

  const double nearestX =
    startX + projection * deltaX;

  const double nearestY =
    startY + projection * deltaY;

  return std::hypot(
    pointX - nearestX,
    pointY - nearestY
  );
}

std::vector<RoadGeometryPoint>
simplifyGeometry(
  const std::vector<RoadGeometryPoint>& points
) {
  if (points.size() <= 2) {
    return points;
  }

  std::vector<std::uint8_t> keep(
    points.size(),
    0
  );

  keep.front() = 1;
  keep.back() = 1;

  std::vector<std::pair<std::size_t, std::size_t>>
    pending;

  pending.push_back({
    0,
    points.size() - 1
  });

  while (!pending.empty()) {
    const auto [start, end] =
      pending.back();

    pending.pop_back();

    double maximumDistance = 0.0;
    std::size_t furthest = start;

    for (
      std::size_t index = start + 1;
      index < end;
      ++index
    ) {
      const double distance =
        pointSegmentDistanceMeters(
          points[index],
          points[start],
          points[end]
        );

      if (distance > maximumDistance) {
        maximumDistance = distance;
        furthest = index;
      }
    }

    if (
      maximumDistance <=
        geometryToleranceMeters ||
      furthest == start
    ) {
      continue;
    }

    keep[furthest] = 1;
    pending.push_back({start, furthest});
    pending.push_back({furthest, end});
  }

  std::vector<RoadGeometryPoint> result;
  result.reserve(points.size());

  for (
    std::size_t index = 0;
    index < points.size();
    ++index
  ) {
    if (keep[index]) {
      result.push_back(points[index]);
    }
  }

  return result;
}

class DisjointSet {
public:
  explicit DisjointSet(std::size_t size)
    : parent_(size),
      rank_(size, 0) {
    for (
      std::uint32_t index = 0;
      index < size;
      ++index
    ) {
      parent_[index] = index;
    }
  }

  std::uint32_t find(
    std::uint32_t value
  ) {
    while (parent_[value] != value) {
      parent_[value] =
        parent_[parent_[value]];

      value = parent_[value];
    }

    return value;
  }

  void unite(
    std::uint32_t left,
    std::uint32_t right
  ) {
    left = find(left);
    right = find(right);

    if (left == right) {
      return;
    }

    if (rank_[left] < rank_[right]) {
      std::swap(left, right);
    }

    parent_[right] = left;

    if (rank_[left] == rank_[right]) {
      rank_[left] += 1;
    }
  }

private:
  std::vector<std::uint32_t> parent_;
  std::vector<std::uint8_t> rank_;
};

class RoadHandler final :
  public osmium::handler::Handler {
public:
  RoadHandler(
    RoadGraph& graph,
    const std::vector<
      osmium::object_id_type
    >& requiredAnchors,
    std::unordered_map<
      osmium::object_id_type,
      std::uint32_t
    >& nodeIndexes,
    std::unordered_map<
      osmium::object_id_type,
      std::uint32_t
    >& roadIndexes
  )
    : graph_(graph),
      requiredAnchors_(requiredAnchors),
      nodeIndexes_(nodeIndexes),
      roadIndexes_(roadIndexes) {
  }

  void way(const osmium::Way& way) {
    const auto profile =
      profileForWay(way);

    if (!profile) {
      return;
    }

    const auto& nodes = way.nodes();

    if (nodes.size() < 2) {
      return;
    }

    for (const auto& node : nodes) {
      if (!node.location().valid()) {
        return;
      }
    }

    const char* highwayRaw =
      way.tags()["highway"];

    const std::string_view highway {
      highwayRaw
    };

    const auto driveDirection =
      oneWayDirection(
        way.tags(),
        highway
      );

    const auto walkDirection =
      footDirection(way.tags());

    if (
      graph_.roads.size() >=
        std::numeric_limits<
          std::uint32_t
        >::max()
    ) {
      throw std::runtime_error(
        "Routing graph exceeds the 32-bit road limit."
      );
    }

    const auto road =
      static_cast<std::uint32_t>(
        graph_.roads.size()
      );

    std::string destination =
      tagValue(
        way.tags(),
        "destination"
      );

    const std::string destinationReference =
      tagValue(
        way.tags(),
        "destination:ref"
      );

    if (!destinationReference.empty()) {
      if (destination.empty()) {
        destination = destinationReference;
      } else if (
        destination != destinationReference
      ) {
        destination += " / ";
        destination += destinationReference;
      }
    }

    const char* junctionRaw =
      way.tags()["junction"];

    const std::string_view junction =
      junctionRaw ? junctionRaw : "";

    graph_.roads.push_back({
      way.id(),
      tagValue(way.tags(), "name"),
      tagValue(way.tags(), "ref"),
      std::move(destination),
      tagValue(way.tags(), "lanes"),
      tagValue(way.tags(), "turn:lanes"),
      tagValue(way.tags(), "turn:lanes:forward"),
      tagValue(way.tags(), "turn:lanes:backward"),
      tagValue(way.tags(), "destination:lanes"),
      junction == "roundabout" ||
        junction == "circular",
      highway.ends_with("_link"),
      isTolledForCars(way.tags()),
      isElectronicToll(way.tags())
    });

    roadIndexes_.insert_or_assign(
      way.id(),
      road
    );

    const double speedKmh =
      parseSpeedKmh(
        way.tags()["maxspeed"],
        profile->defaultSpeedKmh
      );

    std::size_t segmentStart = 0;
    double segmentDistance = 0.0;

    for (
      std::size_t index = 1;
      index < nodes.size();
      ++index
    ) {
      const auto& previous =
        nodes[index - 1];

      const auto& current = nodes[index];

      segmentDistance +=
        distanceMeters(
          previous.location().lat(),
          previous.location().lon(),
          current.location().lat(),
          current.location().lon()
        );

      const bool requiredAnchor =
        std::binary_search(
          requiredAnchors_.begin(),
          requiredAnchors_.end(),
          current.ref()
        );

      if (
        !requiredAnchor &&
        segmentDistance <
          maximumTopologySegmentMeters &&
        index + 1 < nodes.size()
      ) {
        continue;
      }

      appendSegment(
        nodes,
        segmentStart,
        index,
        *profile,
        driveDirection,
        walkDirection,
        speedKmh,
        road
      );

      segmentStart = index;
      segmentDistance = 0.0;
    }
  }

private:
  void appendSegment(
    const osmium::WayNodeList& nodes,
    std::size_t start,
    std::size_t end,
    const RoadProfile& profile,
    OneWayDirection driveDirection,
    OneWayDirection walkDirection,
    double speedKmh,
    std::uint32_t road
  ) {
    if (end <= start) {
      return;
    }

    const auto from = graphNode(nodes[start]);
    const auto to = graphNode(nodes[end]);

    if (from == to) {
      return;
    }

    double meters = 0.0;
    std::vector<RoadGeometryPoint> points;
    points.reserve(end - start + 1);

    for (
      std::size_t index = start;
      index <= end;
      ++index
    ) {
      const auto& location =
        nodes[index].location();

      points.push_back({
        location.lat(),
        location.lon()
      });

      if (index == start) {
        continue;
      }

      const auto& previous =
        nodes[index - 1].location();

      meters += distanceMeters(
        previous.lat(),
        previous.lon(),
        location.lat(),
        location.lon()
      );
    }

    if (
      !std::isfinite(meters) ||
      meters <= 0.0
    ) {
      return;
    }

    const auto simplified =
      simplifyGeometry(points);

    const std::size_t intermediateCount =
      simplified.size() > 2
        ? simplified.size() - 2
        : 0;

    const auto maximumU32 =
      std::numeric_limits<
        std::uint32_t
      >::max();

    if (
      graph_.geometryArcs.size() >=
        maximumU32 ||
      intermediateCount > maximumU32 ||
      graph_.geometryPoints.size() >
        maximumU32 - intermediateCount
    ) {
      throw std::runtime_error(
        "Routing geometry exceeds the 32-bit format limit."
      );
    }

    const auto geometryOffset =
      static_cast<std::uint32_t>(
        graph_.geometryPoints.size()
      );

    for (
      std::size_t index = 1;
      index + 1 < simplified.size();
      ++index
    ) {
      graph_.geometryPoints.push_back(
        simplified[index]
      );
    }

    const auto geometryCount =
      static_cast<std::uint32_t>(
        graph_.geometryPoints.size() -
          geometryOffset
      );

    const auto geometryArc =
      static_cast<std::uint32_t>(
        graph_.geometryArcs.size()
      );

    graph_.geometryArcs.push_back({
      geometryOffset,
      geometryCount
    });

    const auto distanceDecimeters =
      static_cast<std::uint32_t>(
        std::max(
          1.0,
          std::round(meters * 10.0)
        )
      );

    const double metersPerSecond =
      speedKmh / 3.6;

    const auto durationCentiseconds =
      static_cast<std::uint32_t>(
        std::max(
          1.0,
          std::round(
            meters /
            metersPerSecond *
            100.0
          )
        )
      );

    const bool oneWay =
      driveDirection != OneWayDirection::both;

    const bool forwardDrive =
      profile.driveByDefault &&
      allowsDirection(driveDirection, true);

    const bool reverseDrive =
      profile.driveByDefault &&
      allowsDirection(driveDirection, false);

    const bool forwardWalk =
      profile.walkByDefault &&
      allowsDirection(walkDirection, true);

    const bool reverseWalk =
      profile.walkByDefault &&
      allowsDirection(walkDirection, false);

    if (forwardDrive || forwardWalk) {
      graph_.edges.push_back({
        from,
        to,
        distanceDecimeters,
        durationCentiseconds,
        geometryArc,
        road,
        profile.roadClass,
        oneWay,
        false,
        forwardDrive,
        forwardWalk
      });
    }

    if (reverseDrive || reverseWalk) {
      graph_.edges.push_back({
        to,
        from,
        distanceDecimeters,
        durationCentiseconds,
        geometryArc,
        road,
        profile.roadClass,
        oneWay,
        true,
        reverseDrive,
        reverseWalk
      });
    }
  }

  std::uint32_t graphNode(
    const osmium::NodeRef& node
  ) {
    const auto found =
      nodeIndexes_.find(node.ref());

    if (found != nodeIndexes_.end()) {
      return found->second;
    }

    if (
      graph_.nodes.size() >=
      std::numeric_limits<
        std::uint32_t
      >::max()
    ) {
      throw std::runtime_error(
        "Routing graph exceeds the 32-bit node limit."
      );
    }

    const auto index =
      static_cast<std::uint32_t>(
        graph_.nodes.size()
      );

    graph_.nodes.push_back({
      node.ref(),
      node.location().lat(),
      node.location().lon(),
      0
    });

    nodeIndexes_.emplace(
      node.ref(),
      index
    );

    return index;
  }

  RoadGraph& graph_;

  const std::vector<
    osmium::object_id_type
  >& requiredAnchors_;

  std::unordered_map<
    osmium::object_id_type,
    std::uint32_t
  >& nodeIndexes_;

  std::unordered_map<
    osmium::object_id_type,
    std::uint32_t
  >& roadIndexes_;
};

class TurnRestrictionHandler final :
  public osmium::handler::Handler {
public:
  TurnRestrictionHandler(
    RoadGraph& graph,
    const std::unordered_map<
      osmium::object_id_type,
      std::uint32_t
    >& nodeIndexes,
    const std::unordered_map<
      osmium::object_id_type,
      std::uint32_t
    >& roadIndexes
  )
    : graph_(graph),
      nodeIndexes_(nodeIndexes),
      roadIndexes_(roadIndexes) {
  }

  void relation(
    const osmium::Relation& relation
  ) {
    if (!isCarRestriction(relation)) {
      return;
    }

    const auto restriction =
      *restrictionValue(relation.tags());

    const bool only =
      restriction.starts_with("only_");

    if (
      !only &&
      !restriction.starts_with("no_")
    ) {
      return;
    }

    std::vector<std::uint32_t> fromRoads;
    std::vector<std::uint32_t> toRoads;
    std::optional<std::uint32_t> viaNode;
    bool hasViaWay = false;

    for (const auto& member : relation.members()) {
      const std::string_view role {
        member.role()
      };

      if (
        role == "via" &&
        member.type() == osmium::item_type::way
      ) {
        hasViaWay = true;
        continue;
      }

      if (
        role == "via" &&
        member.type() == osmium::item_type::node
      ) {
        const auto found =
          nodeIndexes_.find(member.ref());

        if (found != nodeIndexes_.end()) {
          viaNode = found->second;
        }

        continue;
      }

      if (member.type() != osmium::item_type::way) {
        continue;
      }

      const auto found =
        roadIndexes_.find(member.ref());

      if (found == roadIndexes_.end()) {
        continue;
      }

      if (role == "from") {
        fromRoads.push_back(found->second);
      } else if (role == "to") {
        toRoads.push_back(found->second);
      }
    }

    // Via-way and conditional restrictions need a longer edge-state pattern
    // than the compact v3 node transition record and are intentionally left
    // for a later format extension.
    if (
      hasViaWay ||
      !viaNode ||
      fromRoads.empty() ||
      toRoads.empty()
    ) {
      return;
    }

    for (const auto fromRoad : fromRoads) {
      for (const auto toRoad : toRoads) {
        graph_.turnRestrictions.push_back({
          *viaNode,
          fromRoad,
          toRoad,
          only
        });
      }
    }
  }

private:
  RoadGraph& graph_;

  const std::unordered_map<
    osmium::object_id_type,
    std::uint32_t
  >& nodeIndexes_;

  const std::unordered_map<
    osmium::object_id_type,
    std::uint32_t
  >& roadIndexes_;
};

void assignComponents(
  RoadGraph& graph
) {
  DisjointSet components {
    graph.nodes.size()
  };

  for (const auto& edge : graph.edges) {
    components.unite(
      edge.from,
      edge.to
    );
  }

  std::unordered_map<
    std::uint32_t,
    std::uint32_t
  > componentIndexes;

  for (
    std::uint32_t index = 0;
    index < graph.nodes.size();
    ++index
  ) {
    const auto root =
      components.find(index);

    const auto [entry, inserted] =
      componentIndexes.emplace(
        root,
        static_cast<std::uint32_t>(
          componentIndexes.size()
        )
      );

    graph.nodes[index].component =
      entry->second;

    if (inserted) {
      graph.componentCount =
        static_cast<std::uint32_t>(
          componentIndexes.size()
        );
    }
  }
}

}

RoadGraph RoadExtractor::extract(
  const std::filesystem::path& osmPath
) const {
  using LocationIndex =
    osmium::index::map::FlexMem<
      osmium::unsigned_object_id_type,
      osmium::Location
    >;

  const auto requiredAnchors =
    findRequiredAnchors(osmPath);

  RoadGraph graph;
  LocationIndex locationIndex;

  std::unordered_map<
    osmium::object_id_type,
    std::uint32_t
  > nodeIndexes;

  std::unordered_map<
    osmium::object_id_type,
    std::uint32_t
  > roadIndexes;

  osmium::handler::NodeLocationsForWays<
    LocationIndex
  > locationHandler {
    locationIndex
  };

  locationHandler.ignore_errors();

  RoadHandler roadHandler {
    graph,
    requiredAnchors,
    nodeIndexes,
    roadIndexes
  };

  osmium::io::Reader reader {
    osmPath.string(),
    osmium::osm_entity_bits::node |
      osmium::osm_entity_bits::way
  };

  osmium::apply(
    reader,
    locationHandler,
    roadHandler
  );

  reader.close();

  TurnRestrictionHandler restrictionHandler {
    graph,
    nodeIndexes,
    roadIndexes
  };

  osmium::io::Reader relationReader {
    osmPath.string(),
    osmium::osm_entity_bits::relation
  };

  osmium::apply(
    relationReader,
    restrictionHandler
  );

  relationReader.close();

  assignComponents(graph);

  return graph;
}

}
