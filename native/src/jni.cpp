#include "atlas/core.hpp"
#include <jni.h>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
namespace {
struct Engine {
  std::unique_ptr<atlas::Graph> graph;
  std::unique_ptr<atlas::Search> search, addresses;
  std::optional<atlas::Route> route;
  atlas::GuidanceSession guidance;
  std::string graphPath, searchPath;
};
std::mutex gate;
std::map<jlong,std::unique_ptr<Engine>> engines;
jlong nextId=1;
Engine& engine(jlong id) {auto it=engines.find(id);if(it==engines.end())throw std::runtime_error("Native engine is closed");return *it->second;}
std::string string(JNIEnv* env,jstring value) {
  if(!value)throw std::invalid_argument("Null native argument");
  const char* bytes=env->GetStringUTFChars(value,nullptr);if(!bytes)throw std::bad_alloc();
  std::string s(bytes);env->ReleaseStringUTFChars(value,bytes);return s;
}
jbyteArray bytes(JNIEnv* env,const std::string& s) {
  if(s.size()>std::size_t(std::numeric_limits<jsize>::max()))throw std::runtime_error("Native result too large");
  auto out=env->NewByteArray(jsize(s.size()));if(!out)return nullptr;
  env->SetByteArrayRegion(out,0,jsize(s.size()),reinterpret_cast<const jbyte*>(s.data()));return out;
}
void error(JNIEnv* env,const std::exception& e){auto cls=env->FindClass("java/lang/IllegalStateException");if(cls)env->ThrowNew(cls,e.what());}
}
extern "C" JNIEXPORT jlong JNICALL Java_com_atlas_nativeapp_NativeCore_create(JNIEnv* env,jobject) {
  try{std::lock_guard<std::mutex> lock(gate);auto id=nextId++;engines.emplace(id,std::make_unique<Engine>());return id;}catch(const std::exception& e){error(env,e);return 0;}
}
extern "C" JNIEXPORT void JNICALL Java_com_atlas_nativeapp_NativeCore_destroy(JNIEnv*,jobject,jlong id) {std::lock_guard<std::mutex> lock(gate);engines.erase(id);}
extern "C" JNIEXPORT void JNICALL Java_com_atlas_nativeapp_NativeCore_openGraph(JNIEnv* env,jobject,jlong id,jstring directory) {
  try{std::lock_guard<std::mutex> lock(gate);auto& e=engine(id);auto path=string(env,directory);if(e.graphPath!=path){auto next=std::make_unique<atlas::Graph>(path);e.graph=std::move(next);e.graphPath=path;}}catch(const std::exception& e){error(env,e);}
}
extern "C" JNIEXPORT void JNICALL Java_com_atlas_nativeapp_NativeCore_openSearch(JNIEnv* env,jobject,jlong id,jstring directory) {
  try{std::lock_guard<std::mutex> lock(gate);auto& e=engine(id);auto path=string(env,directory);if(e.searchPath!=path){auto next=std::make_unique<atlas::Search>(path+"/search-index.bin",path+"/search-records.bin");std::unique_ptr<atlas::Search> address;try{address=std::make_unique<atlas::Search>(path+"/address-index.bin",path+"/address-records.bin");}catch(const std::exception&){}e.search=std::move(next);e.addresses=std::move(address);e.searchPath=path;}}catch(const std::exception& e){error(env,e);}
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_com_atlas_nativeapp_NativeCore_find(JNIEnv* env,jobject,jlong id,jbyteArray query,jdouble lat,jdouble lon,jboolean nearby,jstring category) {
  try{std::lock_guard<std::mutex> lock(gate);auto& e=engine(id);if(!e.search)throw std::runtime_error("Download a region before searching");
    auto n=env->GetArrayLength(query);if(n>1024)throw std::invalid_argument("Query too long");std::string q(std::size_t(n),'\0');env->GetByteArrayRegion(query,0,n,reinterpret_cast<jbyte*>(q.data()));
    auto results=nearby?e.search->nearby({lat,lon},3000,string(env,category)):e.search->query(q,{lat,lon});
    if(!nearby&&e.addresses){auto more=e.addresses->query(q,{lat,lon},10);results.insert(results.end(),more.begin(),more.end());}
    return bytes(env,atlas::placesJson(results));
  }catch(const std::exception& e){error(env,e);return nullptr;}
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_com_atlas_nativeapp_NativeCore_calculate(JNIEnv* env,jobject,jlong id,jdouble a,jdouble b,jdouble c,jdouble d,jboolean walk,jboolean avoid,jdouble penalty,jint vehicle) {
  try{std::lock_guard<std::mutex> lock(gate);auto& e=engine(id);if(!e.graph)throw std::runtime_error("Download a routing region first");atlas::RouteOptions op;op.profile=walk?atlas::Profile::walk:atlas::Profile::drive;op.avoidTolls=avoid;op.penaltyMinutesPerEuro=penalty;op.vehicleClass=vehicle;
    auto start=e.graph->nearest({a,b},op.profile),goal=e.graph->nearest({c,d},op.profile);
    if(!start||!goal)throw std::runtime_error("No accessible road within 2 km of an endpoint");
    auto next=atlas::route(*e.graph,*start,*goal,op);if(!next)throw std::runtime_error("No route connects these points");
    e.route=std::move(next);e.guidance.reset();return bytes(env,atlas::routeJson(*e.route));
  }catch(const std::exception& e){error(env,e);return nullptr;}
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_com_atlas_nativeapp_NativeCore_update(JNIEnv* env,jobject,jlong id,jdouble lat,jdouble lon,jdouble accuracy,jdouble speed,jdouble time) {
  try{std::lock_guard<std::mutex> lock(gate);auto& e=engine(id);if(!e.route)throw std::runtime_error("No active native route");auto g=e.guidance.update({lat,lon},accuracy,speed,time,*e.route);auto& p=g.position;
    const char* states[]={"normal","reduced","checking","reroute","arrived"};std::ostringstream s;s.precision(12);s<<"{\"state\":\""<<states[int(g.state)]<<"\",\"lat\":"<<p.snapped.lat<<",\"lon\":"<<p.snapped.lon<<",\"along\":"<<p.along<<",\"remaining\":"<<p.remaining<<",\"seconds\":"<<p.seconds<<",\"maneuver\":"<<p.maneuver<<",\"toManeuver\":"<<p.toManeuver<<",\"segment\":"<<p.segment<<",\"offRoute\":"<<p.offRoute<<'}';return bytes(env,s.str());
  }catch(const std::exception& e){error(env,e);return nullptr;}
}
