# Independently corroborated 2026 South entry/exit tariffs

The August Brisa publication contains South pages headed 01-01-2025. Atlas
previously withheld those pairs rather than silently calling them 2026 prices.
The independently retrieved March publication, retained here as original PDF
bytes, explicitly dates both South pages **08-01-2026**:

- [Official March publication](https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_04032026_v4.pdf), SHA-256
  `83e2d5b9f539f52057dd4f58261419c600c9656fd58cd48782eb73f2f60b9752`.
- [August publication](https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_25082026_v7.pdf), SHA-256
  `dca8323f964ff6702a984a1afa1737a3a32cac1b21934b46ca1d0924e0b26274`.

All **3,600 class cells / 900 published directed pairs** on pages 9–10 match
exactly across the two sources, including original station codes, directions,
zeros and all four independent classes. No missing cell, reverse fare or
class multiplier is inferred. Four pairs overlap the already active A10
domain and agree in every class; they are deduplicated after equality checks.
This adds **896 unique pairs**, taking the country catalog from 3,270 to
**4,166 pairs / 16,664 unique class values**, revision **2026110201**.
There are 16,680 observed source cells before those four duplicate pairs.

The included South domain covers published stations on A2, A6, A10, A12,
A13 and A26. For example, the independently published Coina PV–Paderne PV
pair, codes 0211→0222, is €23.80/€41.65/€53.50/€59.50 for classes 1–4.
The reverse pair is separately published. This is **not** a Lisbon–Algarve
door-to-door quote: bridges, different entries/exits and access roads must
still be identified on the actual route.

`import-brisa-fares.py --south-corroboration` requires the pinned independent
PDF, explicit 2026 dates on both pages, the full class/domain set, and equality
of every class cell. A changed source, incomplete class, duplicate identity,
unpublished direction or different price blocks activation. The normal core
tests reparse the original PDF offline and compare all South values with the
bundled catalog. Native, web and Android/JNI tests check independent class
values and the existing country/cache/update isolation. The PDF is evidence in
the repository, not an APK asset or a runtime network dependency.

This closes a **tariff-data gap**. It does not add geographic ticket bindings
or newly confirmed South journeys. The existing matcher still requires a
complete reviewed route before using an entry/exit fare as a confirmed total.
Other operators, bridge/direction rules and nationwide matching remain open;
the A5/IKEA, A16 and A28 real-graph tests are separate functional evidence.

Reproduce with the reviewed original August PDF:

```sh
python3 tools/import-brisa-fares.py AUGUST_PDF \
  --out /tmp/Portugal-candidate.csv \
  --south-corroboration docs/data/toll-evidence/Portugal/2026-11-02/brisa-march-2026.pdf \
  --active-out /tmp/Portugal-active.csv --active-audit /tmp/Portugal-active.audit.json
cmp android/native-app/src/main/assets/toll-fares/Portugal.csv /tmp/Portugal-active.csv
```
