# Argon Risk — SF Waterfront Simulator

Interactive concept demo for compound earthquake and coastal flooding risk near the San Francisco Ferry Building. The frontend is a Vite site. The Python backend in `backend/` runs the Monte Carlo model, streams the analysis over SSE, and bakes the contract data files into `public/data/`.

## Start the demo

You need Node 20+, Python 3.12+ and [`uv`](https://docs.astral.sh/uv/).

**1. Set the API key (optional).** Copy the template and put your Gemini key in it:

```bash
cp backend/.env.example backend/.env
# then edit backend/.env:  GEMINI_API_KEY=your-key
```

`backend/.env` is gitignored, so never commit the key. Without a key, the demo still runs fully offline: it replays recordings from `backend/recordings/`, or falls back to the built-in fixes and a template narrative. To record live Gemini replies for an offline demo, also set `ARGON_RECORD=1` and run the demo scenario once.

**2. Start the backend** (terminal 1):

```bash
cd backend
uv sync
uv run fastapi dev        # http://localhost:8000 (API docs at /docs)
```

**3. Bake the demo data** (once, or after changing the scenario):

```bash
cd backend
uv run python scripts/bake_contract.py    # writes public/data/*.json and checks the invariants
```

**4. Start the frontend** (terminal 2, repo root):

```bash
npm install
npm run dev               # http://127.0.0.1:5173
```

To check the backend is live: `curl localhost:8000/api/health`. To watch a streamed run:

```bash
curl -N -X POST localhost:8000/api/runs -H 'content-type: application/json' \
  -d '{"radius_mi": 1.0, "scenario": {"magnitude": 7.2, "king_tide_ft": 7.0}}'
```

Tests: `cd backend && uv run pytest`, and `npm run check` for the browser data checks. API contracts: [`docs/api.md`](docs/api.md) (live stream) and [`docs/contract-v1.1.md`](docs/contract-v1.1.md) (baked files).

## Cinematic video

The [Ferry Building tsunami video](public/videos/hackathon-window-to-tsunami-extended.mp4) is a fictional, AI-generated 13.8-second clip made with Gemini Omni Flash. It starts in the hackathon room, moves toward the Bay Bridge, turns toward the Ferry Building, and follows the wave moving from the bay onto shore. The clip is a visual concept, not a physical hazard simulation.

## Data and scene

The scene contains 3,759 building footprints with LiDAR-derived median heights from [DataSF Building Footprints](https://data.sf.gov/d/ynuv-fyni) and 1,101 active segments from [DataSF Streets – Active and Retired](https://data.sf.gov/d/3psu-pn9h), collected October 25, 2026. The source query selects a rectangle around the Ferry Building and the build script retains footprints within roughly one mile. `public/data/scene.json` contains projected, simplified local coordinates. The San Francisco coastline, Ferry Building tower, Bay Bridge span, and infrastructure failure node markers are schematic visual aids. No private facility data is included.

The scene also includes 145 records from [DataSF Tall Building Inventory](https://data.sf.gov/d/5kya-mfst), 200 mapped properties from the [DataSF Soft-Story source table](https://data.sf.gov/d/beah-shgi) (the [map view](https://data.sf.gov/d/jwdp-cqyc) is a visualization, not a data table), and seven intersecting polygons from [DataSF Seismic Hazard Zones](https://data.sf.gov/d/re79-p8j5) (the [map view](https://data.sf.gov/d/7ahv-68ap) is also a visualization). Of the mapped soft-story properties within the one-mile circle, 13 were **not** marked "Work Complete" in the public snapshot. The seismic polygons overlap the centers of 1,155 scene building footprints. The zone layer does not provide per-polygon liquefaction probability, so overlap means mapped seismic hazard only.

The [NOAA tide datum metadata for station 9414290](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric) gives MHHW = 3.602 m and NAVD88 = 1.804 m relative to station datum, so MHHW = **1.798 m NAVD88**. The water slider adds a scenario increment to MHHW; the app counts building footprints whose DataSF `gnd_min_m` is at or below that elevation. This is a low-ground screening count, not a flood prediction: it has no hydraulic connectivity, seawall crest elevations, time history, wave dynamics, or bathymetry.

The map uses procedural canvas textures for land, moving bay water, and building facades. The replayable 10-second event sequence shows seismic rings and camera shake, an advancing coastal flood sheet, and probability-weighted failure beacons. These effects are illustrative visualizations; they are not a physical earthquake, hydrodynamic, or structural response solver.

To refresh the public data snapshot:

```bash
python3 scripts/fetch-data.py
python3 scripts/build-scene.py
```

## Model

The browser engine evaluates 4,096 deterministic Monte Carlo draws. It combines earthquake magnitude and a 0–4 m coastal water-level proxy with a dependency graph of eight illustrative infrastructure nodes. A failed upstream node raises downstream failure probability. The baseline and selected-retrofit cases use the same random draws, which makes changes stable as the user toggles fixes. Outputs include modeled expected loss, expected fatalities, 99th percentile loss (VaR₀.₉₉), and mean loss in the highest 1% tail (CVaR₀.₉₉). The 20 intervention cards show standalone scenario benefit, CapEx, and a benefit-to-cost multiple. The budget button uses a greedy benefit-to-cost selection heuristic.

The public data now enter the browser model through two **bounded heuristic exposure multipliers**. Seismic intensity is adjusted from the share of building centers in the seismic zone, tall-building inventory count, and soft-story properties not marked complete. Coastal intensity is adjusted from the low-ground building count at the selected water level. The formulas are in `src/app.js`, with caps in `src/simulation.js`; they are not site-calibrated fragility functions or loss estimates.

All asset identities except the Ferry Building/Bay Bridge context, node locations, dependency weights, fragility curves, losses, casualty factors, and intervention costs/effects are **illustrative assumptions**. The tsunami preset uses water-level run-up as a proxy; it does not model wave propagation or arrival time. The model has not been calibrated to site-specific records and must not be used for engineering or emergency decisions. Hazard context is informed by [USGS liquefaction guidance](https://www.usgs.gov/programs/earthquake-hazards/science/san-francisco-bay-area-liquefaction-hazard-maps) and the [Port of San Francisco seismic and flood overview](https://www.sfport.com/wrp/seismic-flood-101).

The requested 3DEP/CUDEM terrain and bathymetry, USGS ShakeMap scenario grids, Assessor values, FEMA NSI, seawall engineering reports, utility topology, and hazmat inventories are not connected. The current DataSF footprint elevations provide a simpler ground-level input. There is no validated facility-level forecast of casualties or damage.

## Gemini usage

The locally configured `gemini` CLI with `gemini-4-argon` was used to generate the initial Monte Carlo cascade module, propose the geodata-based Three.js/WebGPU scene design, and create the procedural texture and animation module. The scene was adapted and verified against the actual DataSF coordinate system and browser rendering. Prompt text is retained in `gemini-simulation-prompt.txt`, `gemini-render-prompt.txt`, and `gemini-effects-prompt.txt`. No Gemini credentials are included in the site or sent to visitors.
