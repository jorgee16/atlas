# A28: current published tariffs and directed collection evidence

`vialivre-a28.html` is the public operator page retrieved on 2026-10-28,
last modified on 2026-10-21. `vialivre-review.json` pins its original bytes and
the two currently listed facilities. The adapter verifies the complete table,
including all four independent vehicle-class columns; historical OSM `fee`
tags and the prices on the older concession diagram are **not** tariffs.

| Facility | Class 1 | Class 2 | Class 3 | Class 4 |
| --- | ---: | ---: | ---: | ---: |
| Angeiras | €0.55 | €1.05 | €1.35 | €1.50 |
| Póvoa | €0.80 | €1.30 | €1.75 | €1.95 |

These are standard published tolls, excluding conditional discounts and
administrative/payment fees. Source: [ViaLivre A28](https://www.vialivre.pt/pt-pt/portagens/portagens-na-a28-2/).
The operator's linked concession diagram still draws four historical portals;
its historical amounts are not used. The northern Esposende–Antas and
Neiva–Darque exemptions are scoped by [Lei 37/2024](https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2024-875716621),
also retained in the earlier evidence intake. A28 is never declared wholly free.

## Geographic review

The independently downloaded [A28 OSM relation 7301354](https://www.openstreetmap.org/relation/7301354)
contains the four current collection nodes: 133135296/133209722 at Angeiras
and 133226800/2193465736 at Póvoa. Their original carriageway membership and
position between named interchanges on the operator diagram identify the
facilities; neither a closest-plaza lookup nor a road-reference price guess is
used. Each carriageway is reviewed separately.

`tools/toll-binding-config/portugal-a28.source.json` preserves original
coordinates, way versions, directions, collection candidates, raw response SHA
and ODbL attribution. `portugal-a28.json` selects 538 directed main-carriageway
ways, excluding IC23, ramps and local approaches. The generic fixed-corridor
compiler certifies 918 graph edges within the existing 2 m simplification bound
plus float32 quantization. It locates each collection node only on its witnessed
source subpath, using half-open traversal intervals to avoid charging an already
passed gate. All four facilities must match exactly once; an unmatched or
ambiguous facility blocks generation. No graph, route or GPS geometry changes.

The final country proof retains every previous A5/Lisbon coverage and crossing
row and adds the A28 evidence: 1,447 certified edges and eight crossing rows.
The fixed-price catalog becomes revision 2026110101 with 34 records. Updating
this table preserves prior stable IDs and the existing offline cache/rollback
protocol. Country selection and unsupported-class behavior are unchanged.

## Validation and limits

The 28 A28 real-graph cases cover each collection point in classes 1–4,
starts after each gate, and both facilities over approximately 22 km in both
directions. Expected combined prices are €1.35/€2.35/€3.10/€3.45. C++ routing
and Android JNI run the same cases; geometry, maneuvers, distance and ETA must
remain identical before and after applying prices. Existing 29 A5/IKEA cases
remain mandatory. Android exports all 57 results and the IKEA MapLibre preview.
This validates pricing, not a new GPS driving trip or Via Verde parity.

Unreviewed local approaches remain incomplete, even if their A28 portion is
known. This is an increase in functional coverage beyond A5, **not complete
national exact pricing**. A16/A9 ticket boundaries, other operators, bridges
and additional access roads still need independently reviewed bindings.

Reproduce:

```sh
python3 tools/import-vialivre-tolls.py
python3 tools/build-free-toll-corridors.py --graph GRAPH --check
python3 tools/build-fixed-toll-corridors.py --graph GRAPH --check
python3 -m unittest discover -s tools -p test_fixed_toll_corridors.py
```

## Existing Brisa identities

The January open-system PDF has a displaced name/code alignment on page 13.
The later [August 2026 publication](https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_25082026_v7.pdf)
corrects this: official code 0502 identifies Carcavelos PV, €1.60/€3.10/€3.10/€3.10.
Atlas's already distributed **internal** `brisa:0501` key identifies that same
Carcavelos PV charge. It is a legacy stable key, not a claim about the current
official station code. Its meaning must not be changed to Oeiras I when a new
table is downloaded; doing so would break older APK bindings. Likewise,
internal 0502/0503/0504 identify Carcavelos I/II and Oeiras I. Current amounts
and physical identities are preserved; no station ID is silently renumbered.
The August source's approved matrix/hash is already recorded in
`docs/data/portugal-entry-exit-2026-audit.json`.
