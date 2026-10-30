# Country toll catalogs (Android and web)

## Architecture and price contract

The installed routing region selects the country, never the phone's GPS country.
C++ owns one catalog per JNI engine; every load clears the previous table before
parsing, including failed loads. Add a country by providing one matching CSV in
`android/native-app/src/main/assets/tolls/<Region.country>.csv`. No country
branches are needed. Classes (1–99), currency and fractional digits are table data;
each class uses independent published prices, never guessed multipliers.

`CountryTollProvider` / `TollCatalogRepository` separate storage from routing.
`TollTableAssets` provides APK fallback and isolated JNI validation of updates.
`TollCatalogUpdater` performs an explicit optional Settings download. The live
web/PWA uses the same canonical CSVs via `bundled-toll-tables.js`; regenerate with
`python3 tools/generate-toll-bundle.py`. CI `--check` prevents data drift.

Only OSM toll-marked edges contribute costs. An untolled route costs zero.
An explicit, sourced whole-road exemption can also override stale toll flags;
this changes pricing only, not route selection or the graph.
Missing table or unsupported class yields `tollPricing=unavailable` and
`tollAmount=null`, never a fictional zero. Unpriced roads also remain unavailable
unless the country explicitly enables the low-confidence reference policy below. Available
costs are section-average distance estimates: sum(section prices)/sum(lengths).
C++ emits `exact` only with complete reviewed directed-crossing evidence. Avoid-tolls still uses graph flags independently.
Navigation/GPS, map matching, geometry, distance and ETA algorithms are unchanged.
Updates apply to the next route calculation, not to the current route.

CSV comments require country, currency (ISO-style three uppercase letters), year
and HTTPS source. `version` is a positive increasing integer (max 16 digits).
`fractionDigits` supports 0–3. The header is `road;section;km;class1;class2;...`.
Duplicate sections/classes/metadata, invalid numbers and unsupported schemes fail.
Route totals currently use `scheme=road-average`; the separate `fixed-crossing`
provider is described below. Optional `estimateRoads=A1,A5,...`
restricts estimates while retaining other source rows for audit/section lookup.
Fixed-crossing and entry/exit providers have separate validated matching rules;
future vignette providers must define their own rules.

JSON retains legacy `tollEuros` as an alias of currency-neutral `tollAmount`.
It adds `tollTariffVersion`, `tollFractionDigits`, `tollVehicleClass` and
`tollVehicleClasses`; existing country/currency/year/source and per-road priced
meters remain. Partial sums never appear as the trip total. Android shows class,
source, year, version, known/unknown roads and incomplete coverage. Web price-based
alternative selection excludes unknown prices.

## National estimate coverage (revision 2026102801)

Portugal explicitly enables `referenceEstimate=road-then-country-average`.
This is an opt-in country-data policy, not a country branch or an implicit
engine default. Countries without it retain `unavailable` for unpriced roads.

When a marked toll edge has no usable road-average price, the engine first uses
that road's published section totals if present, otherwise the distance-weighted
class rate from `referenceSourceRoads`. Portugal's source list is the twelve
previously approved roads. Each class has independent source prices; no vehicle
multipliers or invented official fees are introduced. Cases with no positive source rate, an unsupported class, invalid data, or
contradictory paid/free aliases remain unavailable. A known exemption continues to produce zero. `freeRoadClasses`
adds data-driven per-class exemptions: A41 classes 3/4 under Lei 6/2026.
It does not zero A8 or A19 wholesale under their partial-section exemptions.

Reference amounts are always `tollPricing=estimate` with
`tollPricingConfidence=low` and `tollEstimationMethod=road-or-country-reference`.
`referenceTollMeters` and per-road `referenceMeters` are kept separate from
`pricedTollMeters`, so estimated availability cannot masquerade as actual tariff
coverage. Positive reference totals display at least one currency precision unit
rather than rounding an unknown charge to zero. Rounded road subtotals can differ
from the rounded trip total. Exact crossing providers clear reference metadata
only after their full proof succeeds.

