# PMTiles Map Builder

The map builder creates a vector `map.pmtiles` archive for a Roam
region.

It uses:

- Osmium to extract the configured bounding box.
- Tilemaker to generate vector tiles directly as PMTiles.
- Node.js to coordinate the pipeline and update region metadata.

Run:

    node tools/region-builder/map-cli.mjs           --config tools/region-builder/config/london.json           --input data/osm/greater-london-latest.osm.pbf

Output:

    public/regions/london/map.pmtiles

The generated map data is derived from OpenStreetMap and remains
subject to ODbL attribution and database-license requirements.
