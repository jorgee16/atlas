# Composable fixed-charge corridor evidence

The country manifest `tools/toll-binding-config/portugal-fixed-corridors.json`
selects the base reviewed Lisbon evidence and an ordered list of independent
corridor reviews. `build-fixed-toll-corridors.py` composes them in temporary
storage. Each review pins its original source geometry and preceding proof SHA;
every stage verifies all seven actual graph hashes and the country identity.
Only the complete final result is written. An invalid, overlapping, corrupt or
foreign stage cannot partially replace the APK evidence.

The original free-corridor compiler still independently reproduces the base.
Additional countries/corridors use data configurations; neither the shared
compiler nor native routing contains a Portugal/A16/A28 branch. No separate
intermediate CSV is checked in for every added motorway. CI reproduces both the
base and the composed final proof against the actual installed graph.

## Price, geography and movement remain separate

Official fixed-price records remain in `toll-charges/<country>.csv`; independent
class values and stable IDs are preserved. Reviews select original directed OSM
ways and physical collection nodes. They cannot authorize a price by finding a
motorway number in a route. The existing geometric witness checks continuous
containment within the original 2 m simplification plus float32 quantization
bound, original direction and monotonic progress. There is no nearest-road or
nearest-plaza fallback. Charging nodes removed by simplification are recovered
only on the witnessed original subpath. Half-open intervals charge a gate at an
edge split once, and exclude it from starts after the gate.

Every collection candidate on the selected source ways requires an explicit
reviewed identity. Every reviewed point must match exactly one directed graph
edge. Ambiguous identity, location or direction blocks generation. Sources,
versions, raw response hashes and ODbL attribution accompany the reviews.

Native matching still requires the **entire actual traversal** to be covered,
including approaches. Unknown approaches remain incomplete. The fixed provider
only changes monetary fields; route points, edges, maneuvers, visual protection,
distance, ETA, GPS prediction and camera behavior remain authoritative and
unchanged. Optional tariff downloads and their offline rollback are independent
of these graph-specific APK bindings.

## Current reviewed scope

The base has 529 A5/Lisbon directed edges and four Carcavelos crossing rows.
A28 adds 918 edges and four collection nodes at Angeiras/Póvoa. A16 adds 315
main-carriageway edges and six nodes at Idanha/Sacotes/Ranholas. The composed
proof therefore has **1,762 edges and 14 crossing rows**. It excludes ramps,
IC16 trunk continuations, IC23 and unreviewed A9 ticket boundaries. This is
increased functional coverage, not complete nationwide confirmed pricing.

The A16 identity review is explicit:

| Tariff identity | Physical nodes | Published collection facility |
| --- | --- | --- |
| `ascendi:grande-lisboa:01` | 517256487, 522464085 | Idanha / IC16–CREL (Colaride) |
| `ascendi:grande-lisboa:02` | 2327143697, 2327143698 | Sacotes / Telhal |
| `ascendi:grande-lisboa:03` | 469970704, 889028787 | Ranholas / Linhó |

Prices come from the already reviewed [Ascendi source intake](../data/toll-evidence/Portugal/2026-10-30/README.md).
Source geometry is the original A16 relation 7301331. Only its 179 motorway
ways are selected: the relation also includes IC16 continuations and Odivelas
collection points which must not be mistaken for A16 plazas. The source
configurations document these exclusions and original node memberships.

The graph's packaged `toll-events.json` is not trusted as geographic review:
it assigns A16:01 to edge 371240 at Ranholas and A16:03 to edge 4220733 at
Idanha. It also places some distinct northern facilities together. Reusing
that legacy metadata would misprice trips. The newly certified source geometry
identifies the actual plaza independently; existing graph files are untouched.

## Stale untolled flag at Ranholas

Edge 4215373 contains the reviewed Ranholas collection node at its start, but
its graph road flag is untolled. The prior fixed-price provider and Android
prefilter refused all routes with no flagged toll distance. A short real route
on that edge therefore returned `none / €0`, despite complete collection proof.

The provider now considers complete physical proof even with zero flagged toll
meters. A nonempty proven crossing sequence is priced; a truly free sequence
retains its original `none` state. JSON price status and `hasTolls` recognize the
confirmed charge without inventing graph distance or changing graph flags.
The Android prefilter still rejects any uncovered edge, and JNI still validates
country, actual graph digests, topology, direction and interval clipping.

This correction does not change avoid-tolls routing weights. A known stale
graph flag can consequently still affect route selection for very short
traversals. Broader correction of graph toll flags requires a separately
validated data update; a confirmed positive charge is no longer displayed as
free. A9 entry/exit pricing and full national collection matching remain open.

## Regression evidence

There are **91 real C++/JNI cases**: 29 A5/IKEA, 28 A28, and 34 A16. A16 adds
all six collection nodes in classes 1–4, starts after every gate, and the
unflagged Ranholas edge in all four classes. The latter must change from
`hasTolls=false / none / €0` to `hasTolls=true / exact / €1.20–€2.95`, while all
authoritative navigation fields remain identical. The free Sacotes departure
must retain `none / €0`; it is not mislabeled as a paid unknown trip.

Android runs the same fixtures against the installed graph and production
country loader/JNI, then captures the complete IKEA MapLibre route preview.
Its UI assertion also checks that floating map actions do not overlap the
confirmed price in the expanded route-options sheet. GPS/camera smoke and
existing C++/Kotlin suites remain mandatory. These are pricing and focused
Android checks, not a claim of another full GPS trip or Via Verde comparison.
