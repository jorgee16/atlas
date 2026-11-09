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
proof originally had 1,762 edges and 14 crossing rows. Issue #2 extends it
with the A14/A1 Coimbra Norte–Fatima ticket corridor, public approaches and
reviewed Oeiras I / Carcavelos I ramps. The A9 network phase and the national
Ascendi and expanded A1 phases now bring the composed proof to **5,920 directed coverage edges,
2,425 paid-network intervals and 111 physical event rows**. The Ascendi phase adds
792 witnessed edges and 24 directed crossings for 12 facilities on A4, A17,
A29 and A42. IC16 trunk continuations, IC23 and the Oeiras II / Carcavelos II
facilities remain excluded. A41 remains excluded because 36 supplied price rows
conflict; choosing one would manufacture an official price. This is
increased functional coverage, not complete nationwide confirmed pricing.

Each new facility has an explicit original OSM collection node in each travel
direction and a stable ID from the official 2026 Ascendi catalog. The compiler
requires all 24 nodes to match exactly once on the immutable distributed graph.
It ignores the graph's legacy event identities, which conflate some northern
facilities. No road-number or nearest-road fallback is used.

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
Android loads graph proof independently of route completeness. JNI validates
country, actual graph digests, topology, direction and interval clipping; the
native engine requires complete applicable evidence before confirming a total.

Avoid-tolls now consults physically reviewed collection points and paid-network
intervals instead of relying solely on obsolete flags. Ordinary routing costs,
GPS and map matching are unchanged. Complete national collection matching
remains open.

Collection evidence is also independent of tariff availability. If an updated
table omits a proven collection ID, or a vehicle class is unsupported, the
result must retain `hasTolls=true`, `tollPricing=unavailable` and a null amount.
It must not fall back to the old untolled flag and display zero. The route keeps
a dedicated physical-evidence flag for this monetary distinction; graph toll
meters, navigation geometry and progress are not fabricated.

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

Two additional real JNI failure cases remove Ranholas from the fixed table and
request unsupported class 99. Both require unavailable/null, preserve the known
collection and all navigation fields, and export
`unavailable-crossing-quotes.json`. This makes 93 instrumented price cases,
including the 91 ordinary route/class scenarios.

## Reviewed A5 accesses (2026-11-08)

`portugal-a5-reviewed-accesses.json` adds the Oeiras I entry/exit and the
Lisbon-bound Carcavelos I entrance, including its traditional and Via Verde lanes.
The fixed 2026 catalog is unchanged: Oeiras I classes 1–4 cost
0.40/0.75/0.75/0.75 EUR; Carcavelos I costs 0.70/1.35/1.35/1.35 EUR.

Physical identity and tariff provenance are separate. A Brisa access notice
identifies Oeiras I by its Oeiras/Paco de Arcos destination; a traffic study names
the Lisbon-bound Carcavelos I entrance. Historical OSM fees and proposed dynamic
prices in that study are not used. Original directed source ways match the
unchanged distributed graph within the existing simplification/quantization bound.

At the Oeiras exit, floating-point projection sums could include a shared gate
on both adjacent graph edges. Exact float32 source-node identity now gives it
to the outgoing edge only. This does not relax geometric tolerances or suppress
real repeated passages. The real-node regression, one-match-per-gate audit and
28 new actual route/class/after-gate scenarios protect this boundary.

All 93 original JNI price cases and the 13 earlier issue-2 additions remain,
bringing required Android coverage to **134 price cases**. Two additional actual
MapLibre previews show the complete IKEA routes from Oeiras and Carcavelos with
their own prices. The full GPS Release gate remains separate and unchanged.

## Barrier-free network accesses and official section paths

`networkAccessPoints` describes explicit entry/exit points on original directed
motorway links, separately from `chargeCandidates` (physical booths/gantries).
Each must bound a reviewed paid interval. `requiresFixedCharge` is emitted into
the graph proof as an entry-side or exit-side adjacency requirement. Native
matching enforces it on the ordered actual crossing sequence. A fare download
cannot delete this geographical condition. Unknown or out-of-order access
stays unavailable; it cannot become a partial or zero ticket total.

`compose-reviewed-section-fares.py` compiles explicitly reviewed country data,
not a routing fallback. It validates every named class cell against a vendored
SHA-bound official source, preserves the original published catalog byte-for-byte
at row level, checks independent directed matrix cells and emits only the
configured ordered section paths. No currency, class multiplier, missing
reverse pair or same-station zero is guessed. The original PDF importer remains
unchanged; the separate composition is reproduced after it in the source audit.
Network/station labels and network-specific source metadata keep internal
provider IDs out of ordinary route price details.

Portugal's new A9 review binds its eight sections through Alverca and the A16
interchange. Idanha remains a separate fixed facility; its A9 sums begin at the
actual A16/A9 access and exclude that fixed fee. Other country providers use the
same compiler and native matcher through configuration. No GPS, camera, map
matching, route cost or geometry algorithm is involved.

## A4, A17, A29 and A42 fixed facilities (2026-11-08)

The supplied 2026 evidence contains 967 price rows but does not itself prove
where a route crosses a charge. `prepare-reviewed-ascendi-corridors.py` converts
explicitly reviewed OSM API captures into four source/review stages. The mapping
from a physical node to a stable charge ID is input to the generator; it never
discovers a price or assigns the nearest motorway. Bounded directed context is
included before and after each facility and stops at any other collection point.

The resulting stages cover two A4 facilities, three A17 facilities, four A29
facilities and three A42 facilities. All four vehicle classes use the independent
published values in `toll-charges/Portugal.csv`. Ninety-six actual native routes
exercise all 24 directed crossings and all 12 price identities. All 96
produce exact totals while route points, edge indexes, maneuvers, distance, ETA
and protected visual points remain unchanged. See the geographical correction
in the issue validation report: runtime arithmetic alone cannot validate a
tariff-to-facility identity.

The A29 stage now includes all 357 original directed main-carriageway ways in
relation 7301357, excluding its four service areas. All eight collection nodes
must retain explicit identities; a new unmapped collection node blocks generation.
This adds 433 graph edges beyond the short facility contexts. Eight additional
native/Android fixtures connect the four facilities over 39.44/39.54 km in the
two directions, classes 1–4. Their ordered charges total EUR 1.90/3.35/4.25/4.75.
Interchange ramps and unreviewed external approaches still cannot inherit full
coverage merely from joining A29.

## A1 station block

The A1 stage now binds 32 directed collection nodes at 13 reviewed stations
between Grijó PV and Torres Novas. Its 1,916 graph edges include all legal
captured branches between each gate and the main carriageways, rather than
only the first branch found. Directed source traversal stops at other gates.
Pombal's local turn-arounds require explicitly reviewed entry/exit signage;
reachability alone is ambiguous there. The Leiria exit's outgoing IC36 source
way owns its booth under the existing half-open interval rule. Paid membership
ends at the booth and does not extend along the free side of the exit.

All 156 directed station pairs were attempted in class 1: 117 confirmed, 39
incomplete. Adjacent and end-to-end pairs also exercise classes 2–4, producing
234 cases: 177 confirmed and 57 with known source/graph gaps. These gaps remain
regression cases requiring incomplete evidence, never exact or a fictional zero.
The Grijó–Torres Novas journeys cover 191–192 km in both directions and all
classes: 17.95/31.40/40.50/44.85 EUR. This is measured partial A1 coverage,
not a whole-country percentage. Alverca's shared A9 boundary is outside this block.
