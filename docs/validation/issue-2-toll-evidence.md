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

- 1,762 -> 2,456 reviewed directed graph edges (+694, 39.4%).
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
- All original A5/A28/A16 physical bindings and original fare cells are preserved.
  `composed-binding-proof.json` records every stage, source/seed digest and witness.

## Before/after measured matrix

Eight public origins to IKEA Loures; **40 raw native search candidates**, including
candidates Android may reject for duplication or detour. These are not claimed
as forty visible UI alternatives, or as the reporter's private GPS origin.

| State | Release baseline | This change |
|---|---:|---:|
| Confirmed exact | 2/40 (5%) | 4/40 (10%) |
| Estimate | 28/40 (70%) | 26/40 (65%) |
| Verified free | 0/40 | 0/40 |
| Unavailable / unverified free | 10/40 (25%)* | 10/40 (25%) |

*The old renderer presented these ten unverified paths as `none/0`. They are
reclassified here to expose the original confidence defect, not credited as
verified free. Original emitted counts remain in the baseline JSON.

Among the eight recommended routes, confirmed coverage rises from 2/8 to 4/8
(25% -> 50%). Public south, public north, Manique and Cascais show the actual
Carcavelos PV 1.60 EUR charge for class 1. Oeiras and Carcavelos do not inherit
that price merely because their road summary also contains A5.

## Validation and reproducibility

Local: five C++ suites, 49 Python toll tests, 33 JS routing/toll/ETA/UI tests.
104 actual native route/class cases pass against the distributed mainland graph,
including the original 91 CSV cases, eight new public approaches, four A1 classes
and one start-inside-network case. The two original unavailable-class/tariff JNI
regressions remain mandatory, making **106 Android price cases**. All original
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
summaries. Ranholas fixed charges remain verified, but the A9 connection requires
independent plaza identification and an applicable **published directed** fare;
the matrix's outside-operator rows must not be reversed by assumed symmetry.
The screenshot's 4.00 EUR cannot simply be copied to A16 -> IC19 -> A9.

Oeiras and Carcavelos local accesses contain separate real collection facilities.
Their paid approach lanes are excluded from free review until each source node,
direction and published I/II plaza identity is unambiguously matched. The next
addition should review those facilities individually, then compose them with
existing corridor evidence. Unknown intervals and first blocking edge IDs are
exported for every case; do not replace them with national zero prices.

Partial A28/A4/A13 exemptions remain scoped. The A41 heavy-vehicle exemption is
supported by the IP FAQ: its all-day toll exemption must not be confused with the
07–21 weekday VCI circulation restriction. Source conflicts are not resolved by
choosing the cheaper number. No bridge direction or partial exemption is inferred
from its road reference. No new bridge coverage is claimed.

No simulator quote, Via Verde API validation, real driving, tunnel, or national
offline field test is claimed by these results.
