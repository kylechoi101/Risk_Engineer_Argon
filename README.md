# Argon-Risk: San Francisco Waterfront Disaster Simulator

An interactive 3D digital twin of the 1-mile district around the San Francisco Ferry Building (`37.7955° N, 122.3937° W`) for stress-testing a compound earthquake and wave scenario. A Python backend runs seeded Monte Carlo models for building damage and a natech infrastructure cascade (seawall → substations → fuel terminal → pumps …), computes VaR₀.₉₉ and CVaR₀.₉₉, and uses Gemini (`gemini-4-argon`) to propose and explain fixes. The React + three.js frontend plays the scenario across 3,412 real DataSF buildings. When you toggle a fix, the mitigated outcome appears instantly.

The models are a stylized demonstration grounded in public government data. They are not a forecast or an engineering assessment.

## Run the demo

You need Node 20+, Python 3.12+ and [`uv`](https://docs.astral.sh/uv/).

```bash
npm install
(cd backend && uv sync)
npm run demo              # builds the frontend, then serves it + data + API at http://localhost:8000
```

The committed `public/` folder already holds a baked district and baked damage files, so the demo runs offline with no API key.

### Gemini API key (optional)

The key goes in `backend/.env`, which is gitignored. Never commit it.

```bash
cp backend/.env.example backend/.env
# edit backend/.env and set:  GEMINI_API_KEY=your-key
```

| Setting in `backend/.env` | Effect |
|---|---|
| `GEMINI_API_KEY=…` | The live `/api/runs` analysis calls Gemini to parse the prompt, propose fixes and write the narrative. |
| `ARGON_RECORD=1` | Saves every live Gemini reply to `backend/recordings/` for offline replay. |
| `ARGON_AGENT=recorded` | Forces replay of recordings, even when a key is set. This is a safe setting for a live demo. |

Without a key, the backend replays `backend/recordings/` or falls back to 20 built-in fixes. The full list of settings is in [`docs/api.md`](docs/api.md#configuration).

### Development servers

```bash
cd backend && uv run fastapi dev     # API on http://localhost:8000 (docs at /docs)
npm run dev                          # frontend on http://localhost:5173; Vite proxies /api to :8000
```

## Using the app

- **Play Simulation** (or `P`): plays the baked scenario on a 20 s timeline. The M7.0 shaking comes first, then the wave advances from the bay. Each building reaches its modeled damage state (0 none … 4 collapse) at its onset time.
- **Cost Estimation + Suggested Weak Points** (right):
  - Weak-point groups ranked by priority or cost, each with its fix, cost range, source link, and estimated loss.
  - Infrastructure fixes for the cascade network.
  - Checking a fix swaps every building to its mitigated state immediately. The p10–p90 loss range, VaR₀.₉₉ / CVaR₀.₉₉ and the p50 collapse count update with it.
- **Typical / 1-in-100**: switches between the P50 realization and the realization nearest CVaR₀.₉₉.
- **Architectural View**: replays the recorded backend run (`pipeline_events.json`) for its five stages, using the real messages and timings.
- **Hover a building**: shows its id, damage state, mode (shaking or flood), height, ground elevation and footprint area.
- **`D`**: debug overlay (FPS, draw calls, triangles, axes, wireframe). **`R`**: reset. The **camera button** switches between idle drift and free orbit.

If the damage files are missing or fail validation, the page falls back to the Phase 1 procedural shader proof and logs the reason in the console.

## Data pipeline

```bash
npm run bake:real      # DataSF footprints + tall buildings + streets + NOAA datums -> public/models/district.glb, public/data/buildings.json
npm run bake:damage    # backend Monte Carlo -> public/data/{scenario,buildings_damage,summary,pipeline_events}.json
```

Run `bake:damage` after every `bake:real`. The damage files are keyed to the building ids in `buildings.json`, and the frontend refuses mismatched ids. `npm run bake:placeholder` builds an offline procedural district instead.

| File | Written by | Contents |
|---|---|---|
| `public/models/district.glb` | `tools/bake_district.mjs` | Merged building mesh, terrain, piers, Bay Bridge span |
| `public/data/buildings.json` | `tools/bake_district.mjs` | Per-building `id`, `centroid` (ENU m), area, height, ground elevation, data quality |
| `public/data/scenario.json` | backend bake | Earthquake envelope and the wave inundation grid (base64 float32 arrival / peak depth / recede) |
| `public/data/buildings_damage.json` | backend bake | Per-building archetype, zone, onset, dominant mode, and damage state + cost for every combination of the 5 fixes (typical and 1-in-100) |
| `public/data/summary.json` | backend bake | Zones, archetypes, fixes, per-combination losses, collapse counts and VaR/CVaR, weak-point groups, hotspots, the infrastructure network and cascade traces |
| `public/data/pipeline_events.json` | backend bake | Timed log of the bake run's five stages |

Schemas:
- [`docs/contract-v1.1.md`](docs/contract-v1.1.md): the baked files. These are contract v1 plus additive fields.
- [`src/types/dataContract.ts`](src/types/dataContract.ts) and [`src/utils/validators.ts`](src/utils/validators.ts): the frontend's types and load-time checks.
- [`docs/api.md`](docs/api.md): the live streaming API.

## Live API

The backend also serves the analysis live, which is useful for trying other scenarios or recording Gemini replies:

```bash
curl -N -X POST localhost:8000/api/runs -H 'content-type: application/json' \
  -d '{"radius_mi": 1.0, "prompt": "Simulate a Magnitude 7.2 earthquake during a king tide"}'
```

It streams SSE events: run → data layers → baseline VaR/CVaR → Gemini fixes and narrative → ranked fixes → recommended bundle. `POST /api/simulate` re-runs a saved run with any fix selection in milliseconds. The frontend currently plays the baked files and does not call this API yet.

## Coordinate system

Defined in [`src/config/coordinates.ts`](src/config/coordinates.ts):
- The origin `(0, 0, 0)` is the Ferry Building at sea level. The study radius is 1 mile (1,609 m).
- Local East-North-Up meters map to three.js as `+X` East, `+Y` Up and `-Z` North. 1 unit = 1 m.
- The backend uses the same ENU frame and projection constants.

## Tests

```bash
npm test                     # Vitest: contract payload mapping
npx tsc -b                   # frontend type check
cd backend && uv run pytest  # backend: engine parity, models, contract invariants, API, pipeline
```

## Limitations

- Fragility curves, ground motion, replacement costs, fix costs and fix effects are illustrative assumptions. Building era and material are missing from the public data, so building archetypes are inferred.
- The wave grid is a screening heuristic: ground elevation interpolated from footprint data, a decaying water level flood-filled from the bay, and an assumed run-up speed. It does not use a hydrodynamic model, and it does not yet use the CGS Tsunami Hazard Area polygon, whose service requires a token.
- The water visual always shows the unmitigated wave. Flood fixes lower building damage, not the drawn water.
