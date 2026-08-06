# Search Engine

## Overview

The Search Engine is responsible for discovering nearby Points of Interest (POIs).

As of Phase 3, Roam performs all nearby searches locally using OpenStreetMap-derived region packages. No public APIs are required.

The search engine is composed of three main components:

- RegionRepository
- LocalRegionProvider
- Spatial Grid Index

---

# Objectives

The search engine should:

- Work completely offline
- Scale to hundreds of thousands of POIs
- Return nearby places quickly
- Support any region package
- Be independent from the UI

---

# Phase 1

Initially the application performed a linear search.

```
Search
    ↓
Load every POI
    ↓
Distance calculation
    ↓
Radius filter
    ↓
Sort
```

Complexity

```
O(n)
```

where **n** is the number of POIs.

For London this meant:

- 46,325 POIs
- 46,325 distance calculations every search

Although acceptable for small datasets, this approach does not scale well.

---

# Phase 2

Nearby
