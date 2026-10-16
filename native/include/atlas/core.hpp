#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
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
};
struct Route {
  std::vector<uint32_t> nodes, edges;
  std::vector<Point> points;
  std::vector<Leg> legs;
  std::vector<Maneuver> maneuvers;
  double meters = 0, seconds = 0, tollEuros = 0;
  uint32_t expanded = 0;
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
  uint32_t maxExpanded = 2000000;
  std::function<bool()> cancelled;
};
double tollRate(std::string reference, int vehicleClass);
std::optional<Route> route(const Graph &graph, uint32_t start, uint32_t goal,
                           const RouteOptions &options = {});
void makeManeuvers(Route &route, const Graph &graph);
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
};
class GuidanceSession {
public:
  void reset();
  Guidance update(Point p, double accuracy, double speed,
                  double timestampSeconds, const Route &route);

private:
  double offSince_ = -1, lastReroute_ = -1, lastTime_ = -1;
  uint32_t offFixes_ = 0;
};
struct Place {
  std::string id;
  Point point;
  std::vector<std::string> fields;
  double meters = 0, score = 0;
  std::string name() const;
  bool visitable() const;
};
std::string normalize(std::string_view text);
class Search {
public:
  Search(const std::string &indexPath, const std::string &recordsPath);
  Place record(uint32_t id) const;
  std::vector<Place> query(std::string_view text, Point anchor,
                           std::size_t limit = 20) const;
  std::vector<Place> nearby(Point anchor, double radius,
                            std::string_view category,
                            std::size_t limit = 30) const;

private:
  Binary index_, records_;
  std::vector<uint32_t> postings(std::string_view token, bool prefix) const;
  std::string stringAt(uint32_t id) const;
};
std::string jsonString(std::string_view text);
std::string routeJson(const Route &r);
std::string placesJson(const std::vector<Place> &places);
} // namespace atlas
