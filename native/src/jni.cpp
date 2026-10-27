#include "atlas/core.hpp"
#include "atlas/toll_crossings.hpp"
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
  std::string graphPath, searchPath, routeGraphPath;
  std::optional<atlas::TollTariffs> tariffs;
  std::string tariffCountry;
  std::optional<atlas::TollTariffs> fixedTariffs;
  std::optional<atlas::TollTariffs> entryExitTariffs;
  std::optional<atlas::TollCrossingMatcher> crossings;
  atlas::TollGraphDigests loadedGraphDigests;
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
      e.crossings.reset();e.loadedGraphDigests.clear();
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
// Catalog bytes are supplied by Kotlin from assets/tolls/<country>.csv.
// Each engine has its own immutable, country-scoped tariffs, never global
// Portugal assumptions. Missing file explicitly disables pricing.
extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_loadTariffs(JNIEnv *env, jobject, jlong id,
                                               jstring country,
                                               jbyteArray payload) {
  try {
    std::lock_guard<std::mutex> lock(gate);
    auto &e=engine(id);
    const auto name=string(env,country);
    // Clear even on parse failure: never leak the previous country's rates.
    e.tariffs.reset();
    e.fixedTariffs.reset();e.entryExitTariffs.reset();e.crossings.reset();e.loadedGraphDigests.clear();
    e.tariffCountry=name;
    if(!payload || env->GetArrayLength(payload)==0) {
      e.tariffs.reset();
      e.tariffCountry=name;
      return;
    }
    const auto n=env->GetArrayLength(payload);
    if(n>2*1024*1024)throw std::invalid_argument("Toll table too large");
    std::string csv(std::size_t(n),'\0');
    env->GetByteArrayRegion(payload,0,n,
        reinterpret_cast<jbyte*>(csv.data()));
    auto next=atlas::TollTariffs::parse(csv,name);
    e.tariffs=std::move(next);
    e.tariffCountry=name;
  } catch(const std::exception &ex) { error(env,ex); }
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
    // Most raw OSM POIs have no addr:city/municipality. Provide a clearly
    // approximate nearby locality from the already downloaded search index.
    // Do not misrepresent a nearest village as a municipality/district.
    if(e.search)for(auto &place:results) {
      if(place.fields.size()>17 && place.fields[7].empty() &&
          place.fields[16].empty() && place.fields[17].empty())
        place.nearbyLocality=e.search->nearestLocality(place.point);
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
                                              jint vehicle, jdouble gpsHeading,
                                              jint alternateSeedKey,
                                              jdouble diversitySecondsPerKm) {
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
    op.tariffs = e.tariffs ? &*e.tariffs : nullptr;
    op.tariffCountry = e.tariffCountry;
    if (alternateSeedKey >= 0 && diversitySecondsPerKm > 0) {
      if (!std::isfinite(diversitySecondsPerKm) ||
          diversitySecondsPerKm > 1200.)
        throw std::invalid_argument("Invalid alternative route weighting");
      const auto previous = e.savedRoutes.find(alternateSeedKey);
      if (previous == e.savedRoutes.end())
        throw std::invalid_argument("Alternative seed route does not exist");
      op.sharedEdgePenaltySecondsPerKm = diversitySecondsPerKm;
      op.discouragedEdges.insert(previous->second.edges.begin(),
                                previous->second.edges.end());
    }
    auto generation = cancellationGeneration.load();
    op.cancelled = [generation] {
      return cancellationGeneration.load() != generation;
    };
    // Direction is a hard constraint when a trusted heading is supplied.
    // Never retry a wrong-way route from an arbitrary nearest graph node.
    const bool hasDirection = !walk && std::isfinite(gpsHeading) && gpsHeading >= 0;
    auto next = atlas::routeFromPosition(
        *e.graph, {a, b}, {c, d}, op,
        hasDirection ? std::optional<double>(gpsHeading) : std::nullopt);
    if(!next)
      throw std::runtime_error(hasDirection
          ? "Cannot find a legal route in the confirmed driving direction"
          : "No route connects these points");
    if (!walk)
      atlas::calibrateDriveEta(*next, *e.graph);
    if(!walk && e.fixedTariffs && e.crossings)
      atlas::applyFixedTollCharges(*e.graph,*next,*e.fixedTariffs,*e.crossings,e.loadedGraphDigests);
    if(!walk && e.entryExitTariffs && e.crossings)
      atlas::applyEntryExitTollCharges(*e.graph,*next,*e.entryExitTariffs,*e.crossings,e.loadedGraphDigests);
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
    e.routeGraphPath=e.graphPath;
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

extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_loadFixedTariffs(JNIEnv *env,jobject,jlong id,
                                                    jstring country,jbyteArray payload) {
  try {
    std::lock_guard<std::mutex> lock(gate);auto &e=engine(id);
    e.fixedTariffs.reset();e.crossings.reset();e.loadedGraphDigests.clear();
    const auto name=string(env,country);
    if(name!=e.tariffCountry)throw std::invalid_argument("Fixed tariff country differs from selected routing country");
    const auto size=payload?env->GetArrayLength(payload):0;if(!size)return;
    if(size>2*1024*1024)throw std::invalid_argument("Fixed tariff catalog too large");
    std::string csv(size,'\0');env->GetByteArrayRegion(payload,0,size,reinterpret_cast<jbyte*>(csv.data()));
    auto table=atlas::TollTariffs::parse(csv,name);
    if(table.scheme!="fixed-crossing")throw std::invalid_argument("Expected fixed-crossing price catalog");
    e.fixedTariffs=std::move(table);
  } catch(const std::exception &errorValue) {error(env,errorValue);}
}
extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_loadEntryExitTariffs(JNIEnv *env,jobject,jlong id,
    jstring country,jbyteArray payload) {
  try {
    std::lock_guard<std::mutex> lock(gate);auto &e=engine(id);
    e.entryExitTariffs.reset();e.crossings.reset();e.loadedGraphDigests.clear();
    const auto name=string(env,country);
    if(name!=e.tariffCountry)throw std::invalid_argument("Entry/exit country differs from selected routing country");
    const auto size=payload?env->GetArrayLength(payload):0;if(!size)return;
    if(size>2*1024*1024)throw std::invalid_argument("Entry/exit catalog too large");
    std::string csv(size,'\0');env->GetByteArrayRegion(payload,0,size,reinterpret_cast<jbyte*>(csv.data()));
    auto table=atlas::TollTariffs::parse(csv,name);
    if(table.scheme!="entry-exit")throw std::invalid_argument("Expected entry-exit price catalog");
    e.entryExitTariffs=std::move(table);
  } catch(const std::exception &errorValue) {error(env,errorValue);}
}
extern "C" JNIEXPORT void JNICALL
Java_com_atlas_nativeapp_NativeCore_loadTollBindings(JNIEnv *env,jobject,jlong id,
    jstring country,jstring directory,jbyteArray payload,jobjectArray actualHashes) {
  try {
    std::lock_guard<std::mutex> lock(gate);auto &e=engine(id);
    e.crossings.reset();e.loadedGraphDigests.clear();
    const auto size=payload?env->GetArrayLength(payload):0;if(!size)return;
    if(!e.graph||(!e.fixedTariffs&&!e.entryExitTariffs)||string(env,country)!=e.tariffCountry||string(env,directory)!=e.graphPath)
      throw std::invalid_argument("Crossing proof differs from loaded graph/country");
    if(size>2*1024*1024||!actualHashes||env->GetArrayLength(actualHashes)!=7)throw std::invalid_argument("Invalid crossing proof size/digests");
    const char *names[]={"nodes.bin","edges.bin","geometry.bin","roads.bin","strings.bin","restrictions.bin","spatial-index.bin"};
    atlas::TollGraphDigests actual;
    for(int i=0;i<7;++i) {
      auto value=static_cast<jstring>(env->GetObjectArrayElement(actualHashes,i));
      actual[names[i]]=string(env,value);env->DeleteLocalRef(value);
    }
    std::string csv(size,'\0');env->GetByteArrayRegion(payload,0,size,reinterpret_cast<jbyte*>(csv.data()));
    auto proof=atlas::TollCrossingMatcher::parse(csv);
    if(!proof.match(actual,e.tariffCountry,{}))throw std::invalid_argument("Unreviewed/mismatched graph crossing evidence");
    proof.validateGraph(*e.graph);
    e.crossings=std::move(proof);e.loadedGraphDigests=std::move(actual);
  } catch(const std::exception &errorValue) {error(env,errorValue);}
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_atlas_nativeapp_NativeCore_priceCurrentRoute(JNIEnv *env,jobject,jlong id) {
  try {
    std::lock_guard<std::mutex> lock(gate);auto &e=engine(id);
    if(!e.route||!e.graph||e.routeGraphPath!=e.graphPath)throw std::invalid_argument("No current-graph route to price");
    if(e.fixedTariffs&&e.crossings)
      atlas::applyFixedTollCharges(*e.graph,*e.route,*e.fixedTariffs,*e.crossings,e.loadedGraphDigests);
    if(e.entryExitTariffs&&e.crossings)
      atlas::applyEntryExitTollCharges(*e.graph,*e.route,*e.entryExitTariffs,*e.crossings,e.loadedGraphDigests);
    return bytes(env,atlas::routeJson(*e.route));
  } catch(const std::exception &errorValue) {error(env,errorValue);return nullptr;}
}

