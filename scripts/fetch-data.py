"""Refresh the public DataSF source snapshots before running build-scene.py."""
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)
BOX = "37.8100,-122.4125,37.7810,-122.3749"
DATASETS = [
    ("ynuv-fyni", "shape", "buildings-source.geojson", ""),
    ("3psu-pn9h", "line", "roads-source.geojson", " AND active=true"),
]

for dataset_id, geometry_field, filename, extra in DATASETS:
    query = urlencode({"$where": f"within_box({geometry_field},{BOX}){extra}", "$limit": "5000"})
    url = f"https://data.sfgov.org/resource/{dataset_id}.geojson?{query}"
    with urlopen(url, timeout=90) as response:
        payload = response.read()
    (OUT / filename).write_bytes(payload)
    print(f"Downloaded {dataset_id}: {len(payload):,} bytes")

# The two DataSF map IDs are visualizations. Their backing tables are beah-shgi
# (soft-story points) and re79-p8j5 (seismic hazard-zone polygons).
SUPPLEMENTAL = [
    ("5kya-mfst", "polygon", "tall-buildings-source.json", "polygon,name,address,height_ft,occupancy,structural_system,structural_types,foundation_system,liquefaction_potential"),
    ("beah-shgi", "point", "soft-story-source.json", "point,property_address,tier,status"),
]
for dataset_id, geometry_field, filename, select in SUPPLEMENTAL:
    query = urlencode({"$select": select, "$where": f"within_box({geometry_field},{BOX})", "$limit": "5000"})
    with urlopen(f"https://data.sfgov.org/resource/{dataset_id}.json?{query}", timeout=90) as response:
        payload = response.read()
    (OUT / filename).write_bytes(payload)
    print(f"Downloaded {dataset_id}: {len(json.loads(payload))} records")

study_polygon = "POLYGON((-122.4125 37.7810,-122.3749 37.7810,-122.3749 37.8100,-122.4125 37.8100,-122.4125 37.7810))"
query = urlencode({"$select": "the_geom,id", "$where": f"intersects(the_geom, '{study_polygon}')", "$limit": "100"})
with urlopen(f"https://data.sfgov.org/resource/re79-p8j5.json?{query}", timeout=90) as response:
    payload = response.read()
(OUT / "seismic-zones-source.json").write_bytes(payload)
print(f"Downloaded re79-p8j5: {len(json.loads(payload))} zones")

with urlopen("https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric", timeout=30) as response:
    payload = response.read()
(OUT / "noaa-datums-source.json").write_bytes(payload)
print("Downloaded NOAA station 9414290 metric datums")
