# Argon Risk — SF Waterfront Simulator

Interactive concept demo for compound earthquake and coastal flooding risk near the San Francisco Ferry Building. The app is a static Vite site. Its simulation runs entirely in the browser and requires no API key at runtime.

## Run

```bash
npm install
npm run dev
```

Run `npm run check` for the deterministic simulation and data checks, then `npm run build` for a production bundle.

## Data and scene

The scene contains 3,759 building footprints with LiDAR-derived median heights from [DataSF Building Footprints](https://data.sf.gov/d/ynuv-fyni) and 1,101 active segments from [DataSF Streets – Active and Retired](https://data.sf.gov/d/3psu-pn9h), collected October 25, 2026. The source query selects a rectangle around the Ferry Building and the build script retains footprints within roughly one mile. `public/data/scene.json` contains projected, simplified local coordinates. The San Francisco coastline, Ferry Building tower, Bay Bridge span, and infrastructure failure node markers are schematic visual aids. No private facility data is included.

To refresh the public data snapshot:

```bash
python3 scripts/fetch-data.py
python3 scripts/build-scene.py
```

## Model

The browser engine evaluates 4,096 deterministic Monte Carlo draws. It combines earthquake magnitude and a 0–4 m coastal water-level proxy with a dependency graph of eight illustrative infrastructure nodes. A failed upstream node raises downstream failure probability. The baseline and selected-retrofit cases use the same random draws, which makes changes stable as the user toggles fixes. Outputs include modeled expected loss, expected fatalities, 99th percentile loss (VaR₀.₉₉), and mean loss in the highest 1% tail (CVaR₀.₉₉). The 20 intervention cards show standalone scenario benefit, CapEx, and a benefit-to-cost multiple. The budget button uses a greedy benefit-to-cost selection heuristic.

All asset identities except the Ferry Building/Bay Bridge context, node locations, dependency weights, fragility curves, losses, casualty factors, and intervention costs/effects are **illustrative assumptions**. The tsunami preset uses water-level run-up as a proxy; it does not model wave propagation or arrival time. The model has not been calibrated to site-specific records and must not be used for engineering or emergency decisions. Hazard context is informed by [USGS liquefaction guidance](https://www.usgs.gov/programs/earthquake-hazards/science/san-francisco-bay-area-liquefaction-hazard-maps) and the [Port of San Francisco seismic and flood overview](https://www.sfport.com/wrp/seismic-flood-101).

## Gemini usage

The locally configured `gemini` CLI with `gemini-4-argon` was used to generate the initial Monte Carlo cascade module and propose the geodata-based Three.js/WebGPU scene design. The scene was adapted and verified against the actual DataSF coordinate system and browser rendering. Prompt text is retained in `gemini-simulation-prompt.txt` and `gemini-render-prompt.txt`. No Gemini credentials are included in the site or sent to visitors.
