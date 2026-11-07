#!/usr/bin/env python3
"""Compile reviewed fixed-charge corridors onto an unchanged routing graph.

The configuration selects original directed source ways and physical collection
nodes. Road references alone never certify an edge or select a price.
"""
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
import math
import mmap
from pathlib import Path
import struct
import tempfile

from toll_free_geometry import clipped_way_witness, _project, _projections

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'tools/toll-binding-config'
spec = importlib.util.spec_from_file_location('free_corridors', ROOT / 'tools/build-free-toll-corridors.py')
free = importlib.util.module_from_spec(spec)
spec.loader.exec_module(free)
binding = free.binding


def source_shapes(review, source):
    if (review['schemaVersion'] != 1 or source['schemaVersion'] != 1
            or review['reviewed'] is not True or review['country'] != source['country']
            or review['geometrySimplificationMeters'] != 2.0):
        raise ValueError('Unreviewed or mismatched fixed corridor')
    ways = {w['id']: w for w in source['ways']}
    if len(ways) != len(source['ways']) or set(ways) != set(review['wayIds']):
        raise ValueError('Source ways differ from reviewed geometry')
    gates = {int(k): v for k, v in review['chargePoints'].items()}
    if not gates or any(not v for v in gates.values()):
        raise ValueError('Missing collection identity')
    candidates = {p['id'] for p in source['chargeCandidates']}
    on_way = {n for w in ways.values() for n in w['nodes']}
    if candidates & on_way != set(gates):
        raise ValueError('Every physical collection node must have a reviewed charge')
    coordinates = {int(k): binding.coordinate(v) for k, v in source['coordinates'].items()}
    if len({coordinates[n] for n in gates}) != len(gates):
        raise ValueError('Ambiguous collection coordinates')
    shapes = {}
    for wid, way in ways.items():
        t = way['tags']
        if (t.get('highway') not in review.get('allowedHighways', ['motorway']) or t.get('oneway') != 'yes'
                or t.get('access') in ('private', 'no') or t.get('motor_vehicle') in ('private', 'no')):
            raise ValueError('Unreviewed road type/direction/access')
        shapes[wid] = [coordinates[n] for n in way['nodes']]
    # Only explicitly reviewed, node-connected directed chains may bridge an
    # OSM way split that did not create a routing junction in the older graph.
    for chain in review.get('directedChains', []):
        ids = chain['wayIds']
        if len(ids) < 2 or len(set(ids)) != len(ids) or any(i not in ways for i in ids):
            raise ValueError('Invalid directed source chain')
        nodes = list(ways[ids[0]]['nodes'])
        for wid in ids[1:]:
            if nodes[-1] != ways[wid]['nodes'][0]:
                raise ValueError('Disconnected directed source chain')
            nodes.extend(ways[wid]['nodes'][1:])
        shapes['chain:' + '+'.join(map(str, ids))] = [coordinates[n] for n in nodes]
    return shapes, gates, coordinates


