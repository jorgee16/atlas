# Issue #2: graph-bound toll evidence

Base: `eb647fd7c11b61b822fb5e0712d88b064ed296ea` (v0.2.17).
The seven distributed mainland graph files are unchanged. Their actual SHA-256
values, the catalog hashes/revisions, public origins and per-candidate blockers
are in `../data/issue-2/{baseline-summary,after-summary}.json`.

## Findings and implementation

The Android loader rejected the entire graph proof if one route edge lacked a
manual coverage row. The C++ matcher also required completeness; removing only
the Android check would not have extended confirmed prices. Graph evidence now
loads before the route search, independently of pricing completeness. Native
matching retains uncovered edges, known crossings and explicit failure reasons.
Unknown sections still prevent an exact trip total.

The published graph has synthetic edge endpoints and can merge consecutive OSM
ways across a source attribute split. Requiring a source vertex at every graph
endpoint or treating every unmatched street as a toll prevented valid prices.
The compiler retains the existing continuous geometric bound (2 m plus measured
float quantization), supports explicitly reviewed node-connected directed chains,
and adds independently reviewed local approaches. It does not certify all roads
near a GPS route, infer free passage from `toll=no`, or increase the geometry error
bound. Paid/private approach ways are excluded from the local-street review.

Fixed and entry/exit providers previously ran separately. One atomic provider now
validates country, scheme, class, currency, year, network, ordered entry/exit,
actual clipped traversal, catalog fare and graph identity before summing minor
currency units. Paid-network intervals prevent a trip starting inside a ticket
system, or continuing beyond an observed exit, from becoming a fictional free or
fully priced trip. Missing fares never become a partial total. A failed recheck
cannot retain an old exact quote.

Avoid tolls now checks known physical collection points and paid-network
intervals before accepting an edge, including initial GPS clipping. It preserves
explicit legal class exemptions. Proven free intervals may disprove obsolete
paid flags; unknown remaining streets still do not certify the trip as free.
Only this explicit avoidance correction changes route selection. The 32 ordinary
search candidates retain exactly their Release geometry, edges, distance, ETA,
maneuvers and protected visual points. Four avoidance searches intentionally
change. Pricing itself changes none of these fields.

## Added geographical evidence

- 1,762 -> 3,622 reviewed directed graph edges (+1,860, 105.6%).
  This phase adds 1,141 edges to the previously reviewed 2,481.
- 410 additional A14/A1/Fatima edges, 408 bounded paid-network intervals and two
  physical entry/exit events. Coimbra Norte is the A14/IP3 entry into the A1
  network, not an arbitrary nearest A1 point.
- Station 0117 at OSM node 8501324196 -> station 0122 at node 319886078 follows
  the actual 85.15 km route. Classes 1–4: 7.65 / 13.35 / 17.25 / 19.05 EUR.
  Only this reviewed direction/corridor is activated. Starting inside the network
  without an observed entry remains unavailable.
- 114 reviewed public approach source ways add 284 graph edges around Manique,
  Cascais, Oeiras and Carcavelos. The independent 735-point collection census
  guards the complete source geometries. Paid motorway connectors and private
  service roads remain excluded.
- The Oeiras I entrance/exit and Carcavelos I Lisbon-bound booth/Via Verde
  approaches add 25 edges and four physical events. Brisa's Oeiras access notice
  distinguishes Oeiras/Paco de Arcos from Porto Salvo/Cacem; the A5 traffic study
  identifies the Lisbon-bound Carcavelos I entrance. Their current prices come
  exclusively from the official 2026 fixed catalog, not historical OSM fee tags
  or the traffic study's proposed dynamic prices.
- A real Oeiras source split exposed a floating-point boundary: projection sums
  could put the same gate at the incoming edge's end and outgoing edge's start.
  The compiler now uses the packager's exact float32 source-node identity to
  assign that boundary only to the outgoing edge. The continuous geometric
  bound is unchanged. The regression and graph audit require one assignment per
  physical node; genuine later crossings are not globally deduplicated.
- All original A5/A28/A16 physical bindings and original fare cells are preserved.
  `composed-binding-proof.json` records every stage, source/seed digest and witness.

## Before/after measured matrix

Eight public origins to IKEA Loures; **40 raw native search candidates**, including
candidates Android may reject for duplication or detour. These are not claimed
as forty visible UI alternatives, or as the reporter's private GPS origin.

| State | Release baseline | This change |
|---|---:|---:|
| Confirmed exact | 2/40 (5%) | 14/40 (35%) |
| Estimate | 28/40 (70%) | 16/40 (40%) |
| Verified free | 0/40 | 0/40 |
| Unavailable / unverified free | 10/40 (25%)* | 10/40 (25%) |

*The old renderer presented these ten unverified paths as `none/0`. They are
reclassified here to expose the original confidence defect, not credited as
verified free. Original emitted counts remain in the baseline JSON.

Among the eight recommended routes, confirmed coverage rises from 2/8 to 6/8
(25% -> 75%). Public south, public north, Manique and Cascais show the actual
Carcavelos PV 1.60 EUR charge for class 1. Oeiras I and Carcavelos I now correctly quote their own entrance fees,
0.40 and 0.70 EUR in class 1; neither inherits the 1.60 EUR mainline plaza fee.
Classes 2/3/4 are respectively 0.75/0.75/0.75 and 1.35/1.35/1.35 EUR.

