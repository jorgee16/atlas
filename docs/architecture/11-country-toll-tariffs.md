# Atlas · Country toll tariffs (native Android)

## Context

The OSM routing graph contains **toll flags**, but **not toll-plaza IDs,
ticket entry/exit IDs, or an authoritative tariff section per graph edge**.
Consequently, the route cost can be an **estimate**, not the exact amount
quoted by the Via Verde journey calculator. The previous native implementation
had hard-coded Portuguese euro/km rates and guessed a price for every toll edge.
Those constants are removed.

## Country-specific tables

- Location: `android/native-app/src/main/assets/tolls/<Region.country>.csv`
- Portugal: `tolls/Portugal.csv`, 2026 IMT official *per-section* class 1–4
  tariffs with source URL and year in CSV comments.
- User's installed region supplies `country`; the Kotlin worker opens the
  appropriate asset and passes bytes to JNI `NativeCore.tariffs(country, csv)`.
- The native engine owns `TollTariffs` per routing handle. No static globals;
  switching region/country clears the previous table. Another country needs
  **only** a matching CSV with the same schema; no C++ country-specific switch.
- Missing country table or road reference => cost **unavailable**. No hard-coded
  default euro/km and no accidental zero-euro route.
- An untolled route always costs €0.
- `avoidTolls` still relies on real OSM graph flags (no dependence on prices).

### Version 1 CSV

```csv
# country=Portugal
# currency=EUR
# year=2026
# source=https://official-regulator.example/actual-page
road;section;km;class1;class2;class3;class4
A5;EstadioNacional-Oeiras;3.5;0.40;0.75;0.75;0.75
```

`km` is the charged section length and class columns are **EUR total for
that section** (or the table's declared currency). The parser aggregates
published section totals and lengths to compute a distance-weighted
**average rate per road and vehicle class**. This is **not** an exact tariff
for the user's actual interchange pair. Only roads with all required source
coverage should be added to the file. The engine never substitutes a generic
national rate for unlisted roads.

### Route JSON

- `hasTolls`: OSM graph says the chosen route traverses toll-marked roads.
- `tollPricing`: `none`, `estimate`, or `unavailable`.
- `tollEuros`: legacy numeric amount for compatibility; retained but
  not currency-neutral by its name.
- `tollAmount`: equivalent currency-neutral total, rounded to 2 decimals
  for fully covered routes, zero for untolled routes, or **null** when any
  tolled road cannot be estimated.
- `tollRoads`: ordered per-road audit list containing OSM road reference,
  tolled length (`meters`), priced length (`pricedMeters`), `pricing`
  (`estimate`/`unavailable`), and per-road `amount` (or null).
  Partial coverage does **not** appear as a fake trip total.
- `tolledMeters` and `pricedTollMeters`: audit coverage.
- `tollCountry`, `tollCurrency`, `tollTariffYear`, `tollTariffSource`:
  calculation provenance.

Note: the existing `tollEuros` field name is retained for backward JSON
compatibility. For other currencies it contains the numeric amount in the
declared `tollCurrency`, not necessarily EUR. A future schema migration can
rename it once consumers are updated.

## Making totals exact

To quote real entrance→exit prices rather than estimates, we must first add
stable **toll event and section identifiers** to the routing graph, including
directional plaza/gantry crossings and concession-specific pricing rules.
Then match those identifiers against original per-section rates, including
asymmetric bridge and distance-band rules, discounts, abolished tolls, and
year-specific exceptions. Neither road refs nor aggregate distance alone can
establish what the operator will charge.

Do not claim exact Via Verde amounts from average rate tables. Validate data
usage/permission before automating their website.

## Regression checks

`native/tests/core_tests.cpp`: country validation, tariff class, tolled route,
uncovered road, null amount and avoid-tolls preservation.
`android/.../TollTableAssetsTest.kt`: safe country file naming.

Sources for Portugal 2026: IMT public tariffs:
https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/
