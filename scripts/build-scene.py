"""Compact DataSF waterfront footprints and street centerlines for the browser scene."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = (-122.3937, 37.7955)  # Ferry Building
METERS_PER_DEG_LAT = 111_132
METERS_PER_DEG_LON = 111_320 * math.cos(math.radians(ORIGIN[1]))


def xy(coord):
    return [(coord[0] - ORIGIN[0]) * METERS_PER_DEG_LON,
            (coord[1] - ORIGIN[1]) * METERS_PER_DEG_LAT]


def distance_to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def simplify(points, tolerance):
    if len(points) <= 3:
        return points
    a, b = points[0], points[-1]
    index, greatest = 0, 0
    for i in range(1, len(points) - 1):
        distance = distance_to_segment(points[i], a, b)
        if distance > greatest:
            index, greatest = i, distance
    if greatest <= tolerance:
        return [a, b]
    return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def compact_line(coords, tolerance=2):
    points = simplify([xy(c) for c in coords], tolerance)
    return [[round(x, 1), round(y, 1)] for x, y in points]


buildings = []
source = json.loads((ROOT / "data/buildings-source.geojson").read_text())
for feature in source["features"]:
    geometry = feature["geometry"]
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    ring = max((polygon[0] for polygon in polygons), key=len)
    if len(ring) < 4:
        continue
    cx = sum(p[0] for p in ring[:-1]) / (len(ring) - 1)
    cy = sum(p[1] for p in ring[:-1]) / (len(ring) - 1)
    center = xy((cx, cy))
    if math.hypot(*center) > 1680:
        continue
    points = compact_line(ring, 1.3)
    if len(points) < 4:
        continue
    prop = feature["properties"]
    try:
        height = float(prop.get("hgt_median_m") or prop.get("gnd1st_delta") or 12)
    except ValueError:
        height = 12
    height = max(3, min(220, height))
    ground = float(prop.get("gnd_min_m") or 0)
    buildings.append([points, round(height, 1), round(ground, 1)])

roads = []
source = json.loads((ROOT / "data/roads-source.geojson").read_text())
for feature in source["features"]:
    geometry = feature["geometry"]
    segments = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
    prop = feature["properties"]
    for segment in segments:
        points = compact_line(segment, 2.0)
        if len(points) >= 2 and any(math.hypot(*p) < 1700 for p in points):
            roads.append([points, int(prop.get("classcode") or 5), prop.get("streetname") or ""])

out = {
    "origin": {"lat": ORIGIN[1], "lon": ORIGIN[0]},
    "radiusMeters": 1609,
    "sources": {
        "buildings": "https://data.sf.gov/d/ynuv-fyni",
        "streets": "https://data.sf.gov/d/3psu-pn9h"
    },
    "buildings": buildings,
    "roads": roads
}
target = ROOT / "public/data/scene.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(out, separators=(",", ":")))
print(f"{len(buildings)} buildings, {len(roads)} roads, {target.stat().st_size:,} bytes")