## Validation and reproducibility

Local: five C++ suites, 55 Python toll/section-provider tests, 33 JS routing/toll/ETA/UI tests.
222 actual native route/class cases pass against the distributed mainland graph,
including the original 91 CSV cases, eight new public approaches, four A1 classes,
one start-inside-network case 28 Oeiras/Carcavelos access cases and 90 A9/A16 cases. The two original unavailable-class/tariff JNI
regressions remain mandatory, making **224 Android price cases**. All original
93 cases are retained. Android execution and screenshots must be checked in the
PR CI; local native results alone are not emulator evidence.

```
python3 tools/build-free-toll-corridors.py --graph GRAPH --check
python3 tools/build-fixed-toll-corridors.py --graph GRAPH --check
python3 tools/diagnose-toll-routes.py --binary BUILD/atlas_toll_audit \
  --graph GRAPH --output REPORT
```

Android artifacts record the real accepted UI options separately from raw
search candidates, confirmed detail, A1 preview, MapLibre screenshots, unchanged
navigation fields and the existing HUD collision assertions. Existing GPS/camera
smoke and full-trip release gates remain mandatory. No Release is published by
this PR; no key, application ID or version identity is replaced.

## Remaining limits and concrete next evidence

This is not exact nationwide pricing and must not close the issue on that claim.
A9/A16 alternatives have different physical itineraries despite similar road
summaries. The actual accepted public-origin alternative through Ranholas,
IC19, Queluz II and Loures now has a class-1 total of 3.00 EUR: 1.20 + 1.80.
It is not the Waze screenshot's different A16-through-A9 itinerary; its 4.00 EUR
was not copied into the catalog. Normal routing/ETA and alternative generation
are unchanged. Some other origins still have unreviewed municipal approaches,
so containing A9 does not certify their entire trip.

The eight A9 section tariffs and 54 reviewed directed section paths now cover
the actual access sequence through Alverca PV/node, including its distinct lane
geometries. Continuations inside the A1/A10 ticket network beyond the reviewed
settlement points, and same-station or Queluz PV/II return circuits, remain
unavailable unless their entire actual itinerary has independent proof. No
return-loop zero or maximum fare is inferred from section distances.

Oeiras I and Carcavelos I are now reviewed, including all four vehicle
classes, both Oeiras I directions, traditional/Via Verde Carcavelos I approaches,
starts after each gate and the full public IKEA trips. Oeiras II and Carcavelos II
remain outside this review; their identities must not be inferred from the
nearby reviewed plazas. Source review: `portugal-a5-reviewed-accesses.json`.
Unknown intervals and first blocking edge IDs remain exported for every case.

Partial A28/A4/A13 exemptions remain scoped. The A41 heavy-vehicle exemption is
supported by the IP FAQ: its all-day toll exemption must not be confused with the
07–21 weekday VCI circulation restriction. Source conflicts are not resolved by
choosing the cheaper number. No bridge direction or partial exemption is inferred
from its road reference. No new bridge coverage is claimed.

No simulator quote, Via Verde API validation, real driving, tunnel, or national
offline field test is claimed by these results.

## A9/A16 completion of the reviewed corridors (2026-11-08)

The new source review adds 33 physical points (including the local Idanha lanes)
and four barrier-free A16/A9 access boundaries. Those boundaries are explicitly
not booths. Their graph-bound adjacent-facility requirements prevent a start
inside the system or an internal turn-around from creating a fictional partial
ticket. An entry requires the preceding Idanha crossing; an exit requires the
following crossing. Real repeated physical passages remain chargeable.

The tariff compiler reproduces all 32 class cells of the IMT's eight 2026 A9
sections from the vendored SHA-bound official snapshot. Its 54 explicitly
reviewed directed paths are finite section sums, never per-kilometre estimates.
It independently checks 180 class cells in the already published Brisa directed
matrix, including both Alverca PV and Alverca node settlement identities. All
4,166 original published fare rows remain unchanged. The composite offline
catalog contains 4,220 rows, revision 2026110801. No missing reverse matrix cell
is filled by symmetry. Original section order and explicit travel direction
are recorded in the review.

Native quotes use the source and public network/station names of the provider
actually used. The A16 fixed facilities remain separate from the A9-only sums:
Idanha is neither silently removed nor charged twice. C++ tests cover missing,
out-of-order and exit-side adjacent collection, and preserve authoritative
navigation data on both successful and rejected prices.

The 90 added real-graph cases include classes 1–4, both A9 directions, Alverca
PV/node, selected Via Verde lane endpoints, local Idanha access, A16/A9 trips,
and unavailable internal starts. Android verifies the actual accepted 3.00 EUR
IKEA alternative and captures the Sacotes/A16/A9-to-IKEA 2.80 EUR preview and
A9-through-Alverca 3.75 EUR preview. These are distinct origins/itineraries,
not quotations for every trip from the reporter's postcode.

The historical IMT DDIE document identifies facilities, not 2026 prices or
lane-level GPS coordinates. Original directed OSM geometry supplies the latter;
shared/erroneous DDIE coordinate groups are not used to snap a gate. The current
IMT and Ascendi tariffs supply the monetary values. No successful Via Verde or
IP simulator quote is claimed in this phase.
