# Simulator quotes and confirmed route prices

Use `docs/data/toll-quote-observations-template.csv` to collect observations from
Via Verde, ViaMichelin or an official operator. Do not automate a simulator
without checking its API availability and terms of use.

Collect one observation per actual itinerary, direction, vehicle class and tariff
year. Preserve the exact origin/destination coordinates, roads, simulator entry
and exit names and every plaza shown. A postal code or city name alone cannot
identify the charged itinerary. Keep a source URL and screenshot/PDF reference.
Record tolls only: ViaMichelin's total journey cost may also include fuel.
Preserve discounts/exemptions and their conditions in notes; never assume another
class, direction, year or entry has the same price.

Use `country=Portugal`, `currency=EUR`, `fraction_digits=2` for Portuguese euro
observations. Vehicle class must be the class actually selected. Dates use
`YYYY-MM-DD`. A quoted numeric amount may use a decimal point or comma without
a currency symbol. `price_status=quoted` means a simulator supplied this amount;
it does not certify the Atlas route. If no amount is available, use
`price_status=unavailable` and leave `toll_amount` empty, never zero.
Quote CSV cells containing semicolons or newlines using ordinary CSV quoting.

Validate a completed table with:

```sh
python3 tools/validate-toll-quote-observations.py quotes.csv --out observations.json
```

The result is an observation dataset, not a country tariff catalog. Every row
remains unreviewed and ineligible for runtime pricing. Never copy this JSON into
the `tolls`, `toll-charges` or `toll-fares` catalogs.

Confirmation requires an applicable official tariff or verified entry/exit fare,
supported vehicle class/currency/year, and reviewed graph-bound evidence that
the actual route crossed those charging points. Existing native fixed-crossing
and entry/exit providers retain these gates. A quote for one pair of localities
cannot establish a per-kilometre rate or prices for other paths. Collecting
entry/exit matrices and plaza tariffs is more useful than attempting to list
every possible town-to-town journey.

Android displays monetary route prices only for native `tollPricing=exact`.
Other tolled routes show that the price is not confirmed. Internal estimates
remain explicitly marked as estimates for diagnostics and comparisons; they are
not promoted, rounded into a confirmed quote or shown as zero.
