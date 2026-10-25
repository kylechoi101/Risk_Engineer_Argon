"""Fetch the public source datasets from DataSF and NOAA. This is the only network I/O in data/."""

import json
from urllib.parse import urlencode
from urllib.request import urlopen

from argon.data.geo import ORIGIN, box_around

SOCRATA = "https://data.sf.gov/resource"
NOAA_DATUMS = (
    "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json"
    "?units=metric"
)
# Cover the largest allowed radius (1.5 mi) plus a margin for footprints straddling the edge.
SNAPSHOT_RADIUS_M = 2500


def _get(url: str, timeout: float) -> object:
    with urlopen(url, timeout=timeout) as response:
        return json.loads(response.read())


def fetch_raw(timeout: float = 90) -> dict:
    south, west, north, east = box_around(ORIGIN, SNAPSHOT_RADIUS_M)
    box = f"{north},{west},{south},{east}"

    def socrata(dataset: str, params: dict, suffix: str = "json") -> object:
        return _get(f"{SOCRATA}/{dataset}.{suffix}?{urlencode(params)}", timeout)

    footprints = socrata(
        "ynuv-fyni",
        {"$where": f"within_box(shape,{box})", "$limit": "50000",
         "$select": "shape,hgt_median_m,gnd_min_m"},
        "geojson",
    )
    tall = socrata("5kya-mfst", {
        "$where": f"within_box(polygon,{box})", "$limit": "5000",
        "$select": "polygon,name,address,height_ft,structural_system,structural_types,"
                   "foundation_system,liquefaction_potential",
    })
    # The DataSF map views (jwdp-cqyc, 7ahv-68ap) are visualizations; these are their tables.
    soft_story = socrata("beah-shgi", {
        "$where": f"within_box(point,{box})", "$limit": "5000",
        "$select": "point,property_address,tier,status",
    })
    polygon = (f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},"
               f"{west} {south}))")
    zones = socrata("re79-p8j5", {
        "$where": f"intersects(the_geom, '{polygon}')", "$limit": "100", "$select": "the_geom,id",
    })
    datums = _get(NOAA_DATUMS, timeout)
    return {"footprints": footprints, "tall": tall, "soft_story": soft_story,
            "zones": zones, "datums": datums}
