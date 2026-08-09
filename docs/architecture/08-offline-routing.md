# Offline Routing

Roam routing format v3 uses a car profile and estimated travel time as its edge cost.
It runs entirely on installed regional assets:

```text
GPS or selected point
  -> region lookup
  -> contracted binary graph and geometry load
  -> nearest-road-node snapping
  -> connected-component check
  -> turn-restriction-aware A* fastest path
  -> maneuver generation and route progress
  -> Leaflet route, junction arrows, and guidance card
```

Navigation can start through either of two entry points. The selected-point
popup keeps the quick GPS-to-point action. The Navigation panel provides a
dedicated route planner with separate `From` and `To` endpoints: `From` uses
the latest GPS fix by default, while either endpoint can be picked on the map.
The destination field searches POI names in the installed region containing
the start point. Matching is case- and accent-insensitive and is ranked by name
quality, then distance from the start.

A GPS-origin route follows position updates and retains automatic rerouting. A
route whose origin was picked on the map is a fixed preview route; subsequent
real GPS updates do not move its start or trigger recalculation. This also makes
it possible to inspect a London route while the device is physically in a
different installed region.

The C++ packager respects supported OSM `highway` classes, `access`, `vehicle`,
`motor_vehicle`, `oneway`, roundabouts, `maxspeed`, and mph speed tags. Missing
speed limits use conservative class defaults. Speeds are capped at 130 km/h so
the A* heuristic remains admissible.

The native extractor separates A* topology from display geometry. Intersections,
way endpoints, and periodic 200-metre anchors become graph nodes; intermediate
road points are simplified and stored once in `geometry.bin`, shared by both
travel directions. Tracks, parking aisles, and individual driveways are omitted
from the first mobile car profile.

Edges reference compact road records in `roads.bin`. Road names, references,
and sign destinations are deduplicated in `strings.bin`. `restrictions.bin`
stores the common OSM via-node `no_*` and `only_*` car-turn restrictions. A*
keeps separate incoming-road states only at restricted intersections, avoiding
the memory cost of converting the whole regional graph into an edge-based graph.

The runtime selects the one Portugal partition containing both endpoints and
parses its `ArrayBuffer` data in place instead of expanding the graph into JSON
objects. A* uses typed arrays, a binary min-heap, and periodically yields to the
browser. The predecessor edge chain restores the associated road geometry for
the Leaflet polyline. GPS updates trigger a new route only after the user is
more than 80 m from the current polyline and at least 15 seconds have elapsed
since the previous route. Route progress drives a large next-turn arrow,
distance countdown, following maneuver, ETA, remaining time/distance, and up to
three uncluttered maneuver markers on the map. Roundabout instructions count
legal exits. Optional speech uses the device's installed text-to-speech voice.

Routing format v3 deliberately excludes:

- Via-way and conditional OSM turn restrictions.
- Live traffic or congestion weights.
- Lane-level guidance and speed-camera alerts.
- Walking and cycling profiles.
- Cross-region graph stitching.

These can be added without changing the navigation feature contract.
