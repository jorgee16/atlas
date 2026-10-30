# Portugal 2026: imported source evidence and fixed-price catalog

The supplied `Atlas_Portagens_PT_2026_Codex.zip` was inspected on 2026-10-30.
All eight original manifest hashes matched, and the separately attached XLSX
matched the workbook inside the archive. The CSVs below are the original bytes,
including UTF-8 BOM and comma delimiters. The XLSX, duplicate JSON and supplied
Python programs are not runtime dependencies and are not executed by Atlas.
`manifest.json` records the original archive members; only the CSVs and handoff
are retained here. `review.json` pins the imported CSV hashes and archive hash.

## Published sources

The existing Brisa fixed-price rows retain their original identities and prices:
[Brisa 2026 open-system tariffs, page 13](https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_01012026.pdf?ver=2025-12-30-185537-910).

The 22 additions come from the published 2026 Ascendi tables, checked against
the operator's public pages on 2026-10-30:

| Provider source | Price records | Classes promoted | Geography certified here |
| --- | ---: | --- | --- |
| [Ascendi traditional, Grande Lisboa / A16](https://ascendi.pt/portagens-tradicionais/) | 3 | 1–4 | None |
| [Ascendi electronic, Costa de Prata / A17 and A29](https://ascendi.pt/portagens-eletronicas/) | 7 | 1–4 | None |
| [Ascendi electronic, Grande Porto / A4, A41 and A42](https://ascendi.pt/portagens-eletronicas/) | 12 | 1–4 | None |

The stable `ascendi:<concession>:<number>` identities use the operator's table
numbers, not invented geographic coordinates. Original endpoint text, operator,
road, record IDs and official numbers are retained in `review.json`. Class 5
is restricted to motorcycles with an electronic device; it is retained as
evidence but is not enabled in the unrestricted class 1–4 provider.

## What changed in the app's data

The existing `fixed-crossing` country catalog now contains 32 price records
(10 unchanged Brisa + 22 Ascendi), revision **2026103001**. Android and web share
the generated bundle. The existing country selection, JNI parser, SHA-256 update
cache, rollback and independent crossing-proof requirements remain in place.
The source URL for this mixed-operator catalog points to this source index;
individual official URLs are retained as catalog metadata.

This is a **price-only extension**, not newly certified journey coverage.
No OSM IDs, graph coverage rows, geometry, entry/exit bindings or directed
crossing evidence were added. A16's Idanha class 1 price of EUR 0.65 does not
imply that every A16 route costs EUR 0.65. Merely finding `A16` in a route cannot
activate any of these charges. The existing reviewed A5 bindings are unchanged.

## Reconciliation and remaining gaps

- All **600 IMT class cells** in the input agree with the existing section
  catalog. The input omits `A1 / Ligação PLLN`; Atlas retains that existing row.
- All **24 Brisa directed class cells** (six pairs) agree with the existing
  3,270-pair matrix. The older January observations do not replace the newer
  approved August matrix, expand its domain or manufacture reverse fares.
- **36 A41 source-conflict rows** remain quarantined and cannot be promoted.
  This does not remove the independently reviewed existing classes 3/4 exemption
  under [Lei 6/2026](https://diariodarepublica.pt/dr/detalhe/lei/6-2026-1058701611).
  Legal exemption evidence and inconsistent historical list prices are separate.
- Eight exemption records describe legal territories, not general origin/destination
  quotes. A4, A13 and A28 are not made globally free. Bridge direction and
  geographic crossings remain unverified in this intake.
- Paid A28, A33 and A19 coverage, other missing concessions, applicable special
  regimes and nationwide graph-bound ticket/gantry matching remain incomplete.
  No Via Verde/Michelin end-to-end validation is claimed.

`audit.json` records the measured counts and explicitly records **zero new
reviewed crossings and zero newly confirmed journeys**. Unknown route prices
continue to be unavailable; numeric estimates remain internal diagnostics in
Android's confirmed-only preview policy.

## Reproduce and review

```sh
python3 tools/import-toll-evidence.py --check
python3 -m unittest discover -s tools -p test_toll_evidence.py
```

The importer writes classified evidence and an audit to `dist/toll-evidence/`.
CI uploads these as `Atlas-toll-source-evidence`. Prices use integer cents
converted with `Decimal`. Entry/exit fares, sections, gantries, plazas, bridges,
conflicts and legal exemptions stay separate. Input evidence is never eligible
for runtime route pricing on its own. `--update` only reproduces the explicitly
reviewed class 1–4 fixed-price rows; it never downloads, publishes, edits the
graph or grants geographic approval. Existing versioned tariff publication still
requires its normal core/Android/coverage gates.
