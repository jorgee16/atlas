#pragma once
#include <atomic>
#include <array>
#include <unordered_map>
#include <cstdint>
#include <functional>
#include <unordered_set>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace atlas {
struct Point {
  double lat = 0, lon = 0;
};
bool valid(Point p);
double distance(Point a, Point b);
double bearing(Point a, Point b);
// Read-only mmap ownership. All binary reads are explicit little-endian and
// bounds checked.
class Binary {
public:
  explicit Binary(const std::string &path);
  ~Binary();
  Binary(const Binary &) = delete;
  Binary &operator=(const Binary &) = delete;
  std::size_t size() const { return size_; }
  void range(std::size_t offset, std::size_t count) const;
  uint8_t u8(std::size_t o) const;
  uint16_t u16(std::size_t o) const;
  uint32_t u32(std::size_t o) const;
  int32_t i32(std::size_t o) const;
  float f32(std::size_t o) const;
  std::string_view text(std::size_t o, std::size_t n) const;
  void header(std::string_view magic, uint32_t version,
              std::size_t minimum) const;

private:
  const uint8_t *data_ = nullptr;
  std::size_t size_ = 0;
};
enum class Profile { drive, walk };
struct Road {
  std::string name, ref, destination, lanes;
  uint32_t flags = 0;
};
struct Edge {
  uint32_t target, distanceDm, durationCs, attributes, geometry, road;
  bool allows(Profile p) const {
    return geometry & (p == Profile::drive ? 0x20000000u : 0x40000000u);
  }
};
struct Leg {
  uint32_t edge, from, to;
  std::size_t first, last;
  double distance, duration, startDistance;
  Road road;
};
struct Maneuver {
  std::string type, instruction, road;
  double at = 0;
  std::size_t point = 0;
  std::string turnLanes;
  unsigned exitNumber = 0;
};
/** Country-specific tariff table, independent of OSM routing graph versions.
 * Real section prices are converted to road-average estimates until explicit
 * junction/plaza IDs exist in the road graph. No guessed default rate. */
class TollTariffs {
public:
  static TollTariffs parse(std::string_view csv, std::string country);
  std::optional<double> estimate(std::string_view roadRef,
                                 double meters, int vehicleClass) const;
  // Section lookup is for authoritative section IDs supplied by a future,
  // graph-version-bound mapping. Routing never guesses these IDs from a ref.
  std::optional<double> sectionPrice(std::string_view road, std::string_view section,
                                     int vehicleClass) const;
  std::string country, currency, year, source, version;
  int fractionDigits = 2;
  std::vector<int> classes;
private:
  struct RoadTotals {
    double km = 0;
    std::unordered_map<int,double> prices;
  };
  std::unordered_map<std::string, RoadTotals> roadTotals_;
  std::unordered_map<std::string,std::unordered_map<int,double>> sectionPrices_;
  bool restrictEstimates_ = false;
  std::unordered_set<std::string> estimateRoads_;
};
/** Breakdown is metadata for explaining toll coverage, not an exact tariff.
 * Individual edges are grouped by their OSM road ref in encounter order. */
struct TollRoadCharge {
  std::string road;
  double meters = 0, pricedMeters = 0, amount = 0;
  bool complete = true;
};
struct Route {
  std::vector<TollRoadCharge> tollRoads;
  std::vector<uint32_t> nodes, edges;
  std::vector<Point> points;
  std::vector<Leg> legs;
  std::vector<Maneuver> maneuvers;
  double meters = 0, seconds = 0, tollEuros = 0;
  double tolledMeters = 0, pricedTollMeters = 0;
  bool tollPriceComplete = true;
  std::string tollCountry, tollCurrency, tollYear, tollSource, tollVersion;
  int tollFractionDigits = 2, tollVehicleClass = 1;
  std::vector<int> tollVehicleClasses;
  uint32_t expanded = 0;
  double destinationAccessMeters = 0; // distance from road end to true POI
};
struct DirectedRoadStart {
  uint32_t node = 0, edge = 0;
  Point snapped;
};
class Graph {
public:
  explicit Graph(const std::string &directory);
  uint32_t nodeCount() const { return nodes_.u32(8); }
  uint32_t edgeCount() const { return edges_.u32(12); }
  Point point(uint32_t node) const;
  uint32_t component(uint32_t node) const;
  uint32_t offset(uint32_t node) const;
  Edge edge(uint32_t index) const;
  Road road(uint32_t index, bool reversed = false) const;
  uint32_t roadFlags(uint32_t index) const;
  bool restricted(uint32_t node) const;
  bool turnAllowed(uint32_t node, int64_t incomingRoad, uint32_t road,
                   int64_t from, uint32_t target) const;
  std::optional<uint32_t> nearest(Point p, Profile profile,
                                  double radius = 2000) const;
  std::vector<uint32_t> destinationCandidates(Point p, Profile profile,
      uint32_t reachableComponent, double radius = 5000,
      std::size_t limit = 12) const;
  std::optional<DirectedRoadStart> nearestDirected(
      Point p, Profile profile, double heading, double tolerance = 35) const;
  void appendGeometry(const Edge &edge, std::vector<Point> &points) const;

private:
  Binary nodes_, edges_, geometry_, roads_, strings_, restrictions_, grid_;
  std::vector<uint32_t> restrictionOffsets_;
  std::vector<uint8_t> profileMasks_;
  std::string stringAt(uint32_t offset) const;
};
struct RouteOptions {
  Profile profile = Profile::drive;
  bool avoidTolls = false;
  double penaltyMinutesPerEuro = 0;
  int vehicleClass = 1;
  const TollTariffs *tariffs = nullptr;
  std::string tariffCountry;
  uint32_t maxExpanded = 2000000;
  std::optional<uint32_t> initialEdge;
  std::optional<Point> initialSnap;
  // Non-negative soft cost for edges from another saved alternative.
  // Routing restrictions, headings and walking profile are unchanged.
  std::unordered_set<uint32_t> discouragedEdges;
  double sharedEdgePenaltySecondsPerKm = 0;
  std::function<bool()> cancelled;
};
std::vector<std::string> principalRoadRefs(const Route &route,
                                           std::size_t limit = 4);
