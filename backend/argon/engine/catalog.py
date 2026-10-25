"""Infrastructure nodes and the built-in fix catalog, ported from src/simulation.js.

All values are illustrative assumptions, not site-calibrated engineering data. Node positions
match the schematic markers in src/scene.js, converted from local meters to lat/lon.
"""

from dataclasses import dataclass, field

CATEGORIES = ("Civil", "Hardware", "Software")


@dataclass(frozen=True)
class Node:
    id: str
    name: str
    base_eq: float
    base_surge: float
    direct_cost: float  # USD millions
    direct_fatality: float
    deps: dict[str, float] = field(default_factory=dict)  # upstream node id -> cascade weight
    lat: float = 0.0
    lon: float = 0.0


@dataclass(frozen=True)
class Fix:
    id: str
    title: str
    category: str
    target_node: str
    cost_m: float
    reduction_factor: float
    impact: str = ""
    source: str = "catalog"


NODES: tuple[Node, ...] = (
    Node("seawall", "Perimeter Seawall", 0.15, 0.45, 140, 1.5, {}, 37.79865, -122.39325),
    Node("substations", "Electric Substations", 0.35, 0.40, 95, 0.4,
         {"seawall": 0.45}, 37.7946, -122.3987),
    Node("fuel_terminal", "Illustrative Fuel Handling", 0.30, 0.25, 310, 8.5,
         {"seawall": 0.35, "substations": 0.20}, 37.78848, -122.38995),
    Node("water_pump", "High-Pressure Water Pump", 0.25, 0.15, 50, 0.1,
         {"substations": 0.65, "fuel_terminal": 0.40}, 37.78956, -122.40109),
    Node("comms", "Communications Hub", 0.20, 0.10, 65, 0.1,
         {"substations": 0.55}, 37.79959, -122.39745),
    Node("bridge_approach", "Bay Bridge Approach", 0.40, 0.20, 220, 12.0,
         {"seawall": 0.25, "comms": 0.10}, 37.78772, -122.38802),
    Node("ferry_terminal", "Ferry Terminal", 0.20, 0.55, 85, 2.0,
         {"seawall": 0.50, "substations": 0.20, "comms": 0.20}, 37.7955, -122.39342),
    Node("evac_roads", "Evacuation Roads", 0.25, 0.35, 75, 18.0,
         {"seawall": 0.40, "bridge_approach": 0.45, "comms": 0.25, "fuel_terminal": 0.25},
         37.79298, -122.40166),
)

NODE_IDS = tuple(n.id for n in NODES)


def _fix(id, title, category, target, cost, reduction, impact):
    return Fix(id, title, category, target, cost, reduction, impact)


CATALOG_FIXES: tuple[Fix, ...] = (
    _fix("fix_sw_1", "Deep Soil Mixing Foundation", "Civil", "seawall", 45, 0.45,
         "Reduces liquefaction-induced seawall slumping during strong shaking."),
    _fix("fix_sw_2", "Modular Wave Recurve Wall", "Civil", "seawall", 28, 0.35,
         "Deflects coastal storm surge overtopping forces."),
    _fix("fix_sw_3", "Piezometric Real-Time Array", "Software", "seawall", 6, 0.12,
         "Early detection of pore-pressure buildup allowing targeted floodgate pre-closure."),
    _fix("fix_sub_1", "Base-Isolated Transformers", "Hardware", "substations", 32, 0.50,
         "Decouples heavy substation gear from high-frequency ground acceleration."),
    _fix("fix_sub_2", "Elevated Switchgear Platforms", "Civil", "substations", 19, 0.40,
         "Raises critical busbars 3.5m above design coastal inundation levels."),
    _fix("fix_sub_3", "Automated Microgrid Islanding", "Software", "substations", 11, 0.30,
         "Prevents cascading grid collapse and isolates faulted coastal feeders."),
    _fix("fix_fuel_1", "Flexible Pipe Bellows & Shutoffs", "Hardware", "fuel_terminal", 24, 0.48,
         "Prevents shear rupture at tank-manifold junctions during lateral spread."),
    _fix("fix_fuel_2", "Secondary Containment Berm", "Civil", "fuel_terminal", 36, 0.38,
         "Blocks Natech hydrocarbon dispersion and fire spread during surge events."),
    _fix("fix_fuel_3", "AI Slosh & Leak Suppression", "Software", "fuel_terminal", 9, 0.22,
         "Rapid foam blanket deployment triggered by seismic P-wave arrival."),
    _fix("fix_wat_1", "Diesel Backup Pump Redundancy", "Hardware", "water_pump", 14, 0.55,
         "Maintains firefighting pressure when electric substations fail."),
    _fix("fix_wat_2", "HDPE Ductile Pipe Linings", "Civil", "water_pump", 22, 0.35,
         "Accommodates ground deformation without losing hydraulic head."),
    _fix("fix_com_1", "72-Hour LiFePO4 Battery Banks", "Hardware", "comms", 12, 0.45,
         "Buffers telecom switches against prolonged substation outages."),
    _fix("fix_com_2", "Mesh Satellite Backhaul Routing", "Software", "comms", 8, 0.40,
         "Reroutes emergency telemetry when terrestrial fiber conduits shear."),
    _fix("fix_brg_1", "Lead-Rubber Viaduct Bearings", "Hardware", "bridge_approach", 52, 0.50,
         "Absorbs shear energy at approach spans, preventing unseating."),
    _fix("fix_brg_2", "Vibro-Replacement Stone Columns", "Civil", "bridge_approach", 38, 0.42,
         "Stabilizes bay mud embankment approaches against seismic settlement."),
    _fix("fix_fer_1", "High-Freeboard Floating Pontoons", "Civil", "ferry_terminal", 26, 0.45,
         "Allows emergency maritime evacuation even during extreme surge."),
    _fix("fix_fer_2", "Articulated Ramp Actuators", "Hardware", "ferry_terminal", 15, 0.30,
         "Maintains gangway structural integrity after pier displacement."),
    _fix("fix_evac_1", "Debris-Deflecting Retaining Walls", "Civil", "evac_roads", 29, 0.38,
         "Keeps lifeline corridors clear of structural collapse and mudflows."),
    _fix("fix_evac_2", "Dynamic Contraflow Traffic AI", "Software", "evac_roads", 10, 0.35,
         "Routes evacuees around inundated zones and Natech plume perimeters."),
    _fix("fix_evac_3", "Hardened Solar Beacon Network", "Hardware", "evac_roads", 13, 0.25,
         "Provides autonomous visual guidance during total power and comms blackouts."),
)
