#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace roam {

enum class RoadClass : std::uint8_t {
  motorway = 1,
  trunk = 2,
  primary = 3,
  secondary = 4,
  tertiary = 5,
  residential = 6,
  service = 7,
  track = 8,
  other = 9
};

struct RoadNode {
  std::int64_t osmId = 0;
  double lat = 0.0;
  double lon = 0.0;
  std::uint32_t component = 0;
};

struct RoadGeometryPoint {
  double lat = 0.0;
  double lon = 0.0;
};

struct RoadGeometryArc {
  std::uint32_t offset = 0;
  std::uint32_t count = 0;
};

struct RoadMetadata {
  std::int64_t osmId = 0;
  std::string name;
  std::string reference;
  std::string destination;
  std::string lanes;
  std::string turnLanes;
  std::string turnLanesForward;
  std::string turnLanesBackward;
  std::string destinationLanes;
  bool roundabout = false;
  bool link = false;
  bool toll = false;
  bool electronicToll = false;
};

struct RoadEdge {
  std::uint32_t from = 0;
  std::uint32_t to = 0;
  std::uint32_t distanceDecimeters = 0;
  std::uint32_t durationCentiseconds = 0;
  std::uint32_t geometryArc = 0;
  std::uint32_t road = 0;
  RoadClass roadClass = RoadClass::other;
  bool oneWay = false;
  bool geometryReversed = false;
  bool driveAllowed = true;
  bool walkAllowed = false;
};

struct RoadTurnRestriction {
  std::uint32_t viaNode = 0;
  std::uint32_t fromRoad = 0;
  std::uint32_t toRoad = 0;
  bool only = false;
};

struct RoadGraph {
  std::vector<RoadNode> nodes;
  std::vector<RoadEdge> edges;
  std::vector<RoadGeometryArc> geometryArcs;
  std::vector<RoadGeometryPoint> geometryPoints;
  std::vector<RoadMetadata> roads;
  std::vector<RoadTurnRestriction> turnRestrictions;
  std::uint32_t componentCount = 0;
};

}