Native diagnostics label these totals `low confidence` and preserve missing tariff coverage,
possible fixed-fee differences and exemptions. Web uses the same canonical data
and labeling; low-confidence totals cannot drive the existing price-based
Balanced recommendation. Routing edge costs, geometry, GPS, heading and ETAs
are unchanged. This closes **estimated national availability**, not exact
national tariff/gantry matching or guaranteed Via Verde parity.

The coverage gate scans every SHA-verified Portugal partition, reports known,
exempt, reference-estimated and unpriced distances separately, and rejects any
unpriced directed driving edge when national coverage is requested. A separate
native probe executes the real C++ router on representative toll-marked roads
and four city trips for classes 1-4, compares navigation fields before/after
reference pricing and verifies confidence/amount contracts. Its artifacts are
`graph-coverage.json` and `national-route-probes.json`. These probes are real
routing tests, not Android Location/GPS replay; existing Android/UI/camera/GPS
smoke and real A5 quote tests remain enabled.

The measured evidence is recorded in `docs/data/portugal-national-coverage-20261028.json`.
CI run 40658679661 found 100% estimated-or-exempt availability for class 1 across
all bundled Portugal partitions, with zero unpriced directed toll edges. Only
46.73% of audited distance had its own standard tariff or explicit exemption;
53.27% used low-confidence references. All 260 real routing/class probes passed
without changes to navigation fields. This is not full official-price coverage.

## Versioned offline updates

### Official evidence intake, 2026-10-30

The supplied Portugal bundle is imported by `tools/import-toll-evidence.py`,
outside the routing engine. Its original hashes, country/year, class prices,
source identities and price-only reviews live in
[`docs/data/toll-evidence/Portugal/2026-10-30`](../data/toll-evidence/Portugal/2026-10-30/README.md).
The existing fixed-crossing provider gains 22 Ascendi price records (3 A16
plazas and 19 electronic gantries), revision 2026103001. Its ten Brisa records
and the newer entry/exit matrix are preserved. Mixed-operator catalog provenance
points to the source index with the individual official URLs in metadata.

This does not grant geographic or directional coverage. Source conflicts,
motorcycle-only class 5, sections, bridge rules and scoped exemptions are kept
separate. No new graph bindings or journey totals are activated by importing
this bundle. Existing Android confirmed-only preview and exact crossing gates
remain authoritative; GPS, map matching, routing weights and route geometry
are not changed by the evidence intake.

### Entry/exit matrices (revision 2026102701)

The third scheme is `entry-exit`, with columns
`network;entry;exit;class1;class2;...`. Country, currency, precision, classes and
identities remain data. Directed pairs are explicit; missing reverse/self pairs
and missing class values are never synthesized. Fixed and matrix sums use
integer minor units. A matrix cannot become a per-kilometer estimate.

`TollCatalogKind.ENTRY_EXIT` uses `assets/toll-fares/<country>.csv` and the isolated
`/toll-fares/<country>/...` cache/download/publication namespace. It reuses the
existing SHA-256, native validation, atomic installation and rollback machinery.
Settings provides optional entry/exit updates and rollback. Switching countries
clears matrix, fixed and crossing state. The web bundle is generated from the
same approved asset, with no independent price constants.

Portugal bundles **3,270 pairs / 13,080 independently published class cells** from
the Brisa north, center and Brisal matrices, effective 26 August 2026. The lookup
namespace `brisa-published` identifies the published matrix, not a motorway or a
guess at concession topology. All original matrix domains remain in the audit.
The 900 southern pairs are withheld because their pages explicitly state 2025.
`docs/data/portugal-entry-exit-2026-audit.json` binds the approved subset to the
reviewed source PDF and CSV hashes. Reproduce it with `tools/import-brisa-fares.py`
and its `--active-out` / `--active-audit` arguments. Candidate tables marked with
an unapproved `status` are rejected by C++, Kotlin, web and the packager.

JNI loads this provider before route calculation. Exact pricing requires a fully
reviewed, graph-digest-bound crossing sequence using
`entry:<network>:<station>` and `exit:<network>:<station>`. The sequencer rejects
nested entries, missing entry/exit, different networks, unknown event types and
uncovered traversal. Repeated complete journeys remain chargeable. No observed
ticket events means **unavailable matching**, never a free route. Price failure
leaves the previous estimate/unavailable result untouched. Both endpoints and
all prices must be present before any monetary metadata is replaced.

