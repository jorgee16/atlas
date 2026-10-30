#include "atlas/core.hpp"
#include <algorithm>
#include <cmath>
#include <cctype>
#include <set>
#include <stdexcept>
namespace atlas {
namespace {
double normalizeHeading(double value) {
  return std::fmod(std::fmod(value, 360) + 360, 360);
}
double delta(double a, double b) {
  return std::fmod(normalizeHeading(b) - normalizeHeading(a) + 540, 360) - 180;
}
} // namespace
Motion MotionFilter::update(const MotionFix &fix) {
  if (!valid(fix.point) || !std::isfinite(fix.accuracy) || fix.accuracy < 0 ||
      !std::isfinite(fix.timestamp))
    throw std::invalid_argument("Invalid motion fix");
  if (lastTimestamp_ >= 0 && fix.timestamp <= lastTimestamp_)
    return {speed_, heading_, moving_};
  lastTimestamp_ = fix.timestamp;
  double providerSpeed =
      fix.speed && std::isfinite(*fix.speed) && *fix.speed >= 0 ? *fix.speed
                                                                : 0;
  double inferredSpeed = 0;
  bool inferredSpeedValid = false;
  if (!anchor_)
    anchor_ = fix;
  else {
    double age = fix.timestamp - anchor_->timestamp;
    if (age > 15) {
      anchor_ = fix;
      moving_ = false;
      speed_ = 0;
      lastMove_.reset();
    } else if (age > 0) {
      // A parked 20-50 m accuracy fix can become the stationary anchor.
      // When the receiver subsequently obtains accurate fixes with a
      // corroborating nonzero provider speed, do not require the pedestrian
      // to travel half the OLD accuracy radius before walking is recognized.
      // Rebase once to the first accurate moving candidate, then still require
      // multiple fixes with >=4 m real displacement. GPS drift with zero
      // provider speed never triggers this confidence upgrade.
      const bool accurateMovingCandidate =
          !moving_ && providerSpeed >= .45 && fix.accuracy <= 10. &&
          anchor_->accuracy >= 15. &&
          distance(anchor_->point, fix.point) <=
              std::max(20., anchor_->accuracy * 2.);
      if (accurateMovingCandidate) {
        anchor_ = fix;
      }
      age = fix.timestamp - anchor_->timestamp;
      double travelled = distance(anchor_->point, fix.point),
             observed = travelled / age;
      double required =
          std::max(4., std::max(fix.accuracy, anchor_->accuracy) * .5);
      bool plausible =
          !fix.speed || observed <= std::max(3.5, providerSpeed * 3);
      // Unreliable GNSS may drift tens of metres along a perfectly routable
      // road while the device stays parked. Distance alone is not motion:
      // infer speed without provider telemetry only at good GNSS accuracy;
      // likewise a reported zero speed must veto distance-derived motion.
      const bool trustworthyDisplacement =
          fix.accuracy <= (fix.speed ? 35. : 15.) &&
          anchor_->accuracy <= (fix.speed ? 35. : 15.);
      const bool providerNotStopped = !fix.speed || providerSpeed >= .35;
      if (travelled >= required && observed >= .55 && plausible &&
          trustworthyDisplacement && providerNotStopped) {
        auto course = bearing(anchor_->point, fix.point);
        heading_ =
            heading_
                ? normalizeHeading(*heading_ + delta(*heading_, course) * .35)
                : course;
        moving_ = true;
        inferredSpeed = observed;
        inferredSpeedValid = true;
        lastMove_ = fix.timestamp;
        anchor_ = fix;
      } else if (moving_ && lastMove_ && fix.timestamp - *lastMove_ >= 4) {
        moving_ = false;
        speed_ = 0;
        anchor_ = fix;
      }
    }
  }
  // Location providers may omit speed (e.g. coarse fixes or GPS recovery).
  // Fall back to displacement-derived speed only after motion was confirmed.
  const double measuredSpeed = fix.speed && std::isfinite(*fix.speed) &&
                                       *fix.speed >= 0
                                   ? providerSpeed
                                   : (inferredSpeedValid ? inferredSpeed : speed_);
  speed_ = moving_ ? (speed_ > 0 ? speed_ * .65 + measuredSpeed * .35
                                 : measuredSpeed)
                   : 0;
  auto heading = heading_;
  if (!heading && fix.heading && std::isfinite(*fix.heading))
    heading = normalizeHeading(*fix.heading);
  return {speed_, heading, moving_};
}
double carHeading(double gps, double route, double speed, double accuracy,
                  double offRoute) {
  if (!std::isfinite(route))
    return normalizeHeading(gps);
  if (!std::isfinite(gps))
    return normalizeHeading(route);
  double weight = .78 - std::clamp((speed - 3) / 12, 0., 1.) * .18;
  if (accuracy <= 12)
    weight -= .04;
  else if (accuracy >= 25)
    weight += .06;
  double corridor = std::max(50., accuracy * 1.5);
  weight *=
      1 -
      std::clamp((offRoute - corridor * .45) / (corridor * .7), 0., 1.) * .78;
  double disagreement = std::abs(delta(gps, route));
  if (speed >= 4 && accuracy <= 35 && disagreement > 35)
    weight *= 1 - std::clamp((disagreement - 35) / 70, 0., 1.) * .55;
  weight = std::clamp(weight, .12, .84);
  return normalizeHeading(gps + delta(gps, route) * weight);
}
namespace {
std::set<std::string> etaRefs(const std::string &ref) {
  std::set<std::string> out;
  std::string token;
  for (unsigned char c : ref + ";") {
    if (c == ';' || c == ',' || c == '/') {
      if (!token.empty()) out.insert(token);
      token.clear();
    } else if (!std::isspace(c)) token += char(std::toupper(c));
  }
  return out;
}
bool etaSameRoad(const Road &a, const Road &b) {
  const auto ar=etaRefs(a.ref), br=etaRefs(b.ref);
  if (!ar.empty() || !br.empty()) {
    for (const auto &ref:ar) if (br.count(ref)) return true;
    return false;
  }
  return !a.name.empty() && a.name==b.name;
}
std::optional<double> etaLegBearing(const Route &r, const Leg &leg, bool atEnd) {
  if (leg.first>=leg.last || leg.last>=r.points.size()) return std::nullopt;
  if (atEnd) {
    for (auto i=leg.last; i>leg.first; --i)
      if (distance(r.points[i-1],r.points[leg.last])>.1)
        return bearing(r.points[i-1],r.points[leg.last]);
  } else {
    for (auto i=leg.first+1; i<=leg.last; ++i)
      if (distance(r.points[leg.first],r.points[i])>.1)
        return bearing(r.points[leg.first],r.points[i]);
  }
  return std::nullopt;
}
bool etaContinuesRoad(const Route &r, std::size_t i, const Graph &g,
                      unsigned cls, unsigned previousClass) {
  const auto &previous=r.legs[i-1], &current=r.legs[i];
  if (previous.to!=current.from || previous.from==current.to) return false;
  if ((previous.road.flags^current.road.flags)&(2|4|8)) return false;
  const bool previousCircle=previous.road.flags&1, currentCircle=current.road.flags&1;
  // Circulating inside one connected roundabout does not incur another
  // entry/exit delay for each OSM way. Entry and exit still retain their delay.
  if (previousCircle && currentCircle) return true;
  if (previousCircle!=currentCircle || cls!=previousClass ||
      bool(previous.road.flags&2)!=bool(current.road.flags&2) ||
      !etaSameRoad(previous.road,current.road)) return false;
  const auto incoming=etaLegBearing(r,previous,true);
  const auto outgoing=etaLegBearing(r,current,false);
  if (!incoming || !outgoing || std::abs(delta(*incoming,*outgoing))>25) return false;
  // Mainline motorway/trunk continuation past a slip road is not a stop.
  // For local roads retain the existing junction allowance at branches and
  // restricted nodes, even when the street name/ref stays the same.
  if (cls>2) {
    if (g.restricted(current.from)) return false;
    for (auto edge=g.offset(current.from);edge<g.offset(current.from+1);++edge) {
      const auto next=g.edge(edge);
      if (next.allows(Profile::drive) && next.target!=previous.from &&
          next.target!=current.to) return false;
    }
  }
  return true;
}
}
void calibrateDriveEta(Route &r, const Graph &g) {
  static const double shortCaps[] = {35, 110, 90, 55, 50, 45, 28, 18, 12, 35};
  static const double longCaps[] = {35, 110, 90, 65, 60, 50, 28, 18, 12, 40};
  double elapsed = 0;
  for (std::size_t i = 0; i < r.legs.size(); ++i) {
    auto &leg = r.legs[i];
    auto edge = g.edge(leg.edge);
    auto cls = (edge.attributes >> 24) & 127;
    double cap =
        (r.meters <= 15000 ? shortCaps : longCaps)[cls <= 9 ? cls : 0] / 3.6;
    double transition = 0;
    if (i > 0) {
      auto prev = g.edge(r.legs[i - 1].edge);
      auto pc = (prev.attributes >> 24) & 127;
      if (prev.road != edge.road && !etaContinuesRoad(r,i,g,cls,pc))
        transition = (leg.road.flags & 1) || (r.legs[i - 1].road.flags & 1) ? 7
                     : std::min(cls, pc) <= 2                               ? 2
                     : std::min(cls, pc) <= 4                               ? 4
                                                                            : 6;
    }
    double endpoints =
        r.meters <= 15000
            ? ((i == 0 ? 10 : 0) + (i + 1 == r.legs.size() ? 10 : 0))
            : 0;
    leg.duration =
        std::max(leg.duration, leg.distance / cap) + transition + endpoints;
    elapsed += leg.duration;
  }
  r.seconds = elapsed;
}
} // namespace atlas
