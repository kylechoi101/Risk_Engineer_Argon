"""Build the committed data snapshot from raw sources, and cut request layers from it."""

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from argon.data.geo import (
    ORIGIN,
    distance_m,
    in_multipolygon,
    in_ring,
    ring_centroid,
    simplify_ring,
)
from argon.engine.buildings import BuildingArrays

SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "data" / "snapshot.json"
HIGH_LIQUEFACTION = {"High", "Very High"}


def _bbox(ring):
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _containing(footprints, lon, lat):
    for i, f in enumerate(footprints):
        x0, y0, x1, y1 = f["_bbox"]
        if x0 <= lon <= x1 and y0 <= lat <= y1 and in_ring(lon, lat, f["ring"]):
            return i
    return None


def _number(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def build_snapshot(raw: dict, collected: str) -> dict:
    footprints = []
    for feature in raw["footprints"]["features"]:
        geometry = feature.get("geometry") or {}
        polygons = (geometry.get("coordinates") or []) if geometry.get("type") == "MultiPolygon" \
            else [geometry.get("coordinates") or []]
        rings = [p[0] for p in polygons if p and len(p[0]) >= 4]
        if not rings:
            continue
        ring = simplify_ring(max(rings, key=len), 1.3)
        if len(ring) < 4:
            continue
        lat, lon = ring_centroid(ring)
        prop = feature.get("properties") or {}
        footprints.append({
            "ring": ring, "lat": round(lat, 6), "lon": round(lon, 6),
            "height_m": round(max(3.0, min(220.0, _number(prop.get("hgt_median_m"), 12))), 1),
            "ground_m": round(_number(prop.get("gnd_min_m"), 0), 2),
            "in_zone": False, "soft_story": None, "tall_index": None, "_bbox": _bbox(ring),
        })

    zones = []
    for record in raw["zones"]:
        geometry = record.get("the_geom") or {}
        if geometry.get("type") != "MultiPolygon":
            continue
        coordinates = [[simplify_ring(r, 2.0) for r in polygon] for polygon in geometry["coordinates"]]
        zones.append({"id": record.get("id"), "coordinates": coordinates})
    for f in footprints:
        f["in_zone"] = any(in_multipolygon(f["lon"], f["lat"], z["coordinates"]) for z in zones)

    tall = []
    for record in raw["tall"]:
        geometry = record.get("polygon") or {}
        if geometry.get("type") != "Polygon":
            continue
        lat, lon = ring_centroid(geometry["coordinates"][0])
        index = len(tall)
        tall.append({
            "lat": round(lat, 6), "lon": round(lon, 6),
            "name": record.get("name") or record.get("address") or "Tall building",
            "height_m": round(_number(record.get("height_ft"), 0) * 0.3048, 1),
            "system": record.get("structural_system") or record.get("structural_types")
            or "Unspecified",
            "foundation": record.get("foundation_system") or "Unspecified",
            "liquefaction": record.get("liquefaction_potential") or "Unspecified",
        })
        hit = _containing(footprints, lon, lat)
        if hit is not None:
            footprints[hit]["tall_index"] = index

    soft_story = []
    for record in raw["soft_story"]:
        point = record.get("point") or {}
        if point.get("type") != "Point":
            continue
        lon, lat = point["coordinates"]
        status = record.get("status") or "Unknown"
        is_open = "Work Complete" not in status
        soft_story.append({"lat": round(lat, 6), "lon": round(lon, 6),
                           "address": record.get("property_address") or "",
                           "tier": int(_number(record.get("tier"), 0)), "status": status,
                           "open": is_open})
        hit = _containing(footprints, lon, lat)
        if hit is not None and footprints[hit]["soft_story"] != "open":
            footprints[hit]["soft_story"] = "open" if is_open else "complete"

    values = {d["name"]: float(d["value"]) for d in raw["datums"]["datums"]}
    for f in footprints:
        del f["_bbox"]
    return {
        "version": 1,
        "collected": collected,
        "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1], "label": "Ferry Building"},
        "datums": {
            "station": "9414290",
            "mhhw_navd88_m": round(values["MHHW"] - values["NAVD88"], 3),
            "mllw_navd88_m": round(values["MLLW"] - values["NAVD88"], 3),
        },
        "footprints": footprints,
        "tall_buildings": tall,
        "soft_story": soft_story,
        "zones": zones,
    }


@lru_cache(maxsize=2)
def load_snapshot(path: Path = SNAPSHOT_PATH) -> dict:
    return json.loads(Path(path).read_text())


def _point(lat, lon, properties):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": properties}


def _collection(features):
    return {"type": "FeatureCollection", "features": features}


def layers_for(snapshot: dict, radius_m: float) -> dict:
    """GeoJSON layers within radius of the origin, plus aligned arrays for the engine."""
    origin = (snapshot["origin"]["lat"], snapshot["origin"]["lon"])

    def near(item):
        return distance_m(origin, (item["lat"], item["lon"])) <= radius_m

    tall_all = snapshot["tall_buildings"]
    footprints = [f for f in snapshot["footprints"] if near(f)]
    features = []
    for i, f in enumerate(footprints):
        tall = tall_all[f["tall_index"]] if f["tall_index"] is not None else None
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [f["ring"]]},
            "properties": {"id": i, "height_m": f["height_m"], "ground_m": f["ground_m"],
                           "in_zone": f["in_zone"], "soft_story": f["soft_story"],
                           "tall": tall["name"] if tall else None},
        })
    buildings = BuildingArrays(
        in_zone=np.array([f["in_zone"] for f in footprints], dtype=bool),
        soft_story_open=np.array([f["soft_story"] == "open" for f in footprints], dtype=bool),
        soft_story_done=np.array([f["soft_story"] == "complete" for f in footprints], dtype=bool),
        tall_liquefaction=np.array(
            [f["tall_index"] is not None
             and tall_all[f["tall_index"]]["liquefaction"] in HIGH_LIQUEFACTION
             for f in footprints], dtype=bool),
        height_m=np.array([f["height_m"] for f in footprints], dtype=float),
        ground_m=np.array([f["ground_m"] for f in footprints], dtype=float),
    )
    tall = [_point(t["lat"], t["lon"], {k: v for k, v in t.items() if k not in ("lat", "lon")})
            for t in tall_all if near(t)]
    soft = [_point(s["lat"], s["lon"], {k: v for k, v in s.items() if k not in ("lat", "lon")})
            for s in snapshot["soft_story"] if near(s)]
    zones = [{"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": z["coordinates"]},
              "properties": {"id": z["id"]}} for z in snapshot["zones"]]
    return {
        "footprints": _collection(features),
        "tall_buildings": _collection(tall),
        "soft_story": _collection(soft),
        "seismic_zones": _collection(zones),
        "buildings": buildings,
        "counts": {
            "building_count": len(footprints),
            "seismic_zone_buildings": int(buildings.in_zone.sum()),
            "soft_story_open": sum(1 for s in soft if s["properties"]["open"]),
            "tall_building_count": len(tall),
        },
    }
