# Region Generation

`roam-packager` is the authoritative POI package generator. It is a C++20
application built with libosmium and nlohmann/json.

From the repository root:

```bash
cd packager
cmake -S . -B build-cmake -G Ninja
cmake --build build-cmake
```

Generate Portugal:

```bash
./build-cmake/roam-packager pack portugal data/portugal-latest.osm.pbf
cp build/portugal/{metadata.json,poi-index.json,pois.geojson} \
  ../public/region-packages/portugal/
```

Regenerate London's POIs with the same C++ pipeline:

```bash
./build-cmake/roam-packager pack london data/greater-london-latest.osm.pbf
cp build/london/{metadata.json,poi-index.json,pois.geojson} \
  ../public/regions/london/
```

The packager produces `metadata.json`, `pois.geojson`, and
`poi-index.json`. PMTiles generation remains a separate step because it uses
the complete map tile profile rather than the POI extractor.

After installing generated files, update `public/regions/catalog.json`. This
is the application's single authoritative region catalogue. Use `areas` when
a region has disconnected geographic coverage, as Portugal does for the
mainland, Madeira, and the Azores.

Run the validation suite before building the application:

```bash
npm test
npm run build
```
