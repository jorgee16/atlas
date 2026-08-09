# Search

The local region provider supports two offline paths:

- Nearby discovery uses the uniform-grid index to retrieve POIs within a
  radius of the selected anchor.
- Navigation destination search builds a lazy normalized-name index for the
  installed region containing the route origin. It filters by every query
  token, ranks exact and prefix matches first, then sorts equal matches by
  distance from the origin.

The normalized name index is created only when the route planner performs its
first text search, so ordinary map and nearby use do not pay its memory cost.
