# Roam Region Builder

The public interface is a portable Node.js CLI.

The first extraction adapter uses `osmium-tool`, because it is fast,
open source, and already available in the development environment.
The CLI and output format are independent of the adapter, so another
parser can be added later without changing Roam region packages.

## Validate London configuration

```bash
node tools/region-builder/cli.mjs validate       --config tools/region-builder/config/london.json
```

## Build London

```bash
node tools/region-builder/cli.mjs build       --config tools/region-builder/config/london.json       --input data/osm/greater-london-latest.osm.pbf
```

Output:

```text
public/regions/london/
├── metadata.json
└── pois.geojson
```

Generated geographic data is derived from OpenStreetMap and must retain
attribution to OpenStreetMap contributors. The generated database is
distributed under ODbL 1.0.
