# Full-route prices across reviewed free approaches

The initial A5 proof covered 300 directed main-carriageway edges and four
physical Carcavelos crossing bindings. A route from the approximate postcode
2645-575 to IKEA Loures contained 258 edges, of which only 110 were covered.
Even with the correct plaza tariff, the complete-route gate correctly refused
to certify the trip across its unreviewed approaches.

There was also a geometry-certification limitation: the old builder required
every graph endpoint to be an original OSM vertex. The v6 packager inserts
intermediate endpoints to cap topology segments at 200 m. Several unchanged
IC17 and EN250 segments therefore failed that endpoint test.

## Source review and geometry proof

`tools/toll-binding-config/portugal-lisbon-free-corridors.source.json` records a
bounded snapshot of 99 reviewed source ways and 609 original vertices, fetched
from the official OpenStreetMap API on 2026-10-30. It retains versions, relevant
road/toll/access/direction tags, source-response hashes, ODbL attribution and the
735 physical booth/gantry candidates from the separately recorded national
census. The snapshot includes the public IP attributes corroborating IC17's
non-tolled status. Those attributes do not certify other unnamed roads.

`portugal-lisbon-free-corridors.json` records explicit per-way reviews. The scope
is the Manique/Alcabideche public approaches, the A5-to-IC17 junction, the
reviewed IC17 corridor, and southern A8/Frielas/local access to IKEA. A reviewed
A5 entry ramp has an OSM `toll=yes` network/approach flag but no collection
facility on that way; its downstream Carcavelos crossing remains payable.
This is not a whole-A5 exemption, a global road-name rule or a country default.
Parking fees, special discounts and unreviewed paths are not certified here.

The compiler consumes reviewed source geometry, not route endpoints or expected
prices. It checks source/config/seed hashes, country, source directions and the
absence of physical charging candidates on or within the geometry error bound
of every free source way. Private, explicitly charged, corrupt and unreviewed
source inputs are rejected. These are data-level reviews, not a new entitlement
for arbitrary `toll=no`/missing-tag roads to enter the proof.

`tools/toll_free_geometry.py` certifies a directed clipped subpath when graph
endpoints lie inside source segments. It preserves the original 2 m packager
simplification bound plus measured float32 quantization; it does not enlarge the
bound to fit failures. Monotonic source progress, roundabout wrap, direction and
both directions of geometric containment are checked. Continuous containment
uses convex segment capsules and adaptive subdivision, rather than sparse
samples that could miss a shortcut or a narrow source excursion. No navigation
coordinate is changed by this calculation.

`tools/build-free-toll-corridors.py` certifies all eligible graph edges on the
reviewed source ways, not only edges in a chosen test route. It adds 229 explicit
free coverage rows to the unchanged 300-edge A5 seed, yielding 529 covered edges.
The four existing charged crossing rows remain identical. All seven actual
graph SHA-256 identities remain mandatory. The production Kotlin/C++ matcher
still requires complete explicit coverage of every traversed edge; unknown
approaches do not become zero or exact by omission.

## Observed native results and Android gate

The 21 original real-graph cases remain, including both carriageways, four
classes, starts after the plaza, and an unreviewed Lisbon-to-Cascais itinerary
that must remain incomplete. Eight cases add the full trip to IKEA Loures from
two approximate public postal-code points, for classes 1–4:

| Approximate origin | Distance | Class 1 | Classes 2–4 | Physical charge |
| --- | ---: | ---: | ---: | --- |
| 38.7195949, -9.4135005 | 36.06 km | EUR 1.60 | EUR 3.10 | Carcavelos PV, once |
| 38.725065, -9.414258 | 35.00 km | EUR 1.60 | EUR 3.10 | Carcavelos PV, once |

These 29 actual native route calculations passed locally. Before/after points,
edge indexes, maneuvers, distance, duration and visual protected points are equal.
Expected prices come from the existing official plaza catalog, not from a
Waze-total override. The approximate origins are not the user's precise GPS fix.

The Android CI reproduces the shipped proof against its hash-verified Portugal
graph before launching the emulator. The existing JNI/MapLibre toll test now
requires all 29 cases and renders the full IKEA trip (>30 km) in the production
preview, with a screenshot and confirmed-price text. The export verifier requires
both origins and all four classes. CI artifacts record the executed result;
local native success alone is not an Android/emulator result.

Reproduce the geometry proof with:

```sh
python3 tools/build-free-toll-corridors.py --graph /path/to/verified/mainland --check --report dist/free-corridor-proof.json
python3 -m unittest discover -s tools -p 'test_toll_*.py'
```

The charged seed is retained in
`tools/toll-binding-config/portugal-a5-reviewed-seed.csv`; its hash still matches
the original 2026-10-26 audit. The extension audit is
`docs/data/portugal-lisbon-free-corridors-20261030.json`.

## Scope still open

This extends functional full-trip pricing on the reviewed corridor. It does not
complete national coverage, certify the alternative via A16/A9, activate the
22 new Ascendi charge bindings, combine closed-ticket/fixed schemes, or fill
missing A28/A33/A19 fares. Free routes still use their existing behavior. GPS,
camera, map matching, routing geometry, routing weights and ETA code are
unchanged. A signed Release still needs its existing full validation gates.
