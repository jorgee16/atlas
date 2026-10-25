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
Missing table, unsupported class, excluded road or partial coverage yields
`tollPricing=unavailable` and `tollAmount=null`, never a fictional zero. Available
costs are section-average distance estimates: sum(section prices)/sum(lengths).
C++ never emits `exact`. Avoid-tolls still uses graph flags independently.
Navigation/GPS, map matching, geometry, distance and ETA algorithms are unchanged.
Updates apply to the next route calculation, not to the current route.

CSV comments require country, currency (ISO-style three uppercase letters), year
and HTTPS source. `version` is a positive increasing integer (max 16 digits).
`fractionDigits` supports 0–3. The header is `road;section;km;class1;class2;...`.
Duplicate sections/classes/metadata, invalid numbers and unsupported schemes fail.
Only `scheme=road-average` is supported today. Optional `estimateRoads=A1,A5,...`
restricts estimates while retaining other source rows for audit/section lookup.
Future plaza/ticket/vignette providers need their own validated matching rules.

JSON retains legacy `tollEuros` as an alias of currency-neutral `tollAmount`.
It adds `tollTariffVersion`, `tollFractionDigits`, `tollVehicleClass` and
`tollVehicleClasses`; existing country/currency/year/source and per-road priced
meters remain. Partial sums never appear as the trip total. Android shows class,
source, year, version, known/unknown roads and incomplete coverage. Web price-based
alternative selection excludes unknown prices.

## Versioned offline updates

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
coverage. Those routes remain unavailable despite retaining official section rows.
Unlisted roads remain unavailable. Bridges are not converted into motorway €/km.
Discounts, payment-method exceptions and conditional heavy exemptions are not modeled.

Lei 37/2024 as revised for 2026 removes specific concessions/sections, including
additional A25/Costa de Prata sections. It does not justify zeroing entire A4,
A13 or A28 references. OSM flags may lag legislation; ambiguous flagged sections
remain unavailable, not declared free. No road graph or toll flags are changed.

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
