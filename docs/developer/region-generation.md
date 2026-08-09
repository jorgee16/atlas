# Region Generation

`roam-packager` is the authoritative POI package generator. It is a C++20
application built with libosmium and nlohmann/json.

From the repository root:

```bash
cd packager
cmake -S . -B build-cmake -G Ninja
cmake --build build-cmake
```

Generate the complete Portugal POI and routing package:

```bash
./build-cmake/roam-packager pack portugal data/portugal-latest.osm.pbf
cp build/portugal/{metadata.json,poi-index.json,pois.geojson} \
  ../public/region-packages/portugal/
cp -r build/portugal/routing \
  ../public/region-packages/portugal/
```

Portugal's POIs are already generated, so the quicker routing-only command is:

```bash
./build-cmake/roam-packager pack-routing \
  portugal data/portugal-latest.osm.pbf
cp -r build/portugal/routing \
  ../public/region-packages/portugal/
```

Regenerate London's destination-search and Nearby data with the same C++
pipeline. `pack-pois` keeps the existing PMTiles archive and routing graph
untouched:

```bash
./build-cmake/roam-packager pack-pois \
  london ../data/osm/greater-london-latest.osm.pbf
cp build/london/{metadata.json,poi-index.json,pois.geojson} \
  ../public/regions/london/

grep -q '"search_only":true' build/london/pois.geojson \
  && echo "London geographic search records found"
```

Named cities, boroughs, districts, suburbs, neighbourhoods, villages, and
administrative areas remain available to destination search. They are emitted
with `search_only: true`; Nearby excludes them and continues to show visitable
places such as cafés, pubs, restaurants, attractions, shops, and parks.

When London's POIs and PMTiles already exist, generate only the v3 car-routing
graph:

```bash
./build-cmake/roam-packager pack-routing \
  london ../data/osm/greater-london-latest.osm.pbf
rm -rf ../public/regions/london/routing
cp -r build/london/routing \
  ../public/regions/london/
```

The packager produces `metadata.json`, `pois.geojson`, `poi-index.json`, and a
`routing/` directory. Portugal routing contains a `manifest.json` and separate
`mainland`, `madeira`, and `azores` graph directories; a non-partitioned region
such as London has the eight routing assets directly under `routing/`. Use
`pack-pois` or `pack-routing` to run only one pass. PMTiles generation remains
separate because it uses the complete map-tile profile rather than the POI/road
extractors.

After copying the graph, verify all eight routing assets exist: `nodes.bin`,
`edges.bin`, `geometry.bin`, `roads.bin`, `strings.bin`, `restrictions.bin`,
`spatial-index.bin`, and `metadata.json`:

```bash
find ../public/region-packages/portugal/routing \
  -maxdepth 2 -type f -printf '%P %s bytes\n' | sort
```

After installing generated files, keep their URLs and package version current
in `public/regions/catalog.json`. This is the application's single
authoritative region catalogue. Use `areas` when a region has disconnected
geographic coverage, as Portugal does for the mainland, Madeira, and the
Azores.

Generate the exact package size and SHA-256 file manifest only after every
listed asset has been copied into `public/`:

```bash
cd ..
npm run regions:manifest -- --region portugal
npm run regions:manifest -- --region london
```

The command streams each file through the hash function, writes the measured
byte total and `package.files` records into the catalogue, and fails if a
declared asset is missing. Increment the region's catalogue `version` whenever
published bytes change. Atlas then offers an update instead of silently mixing
old and new routing files.

Run the validation suite before building the application:

```bash
npm test
npm run build
```
