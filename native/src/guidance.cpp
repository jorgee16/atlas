#include "atlas/core.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace atlas {
namespace {
std::string label(const Road &road) {
  if (!road.name.empty() && !road.ref.empty())
    return road.name + " · " + road.ref;
  return road.name.empty() ? (road.ref.empty() ? "Unnamed road" : road.ref)
                           : road.name;
}
std::string ordinal(unsigned n) {
  auto rem = n % 100;
  std::string suffix = "th";
  if (rem < 11 || rem > 13) {
    if (n % 10 == 1)
      suffix = "st";
    else if (n % 10 == 2)
      suffix = "nd";
    else if (n % 10 == 3)
      suffix = "rd";
  }
  return std::to_string(n) + suffix;
}
double legBearing(const Route &r, const Leg &leg, bool end) {
  if (end) {
    for (auto i = leg.last; i > leg.first; --i)
      if (distance(r.points[i - 1], r.points[leg.last]) > .01)
        return bearing(r.points[i - 1], r.points[leg.last]);
  } else {
    for (auto i = leg.first + 1; i <= leg.last; ++i)
      if (distance(r.points[leg.first], r.points[i]) > .01)
        return bearing(r.points[leg.first], r.points[i]);
  }
  return 0;
}
} // namespace
void makeManeuvers(Route &r, const Graph &g) {
  r.maneuvers.clear();
  if (r.legs.empty()) {
    r.maneuvers.push_back({"arrive", "You have arrived", "", 0, 0, {}});
    return;
  }
  const char *cardinals[] = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
  auto firstBearing = legBearing(r, r.legs.front(), false);
  auto direction = cardinals[int(std::floor((firstBearing + 22.5) / 45)) % 8];
  r.maneuvers.push_back(
      {"depart",
       std::string("Head ") + direction + " on " + label(r.legs.front().road),
       label(r.legs.front().road),
       0,
       0,
       {}});
  for (std::size_t i = 1; i < r.legs.size(); ++i) {
    auto &incoming = r.legs[i - 1];
    auto &outgoing = r.legs[i];
    if (outgoing.road.flags & 1) {
      if (incoming.road.flags & 1)
        continue;
      auto last = i;
      while (last + 1 < r.legs.size() && (r.legs[last + 1].road.flags & 1))
        ++last;
      unsigned exits = 0;
      for (auto legIndex = i; legIndex <= last; ++legIndex) {
        auto &leg = r.legs[legIndex];
        for (auto edgeIndex = g.offset(leg.to);
             edgeIndex < g.offset(leg.to + 1); ++edgeIndex) {
          auto edge = g.edge(edgeIndex);
          if (!(g.roadFlags(edge.road) & 1) &&
              g.turnAllowed(leg.to, g.edge(leg.edge).road, edge.road, -1,
                            edge.target))
            ++exits;
        }
      }
      exits = std::max(1u, exits);
      const auto &exitRoad =
          last + 1 < r.legs.size() ? r.legs[last + 1].road : outgoing.road;
      r.maneuvers.push_back({"roundabout",
                             "At the roundabout, take the " + ordinal(exits) +
                                 " exit onto " + label(exitRoad),
                             label(exitRoad),
                             outgoing.startDistance,
                             outgoing.first,
                             {}});
      i = last + 1;
      continue;
    }
    bool same = g.edge(incoming.edge).road == g.edge(outgoing.edge).road ||
                ((!incoming.road.name.empty() || !incoming.road.ref.empty()) &&
                 normalize(incoming.road.name + " " + incoming.road.ref) ==
                     normalize(outgoing.road.name + " " + outgoing.road.ref));
    if ((incoming.road.flags & 1) || same)
      continue;
    double angle = std::fmod(legBearing(r, outgoing, false) -
                                 legBearing(r, incoming, true) + 540,
                             360) -
                   180;
    auto magnitude = std::abs(angle);
    std::string side = angle < 0 ? "left" : "right", type, verb;
    if (magnitude < 18) {
      type = "continue";
      verb = "Continue";
    } else if (magnitude < 45) {
      type = "slight-" + side;
      verb = "Keep " + side;
    } else if (magnitude < 135) {
      type = "turn-" + side;
      verb = "Turn " + side;
    } else {
      type = "sharp-" + side;
      verb = "Make a sharp " + side;
    }
    if (type == "continue" && label(outgoing.road) == "Unnamed road")
      continue;
    std::string instruction;
    if (outgoing.road.flags & 2) {
      instruction = "Take the ramp";
      if (type != "continue")
        instruction += " on the " + side;
      if (!outgoing.road.destination.empty())
        instruction += " toward " + outgoing.road.destination;
      else if (label(outgoing.road) != "Unnamed road")
        instruction += " onto " + label(outgoing.road);
    } else
      instruction = verb + " onto " + label(outgoing.road);
    r.maneuvers.push_back({type, instruction, label(outgoing.road),
                           outgoing.startDistance, outgoing.first,
                           incoming.road.lanes});
  }
  r.maneuvers.push_back(
      {"arrive", "You have arrived", "", r.meters, r.points.size() - 1, {}});
}
namespace {
Progress project(Point p, const Route &r, double low, double high) {
  if (!valid(p) || r.points.empty())
    throw std::invalid_argument("Invalid guidance position or route");
  Progress out;
  out.offRoute = std::numeric_limits<double>::infinity();
  double cumulative = 0, total = 0, bestAlong = 0;
  constexpr double rad = 3.141592653589793 / 180;
  double mx = 111320 * std::max(std::cos(p.lat * rad), .01), my = 111320;
  for (std::size_t i = 1; i < r.points.size(); ++i) {
    auto a = r.points[i - 1], b = r.points[i];
    double x = (a.lon - p.lon) * mx, y = (a.lat - p.lat) * my,
           dx = (b.lon - a.lon) * mx, dy = (b.lat - a.lat) * my;
    double den = dx * dx + dy * dy,
           t = den > 0 ? std::clamp(-(x * dx + y * dy) / den, 0., 1.) : 0,
           d = std::hypot(x + t * dx, y + t * dy), len = distance(a, b);
    const double along = cumulative + t * len;
    // Contextual projection is used only to resolve spatially ambiguous roads.
    if (along >= low && along <= high && d < out.offRoute) {
      out.offRoute = d;
      out.segment = i - 1;
      bestAlong = cumulative + t * len;
      out.snapped = {a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon)};
    }
    cumulative += len;
    total += len;
  }
  if (r.points.size() == 1) {
    out.offRoute = distance(p, r.points[0]);
    out.snapped = r.points[0];
  }
  out.along =
      total > 0 ? std::clamp(bestAlong / total * r.meters, 0., r.meters) : 0;
  out.remaining = std::max(0., r.meters - out.along);
  out.seconds = r.meters > 0 ? r.seconds * out.remaining / r.meters : 0;
  if (!r.maneuvers.empty()) {
    out.maneuver = r.maneuvers.size() - 1;
    for (std::size_t i = 0; i < r.maneuvers.size(); ++i)
      if ((out.along < 25 && i == 0) ||
          (i > 0 && (r.maneuvers[i].at > out.along + 12 ||
                     r.maneuvers[i].type == "arrive"))) {
        out.maneuver = i;
        break;
      }
    out.toManeuver = std::max(0., r.maneuvers[out.maneuver].at - out.along);
  }
  return out;
}
} // namespace
Progress progress(Point p, const Route &r) {
  return project(p,r,-std::numeric_limits<double>::infinity(),
                 std::numeric_limits<double>::infinity());
}
void GuidanceSession::reset() {
  offSince_ = -1;
  lastReroute_ = -1;
  lastTime_ = -1;
  lastGoodTime_ = -1;
  lastGoodSpeed_ = 0;
  offFixes_ = 0;
  implausibleFixes_ = 0;
  implausibleCandidate_.reset();
  deviationMotionPoint_.reset();
  deviationMotionAt_ = -1;
  deviationMotionDistance_ = 0;
  deviationVerifiedAt_ = -1;
  lastPosition_.reset();
  lastGoodPosition_.reset();
}
Guidance GuidanceSession::update(Point p, double accuracy, double speed,
                                 double t, const Route &r) {
  if (!std::isfinite(t) || !std::isfinite(accuracy) || accuracy < 0 ||
      !std::isfinite(speed) || speed < 0)
    throw std::invalid_argument("Invalid GPS fix");
  Guidance out;
  if (lastTime_ >= 0 && t <= lastTime_) {
    // Delayed/out-of-order fixes must not jump the cursor backwards.
    out.position = lastPosition_.value_or(progress(p, r));
    out.state = Guidance::State::reduced;
    return out;
  }
  const double elapsed = lastTime_ < 0 ? 0 : t - lastTime_;
  // A retained projection belongs to the last reliable observation, not to
  // each subsequent poor fix. Match the travel budget's time and speed to
  // that observation, including a motion filter reacquiring from zero speed.
  const double sinceGood = lastGoodTime_ < 0 ? elapsed : t - lastGoodTime_;
  const double travelSpeed = std::max(speed, lastGoodSpeed_);
  out.position = progress(p, r);
  // At a roundabout entrance/exit or an overpass, two route segments can be
  // equally close. Prefer physically reachable progress only within the GPS
  // uncertainty corridor. A clearly different road still takes the normal
  // deviation/confirmation path below; never lock matching to an old segment.
  if (lastGoodPosition_ && elapsed > 0 && elapsed <= 5 && accuracy <= 50) {
    const double total = [&] {
      double n = 0;
      for (std::size_t i=1;i<r.points.size();++i)
        n += distance(r.points[i-1],r.points[i]);
      return n;
    }();
    const double scale = r.meters > 0 ? total/r.meters : 1;
    const double budget = std::max(20.,travelSpeed*sinceGood*1.8+accuracy);
    const auto local = project(p,r,
        (lastGoodPosition_->along-std::max(12.,accuracy))*scale,
        (lastGoodPosition_->along+budget)*scale);
    if (std::isfinite(local.offRoute) &&
        local.offRoute <= out.position.offRoute + std::min(8.,accuracy*.4))
      out.position=local;
  }
  out.observedOffRoute = out.position.offRoute;
  lastTime_ = t;
  if (accuracy > 50) {
    // Ignore unreliable projections while retaining the last reliable
    // along-route position. Never infer new travel from a poor GPS fix.
    if (lastPosition_ && lastPosition_->offRoute <= 80)
      out.position = *lastPosition_;
    offSince_ = -1;
    offFixes_ = 0;
    implausibleCandidate_.reset();
    implausibleFixes_ = 0;
    out.state = Guidance::State::reduced;
    return out;
  }
  // A real private-road diversion can be only 30-70 metres from the route.
  // Reduce the old 80m gate only after two independent plausible moving GPS
  // fixes. Accuracy alone does not prove travel (indoor GNSS can drift).
  const double observedOffRoute = out.position.offRoute;
  if (observedOffRoute <= std::max(12., accuracy * 1.5)) {
    deviationMotionPoint_.reset();
    deviationMotionAt_ = -1;
    deviationVerifiedAt_ = -1;
  } else if (accuracy <= 20 && speed >= .6 &&
             observedOffRoute >= std::max(12., accuracy * 1.5)) {
    if (deviationMotionPoint_ && deviationMotionAt_ >= 0) {
      const double dt = t - deviationMotionAt_;
      const double moved = distance(*deviationMotionPoint_, p);
      if (dt > 0 && dt <= 6 && moved >= 3 &&
          moved <= std::max(20., speed * dt * 3 + accuracy) &&
          observedOffRoute >= deviationMotionDistance_ - 5.)
        deviationVerifiedAt_ = t;
    }
    deviationMotionPoint_ = p;
    deviationMotionAt_ = t;
    deviationMotionDistance_ = observedOffRoute;
  }
  const bool verifiedDeparture =
      deviationVerifiedAt_ >= 0 && t - deviationVerifiedAt_ <= 18 &&
      deviationMotionPoint_ &&
      distance(*deviationMotionPoint_, p) <= std::max(30., accuracy * 2.5);
  const double deviationThreshold = verifiedDeparture
      ? std::max(28., accuracy * 2.5) : std::max(80., accuracy * 2.);
  const bool deviationCandidate = observedOffRoute > deviationThreshold;
  // Without independent movement, stationary off-road wander must not
  // silently replace the last reliable map-matched reference.
  if (!verifiedDeparture && lastGoodPosition_ && speed < .35 &&
      observedOffRoute > std::max(30., accuracy * 2.) &&
      !deviationCandidate) {
    out.position = *lastGoodPosition_;
    lastPosition_ = out.position;
    out.state = Guidance::State::reduced;
    return out;
  }
  // Arrival is a special case: an independent, accurate fix at the actual
  // destination may complete a previously confirmed approach, even when the
  // vehicle is stopped. Merely wandering onto the destination with the old
  // route progress far away must NOT count as arrival.
  if (lastGoodPosition_ && lastGoodPosition_->remaining <= 35. &&
      accuracy <= 35. && speed < 4. &&
      distance(p, r.points.back()) <= std::max(20., accuracy) &&
      out.position.offRoute <= std::max(25., accuracy * 2.)) {
    out.state = Guidance::State::arrived;
    lastPosition_ = out.position;
    return out;
  }
  // Low-speed fixes cannot establish progress along the route by themselves.
  // Indoors GNSS can drift dozens of metres *along* the very same road,
  // producing false distance/ETA changes despite a stationary vehicle.
  // Freeze the last reliable projection until the motion filter confirms movement.
  // Keep the separate off-route flow for genuinely distant observations.
  // Accuracy recovery is not an independent movement observation. The
  // last known speed could be from minutes ago; it does NOT authorize a
  // jump forward once the native motion filter reports zero movement.
  // A background-to-foreground screen sync is a separate Android visual
  // epoch and uses consecutive *real* fixes; routing waits for motion proof.
  if (lastGoodPosition_ && speed < .35 && !deviationCandidate &&
      out.position.offRoute <= std::max(30., accuracy * 2) &&
      lastGoodPosition_->offRoute <= std::max(30., accuracy * 2)) {
    out.position = *lastGoodPosition_;
    lastPosition_ = out.position;
    lastGoodTime_ = t;
    lastGoodSpeed_ = 0;
    offSince_ = -1;
    offFixes_ = 0;
    implausibleCandidate_.reset();
    implausibleFixes_ = 0;
    return out;
  }
  // A global nearest-segment projection may snap onto a distant section of
  // the same route at a loop, parallel street or overpass. Require sustained
  // positional evidence before accepting an impossible instantaneous leap.
  if (lastGoodPosition_ && sinceGood > 0 && sinceGood < 20 &&
      out.position.offRoute <= std::max(45., accuracy * 2)) {
    const double travelBudget =
        std::max(45., travelSpeed * sinceGood * 2.5 + accuracy * 2 + 15);
    const double jump = out.position.along - lastGoodPosition_->along;
    if (std::abs(jump) > travelBudget) {
      if (implausibleCandidate_ &&
          distance(*implausibleCandidate_, p) <= std::max(25., accuracy * 2))
        ++implausibleFixes_;
      else {
        implausibleCandidate_ = p;
        implausibleFixes_ = 1;
      }
      if (implausibleFixes_ < 3) {
        out.position = *lastGoodPosition_;
        out.state = Guidance::State::reduced;
        return out;
      }
    }
  }
  implausibleCandidate_.reset();
  implausibleFixes_ = 0;
  if (out.position.remaining < 25 &&
      distance(p, r.points.back()) < std::max(25., accuracy) && speed < 4) {
    out.state = Guidance::State::arrived;
    return out;
  }
  // Small backward GPS projections are jitter, not reverse travel.
  // Preserve forward guidance progress while remaining within the corridor.
  if (lastPosition_ && out.position.offRoute <= std::max(25., accuracy * 2) &&
      lastPosition_->offRoute <= std::max(25., accuracy * 2) &&
      out.position.along < lastPosition_->along &&
      lastPosition_->along - out.position.along <= std::max(20., accuracy * 2))
    out.position = *lastPosition_;
  if (deviationCandidate) {
    // A distant fix must not teleport the navigation marker onto an
    // unrelated road before sustained deviation has been confirmed.
    // Keep evaluating the raw off-route distance for reroute decisions.
    if (lastGoodPosition_)
      out.position = *lastGoodPosition_;
    lastPosition_ = out.position;
    if (offSince_ < 0)
      offSince_ = t;
    ++offFixes_;
    out.state = Guidance::State::checking;
    // Tell Android that genuine off-road fixes should be drawn unsnapped.
    out.offRouteConfirmed = verifiedDeparture && offFixes_ >= 3 &&
                            t - offSince_ >= 2.;
    if (offFixes_ >= 3 && t - offSince_ >= 5 &&
        (lastReroute_ < 0 || t - lastReroute_ >= 15)) {
      out.state = Guidance::State::reroute;
      lastReroute_ = t;
      offSince_ = -1;
      offFixes_ = 0;
    }
  } else {
    offSince_ = -1;
    offFixes_ = 0;
    lastGoodPosition_ = out.position;
    lastGoodTime_ = t;
    lastGoodSpeed_ = speed;
    lastPosition_ = out.position;
  }
  return out;
}
} // namespace atlas