std::optional<Route> route(const Graph &graph, uint32_t start, uint32_t goal,
                           const RouteOptions &options = {});
// A known GPS heading is a hard directed-road start constraint, not a hint.
std::optional<Route> routeFromPosition(const Graph &graph, Point from, Point to,
    const RouteOptions &options, std::optional<double> travelHeading);
void makeManeuvers(Route &route, const Graph &graph);
void calibrateDriveEta(Route &route, const Graph &graph);
struct MotionFix {
  Point point;
  double accuracy = 0, timestamp = 0;
  std::optional<double> speed, heading;
};
struct Motion {
  double speed = 0;
  std::optional<double> heading;
  bool moving = false;
};
class MotionFilter {
public:
  Motion update(const MotionFix &fix);

private:
  std::optional<MotionFix> anchor_;
  std::optional<double> heading_, lastMove_;
  bool moving_ = false;
  double speed_ = 0, lastTimestamp_ = -1;
};
double carHeading(double gps, double route, double speed, double accuracy,
                  double offRoute);
struct Progress {
  Point snapped;
  std::size_t segment = 0, maneuver = 0;
  double along = 0, remaining = 0, seconds = 0, offRoute = 0, toManeuver = 0;
};
Progress progress(Point p, const Route &route);
struct Guidance {
  enum class State { normal, reduced, checking, reroute, arrived };
  State state = State::normal;
  Progress position;
  bool offRouteConfirmed = false;
  double observedOffRoute = 0;
};
class GuidanceSession {
public:
  void reset();
  Guidance update(Point p, double accuracy, double speed,
                  double timestampSeconds, const Route &route);

private:
  double offSince_ = -1, lastReroute_ = -1, lastTime_ = -1;
  double lastGoodTime_ = -1, lastGoodSpeed_ = 0;
  uint32_t offFixes_ = 0, implausibleFixes_ = 0;
  std::optional<Point> implausibleCandidate_;
  std::optional<Point> deviationMotionPoint_;
  double deviationMotionAt_ = -1, deviationMotionDistance_ = 0;
  double deviationVerifiedAt_ = -1;
  std::optional<Progress> lastPosition_, lastGoodPosition_;
};
struct Place {
  std::string id;
  Point point;
  std::vector<std::string> fields;
  double meters = 0, score = 0;
  std::string nearbyLocality; // approximate, explicitly labeled (not municipality)
  std::string name() const;
  bool visitable() const;
};
std::string normalize(std::string_view text);
class Search {
public:
  Search(const std::string &indexPath, const std::string &recordsPath);
  Place record(uint32_t id) const;
  std::string nearestLocality(Point p) const;
  std::vector<Place> query(std::string_view text, Point anchor,
                           std::size_t limit = 20) const;
  std::vector<Place> addresses(std::string_view text, Point anchor,
                               std::size_t limit = 12) const;
  std::vector<Place> nearby(Point anchor, double radius,
                            std::string_view category,
                            std::size_t limit = 30) const;

private:
  struct LocalityEntry { Point point; std::string name; };
  Binary index_, records_;
  mutable bool localitiesLoaded_ = false;
  mutable std::vector<LocalityEntry> localities_;
  std::vector<uint32_t> postings(std::string_view token, bool prefix) const;
  std::string stringAt(uint32_t id) const;
};
std::string jsonString(std::string_view text);
std::string routeJson(const Route &r);
std::string placesJson(const std::vector<Place> &places);
} // namespace atlas


