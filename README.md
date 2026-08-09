# Roam

Interactive travel exploration platform combining itineraries, maps, GPS, nearby places, routing, and recommendations.

The first dataset is **London 2026**, based on the supplied `El Plan - London.pdf` itinerary.

## Stack

- Vite
- Vanilla JavaScript (ES modules)
- Leaflet
- OpenStreetMap tiles and regional OSM PBF packages
- Local indexed POI search
- Offline car routing with compact binary road graphs and A*
- Browser Geolocation API
- Google Maps URLs for walking directions
- PWA manifest + service worker

## Development in Termux

```bash
pkg install git nodejs
npm install
npm run dev
```

For phone testing, Vite is intentionally configured for localhost. Open:

```text
http://localhost:5173
```

If you need to expose the dev server to another device on the LAN, change the dev script to `vite --host 0.0.0.0` and use the phone's LAN address.

## Production build

```bash
npm run build
```

The deployable files are generated in `dist/`.

## Project structure

```text
roam/
├── data/
│   └── london.json
├── public/
│   ├── icons/
│   ├── manifest.webmanifest
│   └── sw.js
├── src/
│   ├── app.js
│   ├── gps.js
│   ├── itinerary.js
│   ├── main.js
│   ├── map.js
│   ├── nearby.js
│   ├── styles.css
│   └── utils.js
├── tests/
├── index.html
├── package.json
└── README.md
```

## Current scope

Roam currently supports regional offline POIs, optional PMTiles basemaps, GPS,
bookmarks, contextual map actions, and offline car routing on generated OSM road
graphs. Turn restrictions, spoken turn-by-turn instructions, walking/cycling
profiles, and live traffic remain future routing phases.

### Data note

Some coordinates in `data/london.json` are approximate working coordinates used by the prototype. The exact hotel address and any other uncertain locations should be verified before treating them as authoritative trip data.
