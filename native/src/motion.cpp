#include "atlas/core.hpp"
#include <algorithm>
#include <cmath>
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
      if (travelled >= required && observed >= .55 && plausible) {
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
      if (prev.road != edge.road)
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
