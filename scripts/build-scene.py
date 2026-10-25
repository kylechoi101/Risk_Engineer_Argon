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


def center_of_ring(ring):
    return (sum(p[0] for p in ring[:-1]) / (len(ring) - 1),
            sum(p[1] for p in ring[:-1]) / (len(ring) - 1))


def in_ring(point, ring):
    x, y = point
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_zone(point, zone):
    for polygon in zone["the_geom"]["coordinates"]:
        if in_ring(point, polygon[0]) and not any(in_ring(point, hole) for hole in polygon[1:]):
            return True
    return False


buildings = []
building_centers = []
source = json.loads((ROOT / "data/buildings-source.geojson").read_text())
for feature in source["features"]:
    geometry = feature["geometry"]
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    ring = max((polygon[0] for polygon in polygons), key=len)
    if len(ring) < 4:
        continue
    cx, cy = center_of_ring(ring)
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
    building_centers.append((cx, cy))

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

zones = json.loads((ROOT / "data/seismic-zones-source.json").read_text())
zone_buildings = sum(any(in_zone(center, zone) for zone in zones) for center in building_centers)

tall = []
for record in json.loads((ROOT / "data/tall-buildings-source.json").read_text()):
    geometry = record.get("polygon") or {}
    if geometry.get("type") != "Polygon":
        continue
    center = center_of_ring(geometry["coordinates"][0])
    px, py = xy(center)
    if math.hypot(px, py) > 1609:
        continue
    tall.append({
        "xy": [round(px, 1), round(py, 1)],
        "name": record.get("name") or record.get("address") or "Tall building",
        "heightM": round(float(record.get("height_ft") or 0) * .3048, 1),
        "system": record.get("structural_system") or record.get("structural_types") or "Unspecified",
        "foundation": record.get("foundation_system") or "Unspecified",
        "liquefaction": record.get("liquefaction_potential") or "Unspecified"
    })

soft_story = []
for record in json.loads((ROOT / "data/soft-story-source.json").read_text()):
    point = record.get("point") or {}
    if point.get("type") != "Point":
        continue
    px, py = xy(point["coordinates"])
    if math.hypot(px, py) > 1609:
        continue
    soft_story.append({
        "xy": [round(px, 1), round(py, 1)],
        "tier": int(record.get("tier") or 0),
        "status": record.get("status") or "Unknown"
    })
soft_story_open = sum("Work Complete" not in record["status"] for record in soft_story)

datums = json.loads((ROOT / "data/noaa-datums-source.json").read_text())
datum_values = {entry["name"]: float(entry["value"]) for entry in datums["datums"]}
mhhw_navd88_m = round(datum_values["MHHW"] - datum_values["NAVD88"], 3)

out = {
    "origin": {"lat": ORIGIN[1], "lon": ORIGIN[0]},
    "radiusMeters": 1609,
    "sources": {
        "buildings": "https://data.sf.gov/d/ynuv-fyni",
        "streets": "https://data.sf.gov/d/3psu-pn9h",
        "tallBuildings": "https://data.sf.gov/d/5kya-mfst",
        "softStory": "https://data.sf.gov/d/beah-shgi",
        "seismicZones": "https://data.sf.gov/d/re79-p8j5",
        "tidalDatums": "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric"
    },
    "datum": {"station": "9414290", "mhhwNavd88M": mhhw_navd88_m},
    "exposure": {"buildingCount": len(buildings), "seismicZoneBuildings": zone_buildings,
                 "tallBuildingCount": len(tall), "softStoryCount": len(soft_story),
                 "softStoryOpenCount": soft_story_open},
    "buildings": buildings,
    "roads": roads,
    "tallBuildings": tall,
    "softStory": soft_story
}
target = ROOT / "public/data/scene.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(out, separators=(",", ":")))
print(f"{len(buildings)} buildings, {len(roads)} roads, {len(tall)} tall, {len(soft_story)} soft story ({soft_story_open} not marked complete), {zone_buildings} in seismic zones, MHHW {mhhw_navd88_m} m NAVD88; {target.stat().st_size:,} bytes")