No national ticket bindings are activated in this increment. Existing A5 fixed
bindings remain unchanged. Therefore bundling these matrices does **not** turn
unmatched routes into exact quotes, increase graph-matching coverage, or prove
Via Verde parity. The country-wide engine capability and offline price data are
ready for reviewed bindings; remaining operators, bridge rules and full matching
are still open. No navigation geometry, GPS processing, maneuver, distance or ETA
is changed by either exact-price provider.

`python3 tools/toll-catalog.py` generates immutable payloads for the existing R2
origin under `/toll-tariffs/<country>/<revision>/table.csv`, a versioned manifest,
and `/toll-tariffs/<country>/manifest.json`. Schema 1 binds country, revision,
currency, year, classes, precision, size and SHA-256 to the CSV. Publish immutable
payloads first and the small current manifest last, only after native/Kotlin/
Android tests pass. Never overwrite a published version. APK fallback remains
usable if R2 has no tariff catalog yet.

Android requires the configured HTTPS origin, exact country/version path, no
redirects, <=2 MiB, strict UTF-8, SHA-256 and valid Kotlin **and C++** parsing.
Timeouts are 15/30 seconds. Integrity uses SHA-256; authenticity relies on HTTPS
and trusted R2 publishing access, not a cryptographically signed manifest.

App-private staging files are fsynced, then the immutable version directory is
renamed and the active pointer atomically replaced. Loading checks active,
previous, other validated cached versions and APK fallback. Corrupt data and
interrupted staging writes are ignored. A newer APK table wins over older cache.
Downloads cannot downgrade or replace a revision with different bytes. Explicit
local rollback persistently disables the rejected revision; recovery requires a
newer revision. Valid history is retained (no automatic pruning yet). A failed
update retains the last valid offline table; no new signing keys are introduced.

## Portugal 2026 audit, 2026-10-25

The public IMT page supplies **151 section rows across 18 roads**:
A1(25), A2(13), A3(11), A4(8), A5(4), A6(8), A8(18), A9(8), A10(4), A12(3),
A13(5), A14(4), A15(6), A17(12), A21(4), A32(7), A41(9), A43(2).
All rows are retained as normalized numeric data. The source HTML SHA-256, counts
and two separately published bridge tariffs are in
`docs/data/portugal-tolls-2026-audit.json`. The audit workflow and
`tools/import-imt-tolls.py` reproduce extraction from the public source.

**12 road references** permit road-average estimates:
A1,A3,A5,A6,A8,A9,A10,A14,A15,A21,A32,A43. This measures source reference coverage,
not complete graph or concession coverage. A2/A12 need directional bridge/plaza
mapping; A4/A13 contain paid and abolished concessions; A17/A41 need other operator
coverage. Those roads have no standard road-average quote; the national reference policy
can now provide a separately labeled low-confidence estimate.
Unlisted roads use the explicitly enabled, low-confidence country reference;
without that policy they remain unavailable. Unmatched bridge/fixed-fee estimates
are not official bridge charges. Discounts, payment-method exceptions and
conditional heavy exemptions are not modeled; the unconditional A41 class 3/4
exemption is explicit country data.

Lei 37/2024 as revised for 2026 removes specific concessions/sections, including
additional A25/Costa de Prata sections. It does not justify zeroing entire A4,
A13 or A28 references. OSM flags may lag legislation. Partly exempt roads are not declared wholly free;
without section matching their reference estimates may overstate the charge.
Contradictory free/paid aliases remain unavailable. No graph or toll flags change.

Published section-chain sums, **not exact route/Via Verde quotes**:
- A5 four sections: class 1 EUR2.50; classes 2/3/4 EUR4.80.
- A2 Fogueteiro–Paderne: class 1 EUR23.80, excluding bridges.
- A3 Maia–Braga Sul: EUR3.20/5.60/7.15/8.00.
- A14 Santa Eulália–Coimbra Norte: EUR2.90/5.05/6.50/7.25.

Via Verde journey comparisons remain unverified. Its public interactive page was
inspected; no authorized public API was identified and no private endpoint scraped.
Full graph distance coverage must be measured separately; 12/18 references is not
an edge-distance coverage percentage.

