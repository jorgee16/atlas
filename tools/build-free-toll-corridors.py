#!/usr/bin/env python3
"""Extend reviewed toll evidence with explicitly reviewed, price-free corridors.

No route is an input: all matching graph edges are certified against the same
independent source-way geometry, including synthetic clipped endpoints. Unknown
roads are not certified and existing charged crossings remain byte-for-byte.
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

from toll_free_geometry import clipped_way_witness, _distance, _project

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'tools/toll-binding-config'
FILES = ['nodes.bin', 'edges.bin', 'geometry.bin', 'roads.bin', 'strings.bin', 'restrictions.bin', 'spatial-index.bin']
spec = importlib.util.spec_from_file_location('binding_geometry', ROOT / 'tools/build-toll-bindings.py')
binding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(binding)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inputs(review_path, source_path, seed_path):
    review, source = json.loads(review_path.read_text()), json.loads(source_path.read_text())
    if (review['schemaVersion'] != 1 or source['schemaVersion'] != 1 or review['reviewed'] is not True
            or review['country'] != source['country'] or review['geometrySimplificationMeters'] != 2.0
            or digest(source_path) != review['sourceSha256'] or digest(seed_path) != review['seedSha256']):
        raise ValueError('Unreviewed, corrupt or mismatched corridor evidence')
    approval = {row['wayId']: row for row in review['ways']}
    if len(approval) != len(review['ways']) or any(row['reviewed'] is not True
            or row['kind'] not in ('explicit-free-corridor', 'reviewed-approach') or not row['reason'] for row in approval.values()):
        raise ValueError('Invalid free-way review')
    ways = {row['id']: row for row in source['ways']}
    if len(ways) != len(source['ways']) or set(ways) != set(approval):
        raise ValueError('Source ways differ from the reviewed set')
    seed = seed_path.read_text().splitlines()
    metadata = dict(line[1:].strip().split('=', 1) for line in seed if line.startswith('#') and '=' in line)
    if metadata.get('reviewed') != 'true' or metadata.get('country') != review['country']:
        raise ValueError('Wrong seed country or review')
    charged_points = [(p['lat'], p['lon']) for p in source['chargeCandidates']]
    shapes = {}
    for wid, way in ways.items():
        tags = way['tags']
        if tags.get('name', '') != approval[wid]['name'] or tags.get('ref', '') != approval[wid]['ref']:
            raise ValueError('Source identity changed since review')
        if approval[wid]['kind'] == 'explicit-free-corridor' and tags.get('toll') != 'no':
            raise ValueError('Explicit free-way source does not say toll=no')
        if tags.get('access') in ('private', 'no') or tags.get('motor_vehicle') in ('private', 'no') or tags.get('fee') == 'yes':
            raise ValueError('Private/charged geometry cannot be certified free')
        shape = [binding.coordinate(source['coordinates'][str(node)]) for node in way['nodes']]
        shape = [p for i, p in enumerate(shape) if i == 0 or p != shape[i - 1]]
        if len(shape) < 2:
            raise ValueError('Empty source geometry')
        # Reject a facility anywhere on/near the whole reviewed source way,
        # before clipping. No OSM booth/gantry can disappear into a free row.
        projected = _project(shape, shape[0])
        minlat, maxlat = min(p[0] for p in shape) - .00005, max(p[0] for p in shape) + .00005
        minlon, maxlon = min(p[1] for p in shape) - .00007, max(p[1] for p in shape) + .00007
        tolerance = 2 + 2 * max(binding.quantization_radius(p) for p in shape)
        for point in charged_points:
            if minlat <= point[0] <= maxlat and minlon <= point[1] <= maxlon:
                if _distance(_project([point], shape[0])[0], projected) <= tolerance:
                    raise ValueError('Charging facility intersects reviewed free way: ' + str(wid))
        direction = tags.get('oneway', 'yes' if tags['highway'] == 'motorway' or tags.get('junction') == 'roundabout' else 'no')
        if direction not in ('yes', '1', 'true', '-1', 'no', '0', 'false'):
            raise ValueError('Unknown source direction')
        reversals = [True] if direction == '-1' else [False] if direction in ('yes', '1', 'true') else [False, True]
        shapes[wid] = (shape, reversals)
    return review, source, seed, metadata, shapes


def generate(graph, review_path, source_path, seed_path):
    review, source, seed, metadata, shapes = inputs(review_path, source_path, seed_path)
    hashes = {name: digest(graph / name) for name in FILES}
    if any(metadata.get('graph.' + name) != value for name, value in hashes.items()):
        raise ValueError('Loaded graph differs from the reviewed seed graph')
    grid = defaultdict(set)
    cell = .002

    def tile(point):
        return math.floor(point[0] / cell), math.floor(point[1] / cell)

    for wid, (shape, _) in shapes.items():
        lo = tile((min(p[0] for p in shape) - .00005, min(p[1] for p in shape) - .00007))
        hi = tile((max(p[0] for p in shape) + .00005, max(p[1] for p in shape) + .00007))
        for lat in range(lo[0], hi[0] + 1):
            for lon in range(lo[1], hi[1] + 1):
                grid[lat, lon].add(wid)
    seed_coverage = {int(line.split(';')[1]) for line in seed if line.startswith('coverage;')}
    streams = [(graph / name).open('rb') for name in FILES[:3]]
    maps = [mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) for stream in streams]
    covered = {}
    try:
        n, e, g = maps
        for data, magic in ((n, b'RNOD'), (e, b'REDG'), (g, b'RGEO')):
            if data[:4] != magic or binding.u32(data, 4) != 6:
                raise ValueError('Unsupported graph format')
        point_base = 24 + binding.u32(g, 8) * 8
        edge_base = 20 + (binding.u32(e, 8) + 1) * 4
        for node in range(binding.u32(n, 8)):
            start_point = binding.point(n, 16 + node * 12)
            possible = grid.get(tile(start_point))
            if not possible:
                continue
            for edge in range(binding.u32(e, 20 + node * 4), binding.u32(e, 24 + node * 4)):
                target, dm, attrs, geometry, road = struct.unpack_from('<IIIII', e, edge_base + edge * 20)
                if edge in seed_coverage or not geometry & 0x20000000:
                    continue
                end_point = binding.point(n, 16 + target * 12)
                candidates = possible & grid.get(tile(end_point), set())
                if not candidates:
                    continue
                offset, count = struct.unpack_from('<II', g, 24 + (geometry & 0x1fffffff) * 8)
                shape = [binding.point(g, point_base + (offset + i) * 8) for i in range(count)]
                if geometry & 0x80000000:
                    shape.reverse()
                shape = [start_point] + shape + [end_point]
                tolerance = 2 + 2 * max(binding.quantization_radius(p) for p in shape)
                witnesses = []
                for wid in sorted(candidates):
                    original, reversals = shapes[wid]
                    for reverse in reversals:
                        witness = clipped_way_witness(shape, original, reverse, tolerance)
                        if witness:
                            witnesses.append(dict(wayId=wid, **witness))
                if witnesses:
                    # Every candidate here is independently reviewed free;
                    # ambiguous unreviewed paths are never supplied as witnesses.
                    covered[edge] = dict(fromNode=node, toNode=target, edgeLengthMeters=dm / 10, witnesses=witnesses)
    finally:
        for data in maps:
            data.close()
        for stream in streams:
            stream.close()
    comments = [line for line in seed if line.startswith('#')]
    comments += ['# freeCorridorSourceSha256=' + digest(source_path), '# freeCorridorReviewSha256=' + digest(review_path)]
    crossings = [line for line in seed if line.startswith('crossing;')]
    lines = comments + ['kind;edge;from;to;offsetMeters;edgeLengthMeters;chargeId']
    lines += ['coverage;' + str(edge) + ';;;;;' for edge in sorted(seed_coverage | set(covered))]
    lines += crossings
    text = '\n'.join(lines) + '\n'
    report = dict(country=review['country'], reviewedSourceWays=len(shapes), sourceSha256=digest(source_path),
        reviewSha256=digest(review_path), seedSha256=digest(seed_path), graphDigests=hashes,
        seedCoveredEdges=len(seed_coverage), additionalFreeEdges=len(covered), chargedCrossingsUnchanged=crossings,
        bindingsSha256=hashlib.sha256(text.encode()).hexdigest(), scope=review['scope'], freeEdgeWitnesses=covered)
    return text, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, required=True)
    parser.add_argument('--review', type=Path, default=CONFIG / 'portugal-lisbon-free-corridors.json')
    parser.add_argument('--source', type=Path, default=CONFIG / 'portugal-lisbon-free-corridors.source.json')
    parser.add_argument('--seed', type=Path, default=CONFIG / 'portugal-a5-reviewed-seed.csv')
    parser.add_argument('--output', type=Path, default=ROOT / 'android/native-app/src/main/assets/toll-bindings/Portugal/mainland.csv')
    parser.add_argument('--report', type=Path, default=ROOT / 'dist/free-toll-corridors.json')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    output, report = generate(args.graph, args.review, args.source, args.seed)
    if args.check:
        if args.output.read_text() != output:
            raise ValueError('Shipped toll evidence differs from verified geometry')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'freeEdgeWitnesses'}, ensure_ascii=False))
