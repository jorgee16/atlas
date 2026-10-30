"""Certify clipped graph geometry against an independently reviewed free way.

The packager inserts synthetic graph endpoints at its maximum segment length.
An endpoint therefore need not be an OSM vertex. This helper proves a directed
subpath match inside the existing simplification/float-quantization bound.
It never changes navigation geometry or certifies an unreviewed way as free.
"""
import bisect
import math


def _project(points, origin):
    sx = 111320 * math.cos(math.radians(origin[0]))
    return [((p[1] - origin[1]) * sx, (p[0] - origin[0]) * 111320) for p in points]


def _projections(point, line):
    along, found = 0., []
    for index, (a, b) in enumerate(zip(line, line[1:])):
        dx, dy = b[0] - a[0], b[1] - a[1]
        squared = dx * dx + dy * dy
        if not squared:
            continue
        length = math.sqrt(squared)
        t = max(0., min(1., ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared))
        foot = a[0] + t * dx, a[1] + t * dy
        found.append((math.hypot(point[0] - foot[0], point[1] - foot[1]), along + t * length, index, t))
        along += length
    return found, along


def _distance(point, line):
    values, _ = _projections(point, line)
    return min((v[0] for v in values), default=min(
        (math.hypot(point[0] - q[0], point[1] - q[1]) for q in line), default=math.inf))


def _covered_segment(a, b, line, tolerance, budget, depth=0):
    # A segment's tolerance capsule is convex. Endpoints in the same capsule
    # prove the entire chord fits; otherwise subdivide at source boundaries.
    # Checking just vertices or spaced samples could miss a shortcut/spike.
    budget[0] -= 1
    if budget[0] < 0:
        return False
    for c, d in zip(line, line[1:]):
        if _distance(a, [c, d]) <= tolerance and _distance(b, [c, d]) <= tolerance:
            return True
    if depth >= 24:
        return False
    middle = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    if _distance(middle, line) > tolerance:
        return False
    return (_covered_segment(a, middle, line, tolerance, budget, depth + 1)
            and _covered_segment(middle, b, line, tolerance, budget, depth + 1))


def clipped_way_witness(graph, source, reverse=False, tolerance=2.0):
    """Return a geometric witness, or None; never infer a monetary amount.

    `reverse` must be authorized by the source way's direction at the caller.
    The caller supplies the packager bound plus measured float quantization.
    """
    if not math.isfinite(tolerance) or not 0 <= tolerance <= 4:
        raise ValueError('Invalid geometry tolerance')
    if any(len(p) != 2 or not all(math.isfinite(v) for v in p)
           or not -90 <= p[0] <= 90 or not -180 <= p[1] <= 180 for p in graph + source):
        return None
    graph = [p for i, p in enumerate(graph) if i == 0 or p != graph[i - 1]]
    source = [p for i, p in enumerate(source) if i == 0 or p != source[i - 1]]
    if len(graph) < 2 or len(source) < 2:
        return None
    if reverse:
        source = list(reversed(source))
    gg, ss = _project(graph, graph[0]), _project(source, graph[0])
    closed = ss[0] == ss[-1]
    progress, total = [], 0.
    for point in gg:
        candidates, total = _projections(point, ss)
        if not candidates:
            return None
        candidates.sort()
        best = candidates[0]
        if best[0] > tolerance:
            return None
        # Adjacent source segments may share the same projection. Distinct
        # equally good positions on a self-near path are not interchangeable.
        for candidate in candidates[1:]:
            delta = abs(candidate[1] - best[1])
            equivalent = min(delta, abs(delta - total)) if closed else delta
            if abs(candidate[0] - best[0]) < .005 and equivalent > .1:
                return None
        progress.append(best[1])
    unwrapped, extra = [], 0.
    for value in progress:
        if closed and unwrapped and value + extra < unwrapped[-1] - total / 2:
            extra += total
        value += extra
        if unwrapped and value < unwrapped[-1] - .10:
            return None
        unwrapped.append(value)
    begin, end = unwrapped[0], unwrapped[-1]
    if end - begin < .01 or end - begin > total + .1:
        return None
    cumulative = [0.]
    for a, b in zip(ss, ss[1:]):
        cumulative.append(cumulative[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))

    def at(value):
        if value > total:
            value -= total
        index = max(0, min(len(ss) - 2, bisect.bisect_right(cumulative, value) - 1))
        length = cumulative[index + 1] - cumulative[index]
        t = (value - cumulative[index]) / length if length else 0.
        a, b = ss[index], ss[index + 1]
        return a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])

    path = [at(begin)]
    for lap in ([0, 1] if closed else [0]):
        for point, value in zip(ss, cumulative):
            if begin < value + lap * total < end:
                path.append(point)
    path.append(at(end))
    budget, deviation = [20000], 0.
    for first, second in ((gg, path), (path, gg)):
        for a, b in zip(first, first[1:]):
            if not _covered_segment(a, b, second, tolerance, budget):
                return None
            deviation = max(deviation, _distance(a, second), _distance(b, second))
    return dict(beginMeters=begin, endMeters=end, reversed=reverse,
                continuousBoundMeters=tolerance, maxVertexDeviationMeters=deviation)