## Exact correspondence: future validated boundary

### Whole-road exemptions (revision 2026102601)

The optional `freeRoads` metadata names references that are free for every class
declared in that catalog. `freeRoadSource` is mandatory and must be HTTPS.
This is a generic policy, not a Portugal branch in the engine. It is rejected in
fixed-crossing catalogs. Unsupported classes and conflicting known paid/free
aliases remain unavailable. A route consisting entirely of explicitly exempt
toll-flagged edges returns `exact` zero with the legal source; mixed paid routes
retain estimates or unavailable totals. No dummy lengths or average-rate zero
rows are invented. The web bundle, Kotlin validator and C++ parser use the same
policy. Old cached revisions lose to the newer APK fallback.

Portugal declares A22, A23, A24 and A25 under Lei 37/2024, consolidated in 2026.
The policy deliberately excludes A4, A13 and A28, which contain mixed concessions,
and conditional vehicle/resident exemptions. The graph audit reports exempt
directed meters separately from estimated meters; neither proves nationwide
exact-price coverage. Publication requires the existing CI gates.

### National expansion remains incomplete

The current Brisa document is
`TabelaEcadaTaxas_23iva_25082026_v7.pdf` (SHA-256
`dca8323f964ff6702a984a1afa1737a3a32cac1b21934b46ca1d0924e0b26274`).
Its published origin/destination matrices must not be replaced with sums of IMT
section prices. For example, Maia PV–Braga Sul class 1 is EUR3.85 in the matrix;
the EUR3.20 section-chain sum above is not that journey's exact fare.
The source matrix has now been extracted; the approved 2026 subset is described
above. Exact route application still requires reviewed physical entry/exit
matching. No missing cell is interpreted as zero.
The existing fixed-charge IDs are stable internal identifiers; do not remap them
silently when an operator document uses different external plaza codes.

The national public IP map distinguishes traditional, electronic and free road
segments, but does not provide complete price/entry/exit records. Full motorway
coverage, bridge direction rules and remaining concession tariffs are still open.
The validated A5 binding is a limited pilot, not a national completion claim.

Graph v6 RROD records hold strings/flags; RNOD holds coordinates/components, not
original OSM way/node or tariff entry/exit identifiers. Road refs cannot identify
charged sections or directional bridge crossings. `sectionPrice` retains official
row prices, but routing never calls it without authoritative traversal identifiers.

A future sidecar should bind complete graph digests to directed edge IDs and
reviewed plaza/gantry/entry/exit section IDs. Reject mismatched graph digests.
Only a complete validated event sequence may emit `exact`. Fixed plazas,
distance bands and exemptions need explicit rules. No guessed nearest-name mapping
or topology changes are introduced in this increment.

## Tests and sources

C++ covers production class prices, excluded/missing roads, duplicate/invalid
rows, independent currencies/classes and explicit free rows. Kotlin covers SHA,
country isolation, corrupted/interrupted cache, version collision, downgrade,
native validation before activation, rollback after restart, download paths and
unknown-price display. Node covers identical data and unknown-price alternatives.
Existing native, JNI, Android, GPS and camera gates stay enabled.

- https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/
- https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2024-875716621
- https://servicos.infraestruturasdeportugal.pt/portagens-ips
- https://www.viaverde.pt/ferramentas/calculador-de-portagens

The `toll-coverage` workflow job measures every Portugal partition in the
bundled region manifest against SHA-verified edges/roads/strings. Its artifact
reports directed toll-marked driving meters and estimates coverage by road ref;
it deliberately does not call these unique physical kilometers or exact coverage.
`[publish-tolls]` on a branch commit enables `toll-catalog-publish` only after the
same commit's core, Android and real graph coverage gates succeed. It uses the existing R2 account
secrets and bucket, writes only the tariff prefix, checks remote revisions and
immutable collisions, and replaces the current manifest with an ETag precondition.
The publication receipt records commit/run/country/revision/hash. No APK Release
is produced by this data publication job.

## Fixed-crossing provider: official Brisa plazas

