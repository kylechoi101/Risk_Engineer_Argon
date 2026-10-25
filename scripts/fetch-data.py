"""Refresh the public DataSF source snapshots before running build-scene.py."""
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

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
