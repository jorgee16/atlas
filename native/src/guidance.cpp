#include "atlas/core.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace atlas {
namespace {
std::string label(const Road& road) {return road.name.empty()?(road.ref.empty()?"Unnamed road":road.ref):road.name;}
double legBearing(const Route& r,const Leg& leg,bool end) {
  if(end) {for(auto i=leg.last;i>leg.first;--i) if(distance(r.points[i-1],r.points[leg.last])>.01)return bearing(r.points[i-1],r.points[leg.last]);}
  else {for(auto i=leg.first+1;i<=leg.last;++i)if(distance(r.points[leg.first],r.points[i])>.01)return bearing(r.points[leg.first],r.points[i]);}
  return 0;
}
}
void makeManeuvers(Route& r,const Graph& g) {
  r.maneuvers.clear();
  if(r.legs.empty()){r.maneuvers.push_back({"arrive","You have arrived","",0,0});return;}
  r.maneuvers.push_back({"depart","Continue on "+label(r.legs.front().road),label(r.legs.front().road),0,0});
  bool inRoundabout=false;unsigned exits=0;
  for(std::size_t i=0;i<r.legs.size();++i) {
    auto& next=r.legs[i];bool round=next.road.flags&1;
    if(round) {
      if(!inRoundabout) {inRoundabout=true;exits=0;}
      bool exit=false;
      for(auto j=g.offset(next.to);j<g.offset(next.to+1);++j) {
        auto ed=g.edge(j);if(ed.allows(Profile::drive)&&ed.target!=next.from&&!(g.road(ed.road).flags&1)&&g.turnAllowed(next.to,g.edge(next.edge).road,ed.road,next.from,ed.target)) exit=true;
      }
      if(exit)++exits;
      continue;
    }
    if(inRoundabout) {r.maneuvers.push_back({"roundabout","Take exit "+std::to_string(std::max(1u,exits))+" onto "+label(next.road),label(next.road),next.startDistance,next.first});inRoundabout=false;continue;}
    if(!i)continue;
    auto& prev=r.legs[i-1];double delta=std::fmod(legBearing(r,next,false)-legBearing(r,prev,true)+540,360)-180;
    bool same=prev.road.name==next.road.name&&prev.road.ref==next.road.ref;
    if(std::abs(delta)<18&&same)continue;
    std::string side=delta<0?"left":"right",type,action;
    if(std::abs(delta)<18){type="continue";action="Continue";}
    else if(std::abs(delta)<45){type="slight-"+side;action="Keep "+side;}
    else if(std::abs(delta)<135){type="turn-"+side;action="Turn "+side;}
    else {type="sharp-"+side;action="Turn sharply "+side;}
    r.maneuvers.push_back({type,action+" onto "+label(next.road),label(next.road),next.startDistance,next.first});
  }
  r.maneuvers.push_back({"arrive","You have arrived","",r.meters,r.points.size()-1});
}
Progress progress(Point p,const Route& r) {
  if(!valid(p)||r.points.empty())throw std::invalid_argument("Invalid guidance position or route");
  Progress out;out.offRoute=std::numeric_limits<double>::infinity();double cumulative=0,total=0,bestAlong=0;
  constexpr double rad=3.141592653589793/180;
  double mx=111320*std::max(std::cos(p.lat*rad),.01),my=111320;
  for(std::size_t i=1;i<r.points.size();++i) {
    auto a=r.points[i-1],b=r.points[i];double x=(a.lon-p.lon)*mx,y=(a.lat-p.lat)*my,dx=(b.lon-a.lon)*mx,dy=(b.lat-a.lat)*my;
    double den=dx*dx+dy*dy,t=den>0?std::clamp(-(x*dx+y*dy)/den,0.,1.):0,d=std::hypot(x+t*dx,y+t*dy),len=distance(a,b);
    if(d<out.offRoute) {out.offRoute=d;out.segment=i-1;bestAlong=cumulative+t*len;out.snapped={a.lat+t*(b.lat-a.lat),a.lon+t*(b.lon-a.lon)};}
    cumulative+=len;total+=len;
  }
  if(r.points.size()==1){out.offRoute=distance(p,r.points[0]);out.snapped=r.points[0];}
  out.along=total>0?std::clamp(bestAlong/total*r.meters,0.,r.meters):0;out.remaining=std::max(0.,r.meters-out.along);out.seconds=r.meters>0?r.seconds*out.remaining/r.meters:0;
  if(!r.maneuvers.empty()) {
    out.maneuver=r.maneuvers.size()-1;
    for(std::size_t i=0;i<r.maneuvers.size();++i) if((out.along<25&&i==0)||(i>0&&(r.maneuvers[i].at>out.along+12||r.maneuvers[i].type=="arrive"))){out.maneuver=i;break;}
    out.toManeuver=std::max(0.,r.maneuvers[out.maneuver].at-out.along);
  }
  return out;
}
void GuidanceSession::reset(){offSince_=-1;lastReroute_=-1;lastTime_=-1;offFixes_=0;}
Guidance GuidanceSession::update(Point p,double accuracy,double speed,double t,const Route& r) {
  if(!std::isfinite(t)||!std::isfinite(accuracy)||accuracy<0||!std::isfinite(speed)||speed<0)throw std::invalid_argument("Invalid GPS fix");
  Guidance out;out.position=progress(p,r);
  if(lastTime_>=0&&t<=lastTime_){out.state=Guidance::State::reduced;return out;}
  lastTime_=t;
  if(accuracy>50){offSince_=-1;offFixes_=0;out.state=Guidance::State::reduced;return out;}
  if(out.position.remaining<25&&distance(p,r.points.back())<std::max(25.,accuracy)&&speed<4){out.state=Guidance::State::arrived;return out;}
  double threshold=std::max(80.,accuracy*2);
  if(out.position.offRoute>threshold) {
    if(offSince_<0)offSince_=t;
    ++offFixes_;out.state=Guidance::State::checking;
    if(offFixes_>=3&&t-offSince_>=5&&(lastReroute_<0||t-lastReroute_>=15)) {out.state=Guidance::State::reroute;lastReroute_=t;offSince_=-1;offFixes_=0;}
  } else {offSince_=-1;offFixes_=0;}
  return out;
}
} // namespace atlas