A second catalog is now supported without replacing the road-average format:
`android/native-app/src/main/assets/toll-charges/<country>.csv`.
Its metadata explicitly declares `scheme=fixed-crossing`; its columns are
`charge;road;name;class1;class2;...`. The charge ID is operator-scoped (for example
`brisa:0501`). No distance column or invented kilometers are used for a fixed fee.
The 2026 Brisa PDF, page 13, supplies ten open-system charges, including all six
A5 codes. The audit is in `docs/data/a5-fixed-charge-audit-20261025.json`.

These are different facts from the four A5 IMT section prices. For example,
Carcavelos PV (0501) charges EUR1.60/3.10/3.10/3.10 per crossing, whereas Oeiras I/II
(0504/0505) charges EUR0.40/0.75/0.75/0.75. Summing motorway section prices cannot
identify which open-system gate was crossed. The catalog contains published
base charges, not a validated Lisbon–Cascais journey quote.

`TollTariffs` and the common Kotlin/web catalog parsers dispatch on the declared
scheme, never the country. Fixed prices are not eligible for distance estimates.
The C++ fixed-charge accumulator uses integer minor units and preserves genuinely
repeated crossings; unknown IDs or classes produce no amount. It does not label
a route exact. Both providers use independent country caches, versions, current
manifests and pointers, through the same repository/updater implementation.
`/toll-charges/<country>/...` cannot replace `/toll-tariffs/<country>/...`.
A manifest declares the fixed scheme; legacy road manifests remain byte-compatible.
Older apps continue to consume their existing road-average endpoint unchanged.

Settings → Published plaza tariffs displays the current routing country's
published charges, selected vehicle class, currency, year and source. It explicitly
states that the list is not a trip total. An optional update downloads the fixed
catalog independently; its data remains available offline.

## Directed crossing evidence and safe activation

`native/include/atlas/toll_crossings.hpp` / `native/src/toll_crossings.cpp` implement
a price-free matcher separately from the routing algorithm. Reviewed mappings bind
all seven graph SHA-256 digests, country, explicitly certified directed-edge coverage (not a road-reference allowlist), directed edge
IDs, from/to node IDs and the crossing offset on that edge. Route traversal
intervals are [begin,end): starting after a plaza does not charge it again, and
real repeated crossings remain chargeable. Wrong graph/country/direction,
disconnected traversal or ambiguous bindings are rejected. Any uncertified traversal keeps the result incomplete, including ramps and
local roads without toll flags. A road-reference match never certifies an edge. Binding offsets must fit the declared full edge
length and clipped traversal bounds. The caller must compute hashes from the loaded graph;
a region name or version number alone is insufficient proof.

The existing v1 `toll-events.json` was downloaded and SHA-verified. It has 22
charge IDs on 30 directed edges, no A5 events, no graph digests and no reviewed
completeness statement. Five edges contain multiple different charge IDs and need
physical review. Its embedded prices are not imported into the new price catalog.
It is not sufficient evidence for exact route pricing and is not activated.
The graph-bound A5 pilot below uses separately reviewed source evidence.

`tools/audit-a5-charge-points.py` inspects original OSM charge nodes and ways from
a checksum-verified Geofabrik Portugal PBF (OpenStreetMap contributors, ODbL).
Public Overpass endpoints failed with HTTP502/timeouts in the diagnostic runs.
The audit records the source SHA-256 and labels its output unreviewed candidates;
it never generates trusted bindings automatically. A5 exact pricing remains open
until all six official plaza codes, physical directed crossings and complete
route coverage have been reviewed against the actual graph.

Tests distinguish official per-plaza prices from route totals, road/fixed cache
isolation, independent updates and rollback, and synthetic crossing evidence from
real Android validation. The Android instrumentation verifies the real fixed CSV
through JNI and captures the published-plaza UI; it does not claim an exact A5
journey or real-world driving validation.


## Native repricing integration and first pilot

The optional APK asset `toll-bindings/<country>/<partition>.csv` contains only
reviewed directed coverage, crossing offsets and all seven graph digests. It has
no tariffs. `TollBindingAssets` first checks whether every edge in the actual
calculated route is certified; only eligible routes require a streamed graph
hash check, cached by immutable directory/file signatures. Other routes retain
the existing pricing path without hashing the graph. JNI additionally validates
the loaded graph path, country, review declaration, CSR from/to topology, drive
access and edge lengths before accepting the proof.

