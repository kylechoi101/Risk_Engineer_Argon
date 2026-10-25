# San Francisco Waterfront Disaster Simulator (1-Mile District)

Frontend player for the San Francisco Waterfront 1-mile radius earthquake + tsunami/extreme wave surge simulator, centered on the **San Francisco Ferry Building** (`37.7955° N, 122.3937° W`).

---

## 1. Quick Start (Run Instructions)

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (default: `http://localhost:5173`).

### Phase 1 Keyboard Shortcuts & Controls
- **`P`** (or click **Play Simulation**): Runs the **20-second GPU Damage-Shader Proof** across all 2,439 buildings in a single draw call (ground shake, height-dependent building sway, damage color ramp `0..4`, tilt/sink on state 3, vertical squash-and-sink + instanced dust puffs on state 4, and an advancing Bay wave surge with blue-teal flood tint).
- **`D`** (or click **Debug (D)**): Toggles the Debug Overlay showing live **FPS**, **Draw Calls**, **Triangle Count**, **Building Count**, **3D Axes Helper** at the Ferry Building origin `(0, 0, 0)`, and a **Wireframe Toggle**.
- **`R`** (or click **Reset**): Resets the simulation clock and restores all buildings to undamaged state `0`.
- **Camera Mode button** (top-right of 3D panel): Switches between **Idle Drift** (slow high-oblique panorama over the 1-mile district) and **Free Orbit** (mouse drag to orbit, scroll to zoom, right-drag to pan).
- **Hover any building in 3D**: Displays a floating tooltip with `Building #<id>`, landmark name (if applicable), current damage state `0..4`, height, ground elevation, and footprint area.

---

## 2. Coordinate System (Single Shared Frame)

Defined in [`src/config/coordinates.ts`](src/config/coordinates.ts):
- **Origin `(0, 0, 0)`**: San Francisco Ferry Building (`37.7955° N, -122.3937° W`), sea level = `0 m`.
- **Radius**: `1 mile = 1609 meters`.
- **Local East-North-Up (ENU) -> Three.js Mapping** (`1 unit = 1 meter`):
  - `+X` = **East** (meters)
  - `+Y` = **Up** (elevation in meters above sea level)
  - `-Z` = **North** (so `+Z` = South)

All modules (terrain, merged buildings mesh, Embarcadero waterfront/piers, Bay Bridge western span, water surface shader, camera rig, and inundation grid lookup) use this single coordinate system.

---

## 3. District Bake Pipeline & Data Sources

Scripts live in [`/tools`](tools/):
1. [`tools/fetch_real_data.py`](tools/fetch_real_data.py): Fetches public geospatial datasets for the 1-mile bounding box around the Ferry Building and caches them in `tools/cache/`:
   - **DataSF Building Footprints** (`https://data.sfgov.org/resource/ynuv-fyni.geojson`): Building footprint polygons, `hgt_median_m` (height), and `gnd_min_m` (ground elevation).
   - **DataSF Tall Building Inventory** (`https://data.sfgov.org/resource/5kya-mfst.json`): Supplemental height/structural metadata for downtown towers.
   - **DataSF Street Centerlines** (`https://data.sfgov.org/resource/3psu-pn9h.geojson`): Active street network.
   - **NOAA CO-OPS Tidal Datums** (`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric`): Station 9414290 (San Francisco) MHHW/NAVD88 datum.
2. [`tools/bake_district.mjs`](tools/bake_district.mjs): Compiles the 3D district into `/public/models/district.glb` and `/public/data/buildings.json`.

### Regenerating the District
- **Offline / Procedural Placeholder Mode** (currently active in `/public/models/district.glb` and `/public/data/buildings.json`):
  ```bash
  npm run bake:placeholder
  ```
- **Real DataSF Footprints Mode** (run locally on a machine with internet access to `data.sfgov.org`):
  ```bash
  npm run bake:real
  ```

---

## 4. Schema Locations & Swapping in Real Backend Files

TypeScript interfaces for the backend data contract are defined in [`src/types/dataContract.ts`](src/types/dataContract.ts) and validated in [`src/utils/validators.ts`](src/utils/validators.ts):

| File Path | Schema Type | Validator Function | Purpose |
| :--- | :--- | :--- | :--- |
| `/public/data/buildings.json` | `BuildingsMetadataSchema` | `validateBuildingsMetadata()` | Per-building `id`, `centroid` (ENU m), `footprint_area_m2`, `height_m`, `ground_elevation_m`, and `data_quality` |
| `/public/data/scenario.json` | `ScenarioSchema` | `validateScenario()` | Preset earthquake magnitude, duration, shake envelope, and base64 Float32 wave inundation grids (`arrival_s`, `peak_depth_m`, `recede_s`) |
| `/public/data/buildings_damage.json` | `BuildingsDamageSchema` | `validateDamageAndSummary()` | Parallel arrays indexed by `building_ids[i]`: `archetype_idx`, `zone_idx`, `onset_s`, `dominant_mode`, and `outcomes[fixBitmask]` |
| `/public/data/summary.json` | `SummarySchema` | `validateDamageAndSummary()` | District `zones`, `archetypes`, `fixes` (with bit positions), `by_combo` loss/collapse summaries, `weak_point_groups`, and `hotspots` |
| `/public/data/pipeline_events.json` | `PipelineEventsSchema` | `validatePipelineEvents()` | Recorded Argon multi-agent event stream replayed by `RecordedPipelineAdapter` (or swapped via `PipelineEventAdapter` for live SSE) |

To swap in the real backend files from the Argon backend team, drop `scenario.json`, `buildings_damage.json`, `summary.json`, and `pipeline_events.json` directly into `/public/data/`.
