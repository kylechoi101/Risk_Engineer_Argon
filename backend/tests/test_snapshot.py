import pytest

from argon.data.snapshot import build_snapshot, layers_for


def square(lon, lat, d=0.0002):
    return [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]


def fp(ring, height="20", ground="2.0"):
    return {"type": "Feature", "properties": {"hgt_median_m": height, "gnd_min_m": ground},
            "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]}}


A = (-122.3940, 37.7950)  # near the Ferry Building
B = (-122.3990, 37.7930)
FAR = (-122.4300, 37.7700)
RAW = {
    "footprints": {"type": "FeatureCollection", "features": [
        fp(square(*A)), fp(square(*B), height="0.25", ground="5.1"), fp(square(*FAR)),
    ]},
    "tall": [{"polygon": {"type": "Polygon", "coordinates": [square(B[0] + 0.00005, B[1] + 0.00005, 0.0001)]},
              "name": "Tower B", "height_ft": "300", "foundation_system": "Pile",
              "liquefaction_potential": "Very High"}],
    "soft_story": [{"point": {"type": "Point", "coordinates": [A[0] + 0.0001, A[1] + 0.0001]},
                    "property_address": "1 Test Pl", "tier": "3", "status": "Non-Compliant"}],
    "zones": [{"id": "z1", "the_geom": {"type": "MultiPolygon",
               "coordinates": [[square(A[0] - 0.001, A[1] - 0.001, 0.003)]]}}],
    "datums": {"datums": [{"name": "MHHW", "value": 3.602}, {"name": "MLLW", "value": 1.822},
                          {"name": "NAVD88", "value": 1.804}]},
}


@pytest.fixture(scope="module")
def snapshot():
    return build_snapshot(RAW, collected="2026-10-25")


def test_links_inventories_to_footprints(snapshot):
    a, b, _ = snapshot["footprints"]
    assert a["in_zone"] and not b["in_zone"]
    assert a["soft_story"] == "open" and b["soft_story"] is None
    assert b["tall_index"] == 0 and a["tall_index"] is None
    assert b["height_m"] == 3  # clamped like the browser scene builder


def test_datums_are_relative_to_navd88(snapshot):
    assert snapshot["datums"]["mhhw_navd88_m"] == pytest.approx(1.798)
    assert snapshot["datums"]["mllw_navd88_m"] == pytest.approx(0.018)


def test_layers_filter_by_radius(snapshot):
    layers = layers_for(snapshot, radius_m=1609)
    feats = layers["footprints"]["features"]
    assert [f["properties"]["id"] for f in feats] == [0, 1]
    assert feats[0]["geometry"]["type"] == "Polygon"
    assert layers["tall_buildings"]["features"][0]["properties"]["name"] == "Tower B"
    assert len(layers["soft_story"]["features"]) == 1
    assert len(layers["seismic_zones"]["features"]) == 1
    assert layers["buildings"].in_zone.tolist() == [True, False]