def crossing_offsets(graph, source, source_nodes, gates, witness, length):
    """Recover a gate from the certified source subpath, never a nearby road.

    Both graph and source progress use the same local projection. Half-open
    intervals assign a gate at a synthetic split to its outgoing edge only.
    """
    original = _project(source, graph[0])
    rendered = _project(graph, graph[0])
    cumulative = [0.]
    for a, b in zip(original, original[1:]):
        cumulative.append(cumulative[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(rendered, rendered[1:]))
    if total <= 0 or length <= 0:
        raise ValueError('Degenerate graph edge')
    result = []
    for node, p, along in zip(source_nodes, original, cumulative):
        if node not in gates or not witness['beginMeters'] <= along < witness['endMeters']:
            continue
        positions, _ = _projections(p, rendered)
        positions.sort()
        if not positions or positions[0][0] > witness['continuousBoundMeters']:
            raise ValueError('Collection node is outside the witnessed graph geometry')
        if any(abs(v[0] - positions[0][0]) < .005 and abs(v[1] - positions[0][1]) > .1 for v in positions[1:]):
            raise ValueError('Ambiguous collection progress')
        result.append(dict(osmNodeId=node, chargeId=gates[node], offsetMeters=positions[0][1] / total * length))
    return result


def network_offsets(shape, original, nodes, witness, length, bounds):
    """Project an explicitly reviewed paid interval; a road ref is no proof.

    Gate boundaries are half-open and use the same continuous source witness
    as collection events. Pre-entry and post-exit portions stay outside.
    """
    source = _project(original, shape[0])
    cumulative = [0.]
    for a, b in zip(source, source[1:]):
        cumulative.append(cumulative[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
    begin = cumulative[nodes.index(bounds['beginNode'])] if 'beginNode' in bounds else 0.
    end = cumulative[nodes.index(bounds['endNode'])] if 'endNode' in bounds else cumulative[-1]
    if end < begin:
        raise ValueError('Reversed paid source interval')
    lo, hi = max(begin, witness['beginMeters']), min(end, witness['endMeters'])
    if hi <= lo:
        return None
    # Complete witnessed edges need no boundary projection, avoiding floating
    # endpoint drift. Only a gate inside the source subpath splits an edge.
    rendered = _project(shape, shape[0])
    total = sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a,b in zip(rendered, rendered[1:]))
    def offset(value, default):
        if value == default[0]:
            return default[1]
        index = next(i for i in range(len(cumulative)-1) if cumulative[i] <= value <= cumulative[i+1])
        fraction = (value-cumulative[index])/(cumulative[index+1]-cumulative[index])
        a,b = source[index:index+2]
        point = (a[0]+fraction*(b[0]-a[0]), a[1]+fraction*(b[1]-a[1]))
        positions,_ = _projections(point, rendered)
        positions.sort()
        if not positions or positions[0][0] > witness['continuousBoundMeters']:
            raise ValueError('Network boundary outside source witness')
        return max(0., min(length, positions[0][1]/total*length))
    first = offset(lo, (witness['beginMeters'], 0.))
    last = offset(hi, (witness['endMeters'], length))
    return (first, last) if last > first else None


def generate(graph, review_path, source_path, seed_path):
    review, source = json.loads(review_path.read_text()), json.loads(source_path.read_text())
    if free.digest(source_path) != review['sourceSha256'] or free.digest(seed_path) != review['seedSha256']:
        raise ValueError('Source or seed integrity failure')
    shapes, gates, _ = source_shapes(review, source)
    ways = {w['id']: w for w in source['ways']}
    for chain in review.get('directedChains', []):
        ids = chain['wayIds']
        nodes = list(ways[ids[0]]['nodes'])
        for wid in ids[1:]:
            nodes.extend(ways[wid]['nodes'][1:])
        ways['chain:' + '+'.join(map(str, ids))] = dict(nodes=nodes)
    paid = review.get('networkRanges', {})
    if paid and (not review.get('network') or set(paid) - {str(w) for w in ways}):
        raise ValueError('Unknown reviewed network source geometry')
    seed = seed_path.read_text().splitlines()
    metadata = dict(line[1:].strip().split('=', 1) for line in seed if line.startswith('#') and '=' in line)
    hashes = {name: free.digest(graph / name) for name in free.FILES}
    if (metadata.get('country') != review['country'] or metadata.get('reviewed') != 'true'
            or any(metadata.get('graph.' + k) != v for k, v in hashes.items())):
        raise ValueError('Graph/country differs from reviewed seed')
    grid = defaultdict(set)
    cell = .002

    def tile(p):
        return math.floor(p[0] / cell), math.floor(p[1] / cell)

    for wid, shape in shapes.items():
        lo = tile((min(p[0] for p in shape) - .00005, min(p[1] for p in shape) - .00007))
        hi = tile((max(p[0] for p in shape) + .00005, max(p[1] for p in shape) + .00007))
        for lat in range(lo[0], hi[0] + 1):
            for lon in range(lo[1], hi[1] + 1):
                grid[lat, lon].add(wid)
    seed_edges = {int(line.split(';')[1]) for line in seed if line.startswith('coverage;')}
    streams = [(graph / name).open('rb') for name in free.FILES[:3]]
    maps = [mmap.mmap(s.fileno(), 0, access=mmap.ACCESS_READ) for s in streams]
    covered, events, networks = {}, [], []
    try:
        n, e, g = maps
        for data, magic in ((n, b'RNOD'), (e, b'REDG'), (g, b'RGEO')):
            if data[:4] != magic or binding.u32(data, 4) != 6:
                raise ValueError('Unsupported graph format')
        points = 24 + binding.u32(g, 8) * 8
        edge_base = 20 + (binding.u32(e, 8) + 1) * 4
        for node in range(binding.u32(n, 8)):
            start = binding.point(n, 16 + node * 12)
            possible = grid.get(tile(start))
            if not possible:
                continue
            for edge in range(binding.u32(e, 20 + node * 4), binding.u32(e, 24 + node * 4)):
                target, dm, attrs, geometry, road = struct.unpack_from('<IIIII', e, edge_base + edge * 20)
                if not geometry & 0x20000000:
                    continue
                end = binding.point(n, 16 + target * 12)
                candidates = possible & grid.get(tile(end), set())
                if not candidates:
                    continue
                offset, count = struct.unpack_from('<II', g, 24 + (geometry & 0x1fffffff) * 8)
                shape = [binding.point(g, points + (offset + i) * 8) for i in range(count)]
                if geometry & 0x80000000:
                    shape.reverse()
                shape = [start] + shape + [end]
                tolerance = 2 + 2 * max(binding.quantization_radius(p) for p in shape)
                matches = []
                for wid in sorted(candidates, key=str):
                    witness = clipped_way_witness(shape, shapes[wid], tolerance=tolerance)
                    if witness:
                        charges = crossing_offsets(shape, shapes[wid], ways[wid]['nodes'], gates, witness, dm / 10)
                        interval = network_offsets(shape, shapes[wid], ways[wid]['nodes'], witness, dm/10,
                            paid[str(wid)]) if str(wid) in paid else None
                        matches.append((wid, witness, charges, interval))
                if not matches:
                    continue
                identities = {tuple((v['osmNodeId'], v['chargeId'], round(v['offsetMeters'], 5)) for v in match[2]) for match in matches}
                intervals = {tuple(round(v, 5) for v in m[3]) if m[3] else None for m in matches}
                if len(identities) != 1 or len(intervals) != 1 or edge in seed_edges:
                    raise ValueError('Conflicting or overlapping reviewed corridor evidence')
                covered[edge] = dict(fromNode=node, toNode=target, lengthMeters=dm / 10,
                    witnesses=[dict(wayId=m[0], **m[1]) for m in matches])
                if matches[0][3]:
                    begin, end = matches[0][3]
                    networks.append(dict(edge=edge, fromNode=node, toNode=target,
                        beginMeters=begin, endMeters=end, network=review['network']))
                for charge in matches[0][2]:
                    events.append(dict(edge=edge, fromNode=node, toNode=target, lengthMeters=dm / 10, **charge))
    finally:
        for data in maps:
            data.close()
        for stream in streams:
            stream.close()
    matched = [v['osmNodeId'] for v in events]
    if set(matched) != set(gates) or len(matched) != len(gates):
        raise ValueError('Each physical gate must match exactly once: ' + str(matched))
    comments = [line for line in seed if line.startswith('#')]
    comments += ['# reviewedCorridor.' + free.digest(review_path) + '=' + free.digest(source_path)]
    lines = comments + ['kind;edge;from;to;offsetMeters;edgeLengthMeters;chargeId']
    lines += ['coverage;' + str(edge) + ';;;;;' for edge in sorted(seed_edges | set(covered))]
    old_events = [line for line in seed if line.startswith('crossing;')]
    lines += old_events
    lines += [line for line in seed if line.startswith('network;')]
    lines += ['network;{edge};{fromNode};{toNode};{beginMeters:.9f};{endMeters:.9f};{network}'.format(**v) for v in networks]
    lines += ['crossing;{edge};{fromNode};{toNode};{offsetMeters:.9f};{lengthMeters:.1f};{chargeId}'.format(**v) for v in events]
    text = '\n'.join(lines) + '\n'
    report = dict(country=review['country'], scope=review['scope'], graphDigests=hashes,
        sourceSha256=free.digest(source_path), reviewSha256=free.digest(review_path), seedSha256=free.digest(seed_path),
        seedCoveredEdges=len(seed_edges), additionalCoveredEdges=len(covered), chargedCrossingsUnchanged=old_events,
        bindingsSha256=hashlib.sha256(text.encode()).hexdigest(), crossings=events, networks=networks, edgeWitnesses=covered)
    return text, report


def generate_catalog(graph, catalog_path):
    """Compose reviewed corridors; keep each stage hash-bound and reproducible."""
    catalog = json.loads(catalog_path.read_text())
    if catalog['schemaVersion'] != 1 or not catalog['corridors']:
        raise ValueError('Invalid country corridor catalog')
    directory = catalog_path.parent
    seed = directory / catalog['seed']
    seed_hash = free.digest(seed)
    stages = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, entry in enumerate(catalog['corridors']):
            review, source = directory / entry['review'], directory / entry['source']
            if json.loads(review.read_text())['country'] != catalog['country']:
                raise ValueError('Cross-country corridor composition')
            text, stage = (free.generate if entry.get('kind') == 'free' else generate)(graph, review, source, seed)
            stages.append(stage)
            seed = Path(tmp) / (str(i) + '.csv')
            seed.write_text(text)
    report = dict(country=catalog['country'], catalogSha256=free.digest(catalog_path), seedSha256=seed_hash,
        seedCoveredEdges=stages[0]['seedCoveredEdges'],
        additionalCoveredEdges=sum(s.get('additionalCoveredEdges', s.get('additionalFreeEdges', 0)) for s in stages),
        bindingsSha256=stages[-1]['bindingsSha256'], stages=stages)
    return text, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, default=CONFIG / 'portugal-fixed-corridors.json')
    parser.add_argument('--review', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--seed', type=Path, default=CONFIG / 'portugal-lisbon-reviewed.csv')
    parser.add_argument('--output', type=Path, default=ROOT / 'android/native-app/src/main/assets/toll-bindings/Portugal/mainland.csv')
    parser.add_argument('--report', type=Path, default=ROOT / 'dist/fixed-toll-corridors.json')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if bool(args.review) != bool(args.source):
        parser.error('--review and --source are required together')
    output, report = (generate(args.graph, args.review, args.source, args.seed) if args.review
        else generate_catalog(args.graph, args.catalog))
    if args.check:
        if args.output.read_text() != output:
            raise ValueError('Shipped fixed bindings differ from verified geometry')
    else:
        args.output.write_text(output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('edgeWitnesses', 'stages')}, ensure_ascii=False))
