#include "atlas/core.hpp"
#include <algorithm>
#include <cmath>
#include <jni.h>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
namespace {
struct Engine {
  std::unique_ptr<atlas::Graph> graph;
  std::unique_ptr<atlas::Search> search, addresses;
  std::optional<atlas::Route> route;
  std::map<int, atlas::Route> savedRoutes;
  atlas::GuidanceSession guidance;
  atlas::MotionFilter motion;
  std::optional<atlas::Profile> motionProfile;
  std::optional<double> motionHeading;
  std::string graphPath, searchPath;
};
std::mutex gate;
std::map<jlong, std::unique_ptr<Engine>> engines;
jlong nextId = 1;
std::atomic<uint64_t> cancellationGeneration{0};
Engine &engine(jlong id) {
  auto it = engines.find(id);
  if (it == engines.end())
    throw std::runtime_error("Native engine is closed");
  return *it->second;
}
std::string string(JNIEnv *env, jstring value) {
  if (!value)
    throw std::invalid_argument("Null native argument");
  const char *bytes = env->GetStringUTFChars(value, nullptr);
  if (!bytes)
    throw std::bad_alloc();
  std::string s(bytes);
  env->ReleaseStringUTFChars(value, bytes);
  return s;
}
jbyteArray bytes(JNIEnv *env, const std::string &s) {
  if (s.size() > std::size_t(std::numeric_limits<jsize>::max()))
    throw std::runtime_error("Native result too large");
  auto out = env->NewByteArray(jsize(s.size()));
  if (!out)
    return nullptr;
  env->SetByteArrayRegion(out, 0, jsize(s.size()),
                          reinterpret_cast<const jbyte *>(s.data()));
  return out;
}
void error(JNIEnv *env, const std::exception &e) {
  auto cls = env->FindClass("java/lang/IllegalStateException");
  if (cls)
    env->ThrowNew(cls, e.what());
}
} // namespace
extern "C" JNIEXPORT jlong JNICALL
Java_com_atlas_nativeapp_NativeCore_create(JNIEnv *env, jobject) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto id = nextId++;
    engines.emplace(id, std::make_unique<Engine>());
    return id;
  } catch (const std::exception &e) {
    error(env, e);
    return 0;
  }
}
extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_destroy(JNIEnv *, jobject, jlong id) {
  std::lock_guard<std::mutex> lock(gate);
  engines.erase(id);
}
extern "C" JNIEXPORT void JNICALL Java_com_atlas_nativeapp_NativeCore_openGraph(
    JNIEnv *env, jobject, jlong id, jstring directory) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    auto path = string(env, directory);
    if (e.graphPath != path) {
      auto next = std::make_unique<atlas::Graph>(path);
      e.graph = std::move(next);
      e.graphPath = path;
    }
  } catch (const std::exception &e) {
    error(env, e);
  }
}
extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_openSearch(JNIEnv *env, jobject, jlong id,
                                               jstring directory) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    auto path = string(env, directory);
    if (e.searchPath != path) {
      auto next = std::make_unique<atlas::Search>(path + "/search-index.bin",
                                                  path + "/search-records.bin");
      std::unique_ptr<atlas::Search> address;
      try {
        address = std::make_unique<atlas::Search>(
            path + "/address-index.bin", path + "/address-records.bin");
      } catch (const std::exception &) {
      }
      e.search = std::move(next);
      e.addresses = std::move(address);
      e.searchPath = path;
    }
  } catch (const std::exception &e) {
    error(env, e);
  }
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_atlas_nativeapp_NativeCore_find(JNIEnv *env, jobject, jlong id,
                                         jbyteArray query, jdouble lat,
                                         jdouble lon, jboolean nearby,
                                         jstring category) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    if (!e.search)
      throw std::runtime_error("Download a region before searching");
    auto n = env->GetArrayLength(query);
    if (n > 1024)
      throw std::invalid_argument("Query too long");
    std::string q(std::size_t(n), '\0');
    env->GetByteArrayRegion(query, 0, n, reinterpret_cast<jbyte *>(q.data()));
    auto results =
        nearby ? e.search->nearby({lat, lon}, 3000, string(env, category))
               : e.search->query(q, {lat, lon});
    if (!nearby && e.addresses) {
      auto more = e.addresses->addresses(q, {lat, lon}, 12);
      results.insert(results.end(), more.begin(), more.end());
      std::stable_sort(results.begin(), results.end(),
                       [](const atlas::Place &a, const atlas::Place &b) {
                         return a.score != b.score ? a.score < b.score
                                                   : a.meters < b.meters;
                       });
      std::set<std::string> seen;
      results.erase(
          std::remove_if(
              results.begin(), results.end(),
              [&](const atlas::Place &p) {
                auto key =
                    atlas::normalize(p.name()) + '|' +
                    std::to_string(std::floor(p.point.lat * 10000 + .5)) + '|' +
                    std::to_string(std::floor(p.point.lon * 10000 + .5));
                return !seen.insert(key).second;
              }),
          results.end());
      if (results.size() > 12)
        results.resize(12);
    }
    return bytes(env, atlas::placesJson(results));
  } catch (const std::exception &e) {
    error(env, e);
    return nullptr;
  }
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_atlas_nativeapp_NativeCore_calculate(JNIEnv *env, jobject, jlong id,
                                              jdouble a, jdouble b, jdouble c,
                                              jdouble d, jboolean walk,
                                              jboolean avoid, jdouble penalty,
                                              jint vehicle, jdouble gpsHeading) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    if (!e.graph)
      throw std::runtime_error("Download a routing region first");
    atlas::RouteOptions op;
    op.profile = walk ? atlas::Profile::walk : atlas::Profile::drive;
    op.avoidTolls = avoid;
    op.penaltyMinutesPerEuro = penalty;
    op.vehicleClass = vehicle;
    auto generation = cancellationGeneration.load();
    op.cancelled = [generation] {
      return cancellationGeneration.load() != generation;
    };
    const auto directed = !walk && std::isfinite(gpsHeading) &&
        gpsHeading>=0 ? e.graph->nearestDirected({a,b},op.profile,gpsHeading)
                      : std::nullopt;
    auto start = directed ? std::optional<uint32_t>(directed->node)
                          : e.graph->nearest({a,b},op.profile);
    auto goal = e.graph->nearest({c,d},op.profile);
    if(!start || !goal)
      throw std::runtime_error("No accessible road within 2 km of an endpoint");
    if(directed) {
      op.initialEdge=directed->edge;
      op.initialSnap=directed->snapped;
    }
    auto next=atlas::route(*e.graph,*start,*goal,op);
    if(!next && directed) {
      // The selected carriageway may have no legal continuation.
      op.initialEdge.reset();
      op.initialSnap.reset();
      start=e.graph->nearest({a,b},op.profile);
      if(start) next=atlas::route(*e.graph,*start,*goal,op);
    }
    if(!next)
      throw std::runtime_error("No route connects these points");
    if (!walk)
      atlas::calibrateDriveEta(*next, *e.graph);
    // The same native engine processes GPS across driving and walking
    // routes. Carrying an old car-motion anchor into a new walking route can
    // reject several genuine 1.5m/s fixes as impossible displacement.
    // Only reset when changing motion profile; reroutes in the same mode
    // retain their useful speed/heading evidence.
    if (e.motionProfile && *e.motionProfile != op.profile) {
      e.motion = atlas::MotionFilter{};
      e.motionHeading.reset();
    }
    e.motionProfile = op.profile;
    e.route = std::move(next);
    e.guidance.reset();
    return bytes(env, atlas::routeJson(*e.route));
  } catch (const std::exception &e) {
    error(env, e);
    return nullptr;
  }
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_atlas_nativeapp_NativeCore_update(JNIEnv *env, jobject, jlong id,
                                           jdouble lat, jdouble lon,
                                           jdouble accuracy, jdouble speed,
                                           jdouble time) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    if (!e.route)
      throw std::runtime_error("No active native route");
    auto g = e.guidance.update({lat, lon}, accuracy, speed, time, *e.route);
    auto &p = g.position;
    double heading = std::numeric_limits<double>::quiet_NaN();
    if (e.route->points.size() > p.segment + 1)
      heading =
          atlas::carHeading(e.motionHeading.value_or(heading),
                            atlas::bearing(e.route->points[p.segment],
                                           e.route->points[p.segment + 1]),
                            speed, accuracy, p.offRoute);
    const char *states[] = {"normal", "reduced", "checking", "reroute",
                            "arrived"};
    std::ostringstream s;
    s.precision(12);
    s << "{\"state\":\"" << states[int(g.state)]
      << "\",\"lat\":" << p.snapped.lat << ",\"lon\":" << p.snapped.lon
      << ",\"along\":" << p.along << ",\"remaining\":" << p.remaining
      << ",\"seconds\":" << p.seconds << ",\"maneuver\":" << p.maneuver
      << ",\"toManeuver\":" << p.toManeuver << ",\"segment\":" << p.segment
      << ",\"offRoute\":" << p.offRoute
      << ",\"observedOffRoute\":" << g.observedOffRoute
      << ",\"offRouteConfirmed\":" << (g.offRouteConfirmed ? "true" : "false") << ",\"bearing\":";
    if (std::isfinite(heading))
      s << heading;
    else
      s << "null";
    s << '}';
    return bytes(env, s.str());
  } catch (const std::exception &e) {
    error(env, e);
    return nullptr;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_cancel(JNIEnv *, jobject) {
  ++cancellationGeneration;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_atlas_nativeapp_NativeCore_filter(JNIEnv *env, jobject, jlong id,
                                           jdouble lat, jdouble lon,
                                           jdouble accuracy, jdouble speed,
                                           jdouble heading, jdouble time) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    atlas::MotionFix fix{
        {lat, lon},
        accuracy,
        time,
        speed >= 0 ? std::optional<double>(speed) : std::nullopt,
        heading >= 0 ? std::optional<double>(heading) : std::nullopt};
    auto result = e.motion.update(fix);
    e.motionHeading = result.heading;
    std::ostringstream s;
    s.precision(12);
    s << "{\"speed\":" << result.speed << ",\"heading\":";
    if (result.heading)
      s << *result.heading;
    else
      s << "null";
    s << ",\"moving\":" << (result.moving ? "true" : "false") << '}';
    return bytes(env, s.str());
  } catch (const std::exception &e) {
    error(env, e);
    return nullptr;
  }
}

extern "C" JNIEXPORT void JNICALL Java_com_atlas_nativeapp_NativeCore_remember(
    JNIEnv *env, jobject, jlong id, jint key) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    if (key < 0 || key > 3 || !e.route)
      throw std::invalid_argument("Invalid route option");
    e.savedRoutes.insert_or_assign(key, *e.route);
  } catch (const std::exception &e) {
    error(env, e);
  }
}
extern "C" JNIEXPORT void JNICALL Java_com_atlas_nativeapp_NativeCore_activate(
    JNIEnv *env, jobject, jlong id, jint key) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e = engine(id);
    auto found = e.savedRoutes.find(key);
    if (found == e.savedRoutes.end())
      throw std::invalid_argument("Route option is unavailable");
    e.route = found->second;
    e.guidance.reset();
  } catch (const std::exception &e) {
    error(env, e);
  }
}
