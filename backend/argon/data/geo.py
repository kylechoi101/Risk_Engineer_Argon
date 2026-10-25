"""Small pure geometry helpers in lon/lat, using a local equirectangular projection."""

import math

ORIGIN = (37.7955, -122.3937)  # Ferry Building (lat, lon)
METERS_PER_MILE = 1609.344
_M_PER_DEG_LAT = 111_132.0


def m_per_deg_lon(lat: float = ORIGIN[0]) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def box_around(center: tuple[float, float], radius_m: float) -> tuple[float, float, float, float]:
    """(south, west, north, east) bounding box of a circle."""
    lat, lon = center
    dlat, dlon = radius_m / _M_PER_DEG_LAT, radius_m / m_per_deg_lon(lat)
    return lat - dlat, lon - dlon, lat + dlat, lon + dlon


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Approximate ground distance between two (lat, lon) points, fine at neighborhood scale."""
    return math.hypot((a[0] - b[0]) * _M_PER_DEG_LAT, (a[1] - b[1]) * m_per_deg_lon(a[0]))


def to_local(lon: float, lat: float) -> tuple[float, float]:
    return ((lon - ORIGIN[1]) * m_per_deg_lon(), (lat - ORIGIN[0]) * _M_PER_DEG_LAT)


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """Vertex mean of a closed [lon, lat] ring, returned as (lat, lon)."""
    points = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return (sum(p[1] for p in points) / len(points), sum(p[0] for p in points) / len(points))


def in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_multipolygon(lon: float, lat: float, coordinates: list) -> bool:
    for polygon in coordinates:
        if in_ring(lon, lat, polygon[0]) and not any(in_ring(lon, lat, h) for h in polygon[1:]):
            return True
    return False


def _segment_distance(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def simplify_ring(ring: list[list[float]], tolerance_m: float) -> list[list[float]]:
    """Douglas-Peucker in local meters; returns [lon, lat] points rounded to ~0.1 m."""
    local = [to_local(p[0], p[1]) for p in ring]

    def keep(lo: int, hi: int) -> list[int]:
        best, index = 0.0, lo
        for i in range(lo + 1, hi):
            d = _segment_distance(local[i], local[lo], local[hi])
            if d > best:
                best, index = d, i
        if best <= tolerance_m:
            return [lo, hi]
        return keep(lo, index)[:-1] + keep(index, hi)

    indices = keep(0, len(ring) - 1) if len(ring) > 3 else list(range(len(ring)))
    return [[round(ring[i][0], 6), round(ring[i][1], 6)] for i in indices]
