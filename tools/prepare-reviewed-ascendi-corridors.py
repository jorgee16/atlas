#!/usr/bin/env python3
"""Normalize the reviewed 2026 Ascendi fixed facilities into graph inputs.

The raw files are OSM API map responses captured for the explicit boxes below.
This script does not discover a price, choose a nearby road, or infer a reverse
charge.  The node-to-charge map is the review decision; the graph compiler must
still prove every directed node against the immutable Portugal graph.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "tools/toll-binding-config"

ROADS = {
    "a4": {
        "road": "A4",
        "allowed": ["motorway"],
        "raw": ["a4-0.json"],
        "charges": {
            263571919: "ascendi:grande-porto:01",
            263576173: "ascendi:grande-porto:01",
            263571869: "ascendi:grande-porto:02",
            263576189: "ascendi:grande-porto:02",
        },
        "scope": "A4 Custóias/Via Norte and Via Norte/Ponte da Pedra electronic facilities, both original directed carriageways only.",
    },
    "a17": {
        "road": "A17",
        "allowed": ["motorway"],
        "raw": ["a17-relation.json"],
        "charges": {
            1563499859: "ascendi:costa-de-prata:01",
            1563499866: "ascendi:costa-de-prata:01",
            1563499922: "ascendi:costa-de-prata:02",
            1563499923: "ascendi:costa-de-prata:02",
            1563499950: "ascendi:costa-de-prata:03",
            1563499968: "ascendi:costa-de-prata:03",
        },
        "scope": "A17 Mira/Ponte de Vagos, Vagos/Ílhavo and Aveiro Sul/S. Bernardo collection approaches, with one original directed facility node per carriageway.",
    },
    "a29": {
        "road": "A29",
        "allowed": ["motorway", "motorway_link"],
        "raw": ["a29-relation.json"],
        "charges": {
            1563530090: "ascendi:costa-de-prata:04",
            1563530091: "ascendi:costa-de-prata:04",
            1563530092: "ascendi:costa-de-prata:05",
            1563530093: "ascendi:costa-de-prata:05",
            1563530095: "ascendi:costa-de-prata:06",
            1563530096: "ascendi:costa-de-prata:06",
            1563530097: "ascendi:costa-de-prata:07",
            1563530098: "ascendi:costa-de-prata:07",
        },
        "scope": "A29 Salreu/Estarreja, Estarreja/Ovar, Arada/Maceda and ER1-18/Miramar facilities, each on its explicit original directed way.",
    },
    "a42": {
        "road": "A42",
        "allowed": ["motorway"],
        "raw": ["a42-0.json", "a42-1.json", "a42-2.json"],
        "charges": {
            264117176: "ascendi:grande-porto:10",
            264119609: "ascendi:grande-porto:10",
            2869384457: "ascendi:grande-porto:11",
            2869384458: "ascendi:grande-porto:11",
            264119862: "ascendi:grande-porto:12",
            2869381630: "ascendi:grande-porto:12",
        },
        "scope": "A42 IC24/IC25–Lordelo, Paços de Ferreira–EN106 Sul and EN106 Norte–Lousada electronic facilities, both directed carriageways.",
    },
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(raw_dir, key, definition):
    elements = {}
    responses = []
    for name in definition["raw"]:
        path = raw_dir / name
        data = json.loads(path.read_text())
        responses.append({"file": name, "rawSha256": digest(path)})
        for element in data["elements"]:
            elements[element["type"], element["id"]] = element
    gates = definition["charges"]
    allowed = set(definition["allowed"])
    all_ways = {identity: element for identity, element in elements.items()
                if identity[0] == "way" and element.get("tags", {}).get("highway") in allowed
                and element.get("tags", {}).get("oneway") == "yes"}
    ways = {identity: element for identity, element in all_ways.items()
            if any(node in gates for node in element["nodes"])}
    if set(gates) - {node for way in ways.values() for node in way["nodes"]}:
        raise ValueError("A reviewed collection node is absent from its captured OSM ways")
    if any(way.get("tags", {}).get("highway") not in allowed or
           way.get("tags", {}).get("oneway") != "yes" for way in ways.values()):
        raise ValueError("A reviewed collection node is not on an allowed directed road")
    def collection(node):
        tags = elements.get(("node", node), {}).get("tags", {})
        return tags.get("barrier") == "toll_booth" or tags.get("highway") == "toll_gantry"
    # Include bounded directed context before and after each facility. This
    # gives the router distinct approach coordinates while stopping at any
    # other, separately priced collection point.
    for _ in range(3):
        first = {way["nodes"][0] for way in ways.values()}
        last = {way["nodes"][-1] for way in ways.values()}
        additions = {}
        for identity, way in all_ways.items():
            if identity in ways or not (way["nodes"][0] in last or way["nodes"][-1] in first):
                continue
            extra = {node for node in way["nodes"] if collection(node)} - set(gates)
            if not extra:
                additions[identity] = way
        if not additions:
            break
        ways.update(additions)
    nodes = {node for way in ways.values() for node in way["nodes"]}
    coordinates = {}
    for node in sorted(nodes):
        element = elements.get(("node", node))
        if not element:
            raise ValueError("Captured OSM way lacks a node coordinate")
        coordinates[str(node)] = [element["lat"], element["lon"]]
    source_collection_nodes = sorted(node for node in nodes if collection(node))
    if set(source_collection_nodes) != set(gates):
        raise ValueError("A reviewed source context contains an unmapped collection point")
    candidates = []
    for node in source_collection_nodes:
        element = elements["node", node]
        candidates.append({"id": node, "lat": element["lat"], "lon": element["lon"],
                           "tags": element.get("tags", {})})
    source = {
        "schemaVersion": 1,
        "country": "Portugal",
        "capture": "OSM API responses; exact nodes and whole directed source ways",
        "apiResponses": responses,
        "ways": [{field: way[field] for field in ("id", "version", "timestamp", "nodes", "tags")}
                 for _, way in sorted(ways.items())],
        "coordinates": coordinates,
        "chargeCandidates": candidates,
    }
    source_path = CONFIG / f"portugal-{key}-fixed.source.json"
    source_path.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n")
    review = {
        "schemaVersion": 1,
        "country": "Portugal",
        "region": "portugal",
        "partition": "mainland",
        "reviewed": True,
        "reviewedOn": "2026-11-08",
        "geometrySimplificationMeters": 2.0,
        "allowedHighways": definition["allowed"],
        "wayIds": sorted(identity[1] for identity in ways),
        "sourceSha256": digest(source_path),
        "seedSha256": "SET_BY_COMPOSER",
        "scope": definition["scope"],
        "sources": ["https://ascendi.pt/portagens-eletronicas/",
                    *["https://api.openstreetmap.org/api/0.6/map.json" for _ in responses]],
        "chargePoints": {str(node): charge for node, charge in gates.items()},
        "physicalReview": {
            "basis": "Official 2026 facility endpoints are bound to the explicit OSM collection nodes on their directed source ways; legacy packaged event identities are ignored.",
            "limits": "Only the captured whole source ways are certified. Adjacent roads, similarly named facilities and A41 conflict rows are excluded.",
        },
    }
    review_path = CONFIG / f"portugal-{key}-fixed.json"
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n")
    return source_path, review_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    args = parser.parse_args()
    for key, definition in ROADS.items():
        source, review = normalize(args.raw_dir, key, definition)
        print(key, digest(source), review)


if __name__ == "__main__":
    main()