Repricing occurs after C++ calculates the authoritative route. Only monetary
fields change; the real-route verifier compares points, edge IDs, maneuvers,
visual anchors, distance and ETA before/after. The first pilot is deliberately
restricted to certified A5 main carriageways. Uncertified ramps and city approaches
prevent an exact full-route quote, regardless of their OSM toll flags. The
physical identity is the Carcavelos full-carriageway plaza (0501), confirmed from
the visually reviewed Brisa PDF and its km14+940 notice; OSM fee tags are ignored.

`tools/build-toll-bindings.py` requires identical graph/source endpoints and a
unique original directed OSM path for every graph polyline segment. The v6
packager simplifies geometry using Douglas–Peucker at 2m; collinear toll-gantry
nodes can therefore be absent from stored geometry. The witness may recover those
nodes only along the unique original path inside that documented 2m corridor,
plus the calculated float32 quantization bound. Ambiguous alternatives, opposite
directions, backtracking and geometric shortcuts are rejected. This does not
alter the graph or navigation geometry, and never selects a nearby road by name
or proximity.
It also requires every reviewed mainline charge point to be represented. Its
case endpoints come from actual graph nodes upstream/downstream of those points;
`atlas_toll_quote` performs actual route calculation. Classes 1–4, both carriageways,
after-gate starts and uncertified city approaches are checked against independent
Brisa expectations. A generated proof must pass before being installed in the APK.

The camera replay exposed an existing test-policy mismatch: its resumed good-GPS
fixture selected the already implemented 60s/1500m confirmed-blackout policy, while
the assertion expected the 9s/110m weak-signal branch. The fixture now explicitly
uses 20m accuracy for the latter; its numeric assertions are unchanged. Additional
instrumentation checks both existing production branches at controlled times.
No production GPS filter, interpolation, camera or prediction policy is changed.


## A5 pilot activation (2026-10-26)

`assets/toll-bindings/Portugal/mainland.csv` certifies 300 directed mainline edges
for the seven explicitly recorded v6 graph digests. Four physical crossing points
(manual and Via Verde, both carriageways) map to the single Carcavelos PV tariff
ID `brisa:0501`. The two Via Verde pórtico vertices were removed by the existing
2m geometry simplifier; unique original directed paths recover their locations
without modifying any graph or displayed route coordinates.

The native proof in CI #269 calculated 21 actual routes: all four classes, both
carriageways/lane paths, starts after the plaza, and an unreviewed city-to-city
approach. Confirmed published base prices are EUR1.60 (class 1) and EUR3.10
(classes 2–4). Starts after the plaza cost zero; the Lisboa/Cascais urban approach
remains an **estimate**, not a certified full journey. The binding SHA-256 and
source/graph identities are recorded in
`docs/data/a5-mainline-binding-audit-20261026.json`.

The `tolls` emulator mode reuses the real installed Portugal fixture. It checks
all 21 routes through the production JNI, rejects altered graph hashes and
another country, compares authoritative route fields before/after pricing, and
calculates a preview through the actual AtlasModel/MapLibre UI. It exports the
quotes, visible text, screenshot and video in `atlas-toll-review`. These checks
validate pricing and the preview, not a real driving trip or a Via Verde API
comparison. Existing GPS/camera smoke tests remain separate and unchanged.

Ramps, the other A5 plazas, bridges, discounts/exemptions and other motorways are
not certified by this pilot. Unknown/incomplete mappings retain the existing
estimate/unavailable behavior. Publishing tariff data requires all existing
core/Android/coverage gates and any explicitly requested crossing audit to pass.
No signed APK Release is generated by the tariff-data publication workflow.

## Confirmed-only Android route prices

Android route cards and toll details now display monetary values only when the native result is `tollPricing=exact`. Other tolled routes display `Toll price not confirmed`; a genuinely toll-free route still shows zero. Internal estimates and their confidence/coverage metadata remain available for diagnostic comparisons, never as confirmed quotes. Simulator observations use the separate validation format in `12-toll-quote-observations.md` and do not automatically activate prices.
