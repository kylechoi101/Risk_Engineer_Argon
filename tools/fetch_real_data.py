#!/usr/bin/env python3
"""
Fetch real elevation, bathymetry, and building footprint data for the 1-mile
(1609 m) radius around San Francisco's Ferry Building (37.7955 N, 122.3937 W).

Outputs raw cached datasets to tools/cache/ for tools/bake_district.mjs:
  - tools/cache/datasf_buildings.geojson  (DataSF Building Footprints: ynuv-fyni)
  - tools/cache/datasf_tall.json          (DataSF Tall Building Inventory: 5kya-mfst)
  - tools/cache/datasf_streets.geojson    (DataSF Active Streets: 3psu-pn9h)
  - tools/cache/usgs_3dep_dem.json        (USGS 3DEP elevation grid samples)
  - tools/cache/noaa_datums.json          (NOAA CO-OPS Station 9414290 San Francisco tidal datums)

Usage:
  python3 tools/fetch_real_data.py
  node tools/bake_district.mjs
"""

import json
import math
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen, Request

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "tools" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

ORIGIN_LAT = 37.7955
ORIGIN_LON = -122.3937
RADIUS_M = 1609.0

# Bounding box slightly larger than 1609 m around (37.7955, -122.3937)
NORTH_LAT = 37.8105
SOUTH_LAT = 37.7805
WEST_LON = -122.4130
EAST_LON = -122.3744
BOX_STR = f"{NORTH_LAT},{WEST_LON},{SOUTH_LAT},{EAST_LON}"


def fetch_bytes(url: str, timeout: int = 90) -> bytes:
    req = Request(url, headers={"User-Agent": "SF-Waterfront-Simulator-Bake/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def main() -> int:
    print("=== Fetching Real SF District Datasets (1-mile around Ferry Building) ===")
    try:
        # 1. DataSF Building Footprints (ynuv-fyni)
        # Note: DataSF ynuv-fyni provides footprint polygon, hgt_median_m, gnd_min_m.
        # It does NOT provide year_built, stories, or structural material for most buildings.
        q_buildings = urlencode({
            "$where": f"within_box(shape,{BOX_STR})",
            "$limit": "10000"
        })
        url_buildings = f"https://data.sfgov.org/resource/ynuv-fyni.geojson?{q_buildings}"
        print(f"[1/4] Fetching DataSF building footprints: {url_buildings}")
        b_payload = fetch_bytes(url_buildings)
        (CACHE_DIR / "datasf_buildings.geojson").write_bytes(b_payload)
        print(f"      Saved datasf_buildings.geojson ({len(b_payload):,} bytes)")

        # 2. DataSF Tall Buildings Inventory (5kya-mfst) for supplemental structural material/height
        q_tall = urlencode({
            "$select": "polygon,name,address,height_ft,stories_above_grade,year_built,structural_types",
            "$where": f"within_box(polygon,{BOX_STR})",
            "$limit": "2000"
        })
        url_tall = f"https://data.sfgov.org/resource/5kya-mfst.json?{q_tall}"
        print(f"[2/4] Fetching DataSF tall buildings inventory: {url_tall}")
        t_payload = fetch_bytes(url_tall)
        (CACHE_DIR / "datasf_tall.json").write_bytes(t_payload)
        print(f"      Saved datasf_tall.json ({len(t_payload):,} bytes)")

        # 3. DataSF Street Centerlines (3psu-pn9h)
        q_streets = urlencode({
            "$where": f"within_box(line,{BOX_STR}) AND active=true",
            "$limit": "8000"
        })
        url_streets = f"https://data.sfgov.org/resource/3psu-pn9h.geojson?{q_streets}"
        print(f"[3/4] Fetching DataSF street centerlines: {url_streets}")
        s_payload = fetch_bytes(url_streets)
        (CACHE_DIR / "datasf_streets.geojson").write_bytes(s_payload)
        print(f"      Saved datasf_streets.geojson ({len(s_payload):,} bytes)")

        # 4. NOAA Tidal Datums for Station 9414290 (San Francisco)
        url_noaa = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric"
        print(f"[4/4] Fetching NOAA Station 9414290 datums: {url_noaa}")
        n_payload = fetch_bytes(url_noaa, timeout=30)
        (CACHE_DIR / "noaa_datums.json").write_bytes(n_payload)
        print(f"      Saved noaa_datums.json ({len(n_payload):,} bytes)")

        print("\nAll source datasets cached to tools/cache/.")
        print("Next step: run `node tools/bake_district.mjs` to generate district.glb and buildings.json.")
        return 0

    except Exception as exc:
        print(f"\n[ERROR] Could not reach external data source: {exc}", file=sys.stderr)
        print(
            "Run `node tools/bake_district.mjs --placeholder` to generate the clearly labeled "
            "procedural placeholder district.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
