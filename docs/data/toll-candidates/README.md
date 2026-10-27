# Official matrix candidates — not active route prices

`Portugal.csv` preserves 4,170 explicitly printed Brisa origin/destination pairs,
with four independent class prices each (16,680 source cells). It includes the
north, center, south and Brisal matrices, not just A5. Missing cells are absent;
reverse journeys and zero prices are never inferred. Network IDs separate source
matrices and do not imply verified physical routing connectivity.

Reproduce with the reviewed PDF and PyMuPDF 1.26.5:

```
python3 tools/import-brisa-fares.py path/to/TabelaEcadaTaxas_23iva_25082026_v7.pdf --out docs/data/toll-candidates/Portugal.csv
python3 -m unittest discover -s tools -p test_toll_catalog.py
```

The importer verifies the source SHA-256, station codes, row/column alignment,
class blocks, duplicate cells and completeness across classes. The audit retains
source dates per page. Pages 9–10 explicitly state 01-01-2025 despite being in the
current August 2026 document. This discrepancy is not silently changed.

Examples transcribed from the matrices, classes 1/2/3/4 (EUR):

| Published endpoints | Class 1 | Class 2 | Class 3 | Class 4 |
| --- | ---: | ---: | ---: | ---: |
| Maia PV (0311) → Braga Sul (0316) | 3.85 | 6.70 | 8.60 | 9.60 |
| Coina PV (0211) → Paderne PV (0222) | 23.80 | 41.65 | 53.50 | 59.50 |
| Santa Eulália PV (1411) → Coimbra Norte (0117) | 2.90 | 5.05 | 6.50 | 7.25 |

These are source matrix lookups, not independently verified Via Verde quotes or
end-to-end Atlas route totals. The southern row has the source-date caveat above.

This directory is outside Android assets and the web bundle. The production
catalog packager rejects its entry-exit scheme. Activation requires reviewed
physical entry/exit bindings to the graph and resolution of effective-date
questions. None of these rows is converted to a guessed per-kilometer rate.
Remaining concessionaires and bridge direction/exemption rules are still open;
this matrix is not nationwide tariff coverage.
