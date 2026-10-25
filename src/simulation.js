/**
 * Interactive Natech (Natural Hazard Triggering Technological Disasters) Monte Carlo Simulation Engine.
 * NOTE: Uses stylized, plausible heuristic parameters for educational/interactive demonstration.
 * Does not claim site-specific engineered predictive accuracy.
 */

export const NODES = [
  { id: 'seawall', name: 'Perimeter Seawall', baseEq: 0.15, baseSurge: 0.45, directCost: 140, directFatality: 1.5, deps: {} },
  { id: 'substations', name: 'Electric Substations', baseEq: 0.35, baseSurge: 0.40, directCost: 95, directFatality: 0.4, deps: { seawall: 0.45 } },
  { id: 'fuel_terminal', name: 'Illustrative Fuel Handling', baseEq: 0.30, baseSurge: 0.25, directCost: 310, directFatality: 8.5, deps: { seawall: 0.35, substations: 0.20 } },
  { id: 'water_pump', name: 'High-Pressure Water Pump', baseEq: 0.25, baseSurge: 0.15, directCost: 50, directFatality: 0.1, deps: { substations: 0.65, fuel_terminal: 0.40 } },
  { id: 'comms', name: 'Communications Hub', baseEq: 0.20, baseSurge: 0.10, directCost: 65, directFatality: 0.1, deps: { substations: 0.55 } },
  { id: 'bridge_approach', name: 'Bay Bridge Approach', baseEq: 0.40, baseSurge: 0.20, directCost: 220, directFatality: 12.0, deps: { seawall: 0.25, comms: 0.10 } },
  { id: 'ferry_terminal', name: 'Ferry Terminal', baseEq: 0.20, baseSurge: 0.55, directCost: 85, directFatality: 2.0, deps: { seawall: 0.50, substations: 0.20, comms: 0.20 } },
  { id: 'evac_roads', name: 'Evacuation Roads', baseEq: 0.25, baseSurge: 0.35, directCost: 75, directFatality: 18.0, deps: { seawall: 0.40, bridge_approach: 0.45, comms: 0.25, fuel_terminal: 0.25 } }
];

export const FIXES = [
  { id: 'fix_sw_1', title: 'Deep Soil Mixing Foundation', category: 'Civil', targetNode: 'seawall', costMillions: 45, reductionFactor: 0.45, impact: 'Reduces liquefaction-induced seawall slumping during strong shaking.' },
  { id: 'fix_sw_2', title: 'Modular Wave Recurve Wall', category: 'Civil', targetNode: 'seawall', costMillions: 28, reductionFactor: 0.35, impact: 'Deflects coastal storm surge overtopping forces.' },
  { id: 'fix_sw_3', title: 'Piezometric Real-Time Array', category: 'Software', targetNode: 'seawall', costMillions: 6, reductionFactor: 0.12, impact: 'Early detection of pore-pressure buildup allowing targeted floodgate pre-closure.' },
  { id: 'fix_sub_1', title: 'Base-Isolated Transformers', category: 'Hardware', targetNode: 'substations', costMillions: 32, reductionFactor: 0.50, impact: 'Decouples heavy substation gear from high-frequency ground acceleration.' },
  { id: 'fix_sub_2', title: 'Elevated Switchgear Platforms', category: 'Civil', targetNode: 'substations', costMillions: 19, reductionFactor: 0.40, impact: 'Raises critical busbars 3.5m above design coastal inundation levels.' },
  { id: 'fix_sub_3', title: 'Automated Microgrid Islanding', category: 'Software', targetNode: 'substations', costMillions: 11, reductionFactor: 0.30, impact: 'Prevents cascading grid collapse and isolates faulted coastal feeders.' },
  { id: 'fix_fuel_1', title: 'Flexible Pipe Bellows & Shutoffs', category: 'Hardware', targetNode: 'fuel_terminal', costMillions: 24, reductionFactor: 0.48, impact: 'Prevents shear rupture at tank-manifold junctions during lateral spread.' },
  { id: 'fix_fuel_2', title: 'Secondary Containment Berm', category: 'Civil', targetNode: 'fuel_terminal', costMillions: 36, reductionFactor: 0.38, impact: 'Blocks Natech hydrocarbon dispersion and fire spread during surge events.' },
  { id: 'fix_fuel_3', title: 'AI Slosh & Leak Suppression', category: 'Software', targetNode: 'fuel_terminal', costMillions: 9, reductionFactor: 0.22, impact: 'Rapid foam blanket deployment triggered by seismic P-wave arrival.' },
  { id: 'fix_wat_1', title: 'Diesel Backup Pump Redundancy', category: 'Hardware', targetNode: 'water_pump', costMillions: 14, reductionFactor: 0.55, impact: 'Maintains firefighting pressure when electric substations fail.' },
  { id: 'fix_wat_2', title: 'HDPE Ductile Pipe Linings', category: 'Civil', targetNode: 'water_pump', costMillions: 22, reductionFactor: 0.35, impact: 'Accommodates ground deformation without losing hydraulic head.' },
  { id: 'fix_com_1', title: '72-Hour LiFePO4 Battery Banks', category: 'Hardware', targetNode: 'comms', costMillions: 12, reductionFactor: 0.45, impact: 'Buffers telecom switches against prolonged substation outages.' },
  { id: 'fix_com_2', title: 'Mesh Satellite Backhaul Routing', category: 'Software', targetNode: 'comms', costMillions: 8, reductionFactor: 0.40, impact: 'Reroutes emergency telemetry when terrestrial fiber conduits shear.' },
  { id: 'fix_brg_1', title: 'Lead-Rubber Viaduct Bearings', category: 'Hardware', targetNode: 'bridge_approach', costMillions: 52, reductionFactor: 0.50, impact: 'Absorbs shear energy at approach spans, preventing unseating.' },
  { id: 'fix_brg_2', title: 'Vibro-Replacement Stone Columns', category: 'Civil', targetNode: 'bridge_approach', costMillions: 38, reductionFactor: 0.42, impact: 'Stabilizes bay mud embankment approaches against seismic settlement.' },
  { id: 'fix_fer_1', title: 'High-Freeboard Floating Pontoons', category: 'Civil', targetNode: 'ferry_terminal', costMillions: 26, reductionFactor: 0.45, impact: 'Allows emergency maritime evacuation even during extreme surge.' },
  { id: 'fix_fer_2', title: 'Articulated Ramp Actuators', category: 'Hardware', targetNode: 'ferry_terminal', costMillions: 15, reductionFactor: 0.30, impact: 'Maintains gangway structural integrity after pier displacement.' },
  { id: 'fix_evac_1', title: 'Debris-Deflecting Retaining Walls', category: 'Civil', targetNode: 'evac_roads', costMillions: 29, reductionFactor: 0.38, impact: 'Keeps lifeline corridors clear of structural collapse and mudflows.' },
  { id: 'fix_evac_2', title: 'Dynamic Contraflow Traffic AI', category: 'Software', targetNode: 'evac_roads', costMillions: 10, reductionFactor: 0.35, impact: 'Routes evacuees around inundated zones and Natech plume perimeters.' },
  { id: 'fix_evac_3', title: 'Hardened Solar Beacon Network', category: 'Hardware', targetNode: 'evac_roads', costMillions: 13, reductionFactor: 0.25, impact: 'Provides autonomous visual guidance during total power and comms blackouts.' }
];

function createPRNG(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function calcMetrics(losses, fatalities, failCounts, iterations) {
  const sorted = Float64Array.from(losses).sort();
  const n = sorted.length;
  const sumLoss = sorted.reduce((a, b) => a + b, 0);
  const sumFat = fatalities.reduce((a, b) => a + b, 0);

  const idx99 = Math.min(n - 1, Math.floor(n * 0.99));
  const var99 = sorted[idx99];

  let tailSum = 0;
  const tailCount = n - idx99;
  for (let i = idx99; i < n; i++) tailSum += sorted[i];
  const cvar99 = tailCount > 0 ? tailSum / tailCount : var99;

  const quantiles = {};
  for (const q of [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
    quantiles[`p${Math.round(q * 100)}`] = Number(sorted[Math.min(n - 1, Math.floor(n * q))].toFixed(2));
  }

  const nodeFailureProbs = {};
  NODES.forEach((node, idx) => {
    nodeFailureProbs[node.id] = Number((failCounts[idx] / iterations).toFixed(4));
  });

  const bins = 25;
  const maxVal = Math.max(sorted[n - 1], 1);
  const step = maxVal / bins;
  const histogram = Array.from({ length: bins }, (_, i) => ({
    binStart: Number((i * step).toFixed(1)),
    binEnd: Number(((i + 1) * step).toFixed(1)),
    probability: 0
  }));
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.floor(sorted[i] / step));
    histogram[b].probability += 1 / n;
  }
  histogram.forEach(h => (h.probability = Number(h.probability.toFixed(4))));

  return {
    expectedLossMillions: Number((sumLoss / n).toFixed(2)),
    expectedFatalities: Number((sumFat / n).toFixed(2)),
    var99Millions: Number(var99.toFixed(2)),
    cvar99Millions: Number(cvar99.toFixed(2)),
    quantilesMillions: quantiles,
    nodeFailureProbs,
    histogram
  };
}

export function runSimulation(options = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const mag = Math.max(5.5, Math.min(8.0, Number(options.earthquakeMagnitude ?? 7.0)));
  const surge = Math.max(0.0, Math.min(4.0, Number(options.coastalSurgeMeters ?? 1.5)));
  const iterations = Math.max(100, Math.min(50000, Math.floor(Number(options.iterations ?? 4096))));
  const seed = Number(options.seed ?? 42);
  const budgetMillions = options.budgetMillions != null ? Number(options.budgetMillions) : Infinity;
  const requestedIds = Array.isArray(options.selectedFixIds) ? options.selectedFixIds : [];
  const context = options.context || {};
  // Public map layers provide bounded exposure modifiers, not calibrated fragility curves.
  const seismicExposureScale = Math.max(.8, Math.min(1.25, Number(context.seismicExposureScale) || 1));
  const coastalExposureScale = Math.max(.75, Math.min(1.35, Number(context.coastalExposureScale) || 1));

  const fixMap = new Map(FIXES.map(f => [f.id, f]));
  const activeFixes = [];
  const skippedFixes = [];
  let spentMillions = 0;

  for (const id of requestedIds) {
    const fix = fixMap.get(id);
    if (!fix) continue;
    if (spentMillions + fix.costMillions <= budgetMillions) {
      activeFixes.push(fix);
      spentMillions += fix.costMillions;
    } else {
      skippedFixes.push(fix.id);
    }
  }

  // Non-linear hazard intensity scaling
  const eqIntensity = Math.pow(10, 0.58 * (mag - 5.5)) / Math.pow(10, 0.58 * 2.5);
  const surgeIntensity = Math.pow(surge / 4.0, 1.35);

  // Precompute mitigation modifiers per node (including cross-category synergy bonus)
  const nodeModifiers = NODES.map(node => {
    const fixes = activeFixes.filter(f => f.targetNode === node.id);
    let vulnMultiplier = 1.0;
    const cats = new Set();
    for (const f of fixes) {
      vulnMultiplier *= 1.0 - f.reductionFactor;
      cats.add(f.category);
    }
    if (cats.size >= 2) vulnMultiplier *= 0.90; // 10% synergy bonus for multi-disciplinary defense
    if (cats.size === 3) vulnMultiplier *= 0.92; // Additional 8% for full Civil+Hardware+Software triad
    const consequenceMultiplier = 1.0 - (1.0 - vulnMultiplier) * 0.35;
    return { vulnMultiplier, consequenceMultiplier };
  });

  const numNodes = NODES.length;
  const baseLosses = new Float64Array(iterations);
  const baseFatalities = new Float64Array(iterations);
  const baseFailCounts = new Int32Array(numNodes);

  const mitLosses = new Float64Array(iterations);
  const mitFatalities = new Float64Array(iterations);
  const mitFailCounts = new Int32Array(numNodes);

  const prng = createPRNG(seed);
  const baseFailed = new Uint8Array(numNodes);
  const mitFailed = new Uint8Array(numNodes);

  for (let iter = 0; iter < iterations; iter++) {
    // Shared common random numbers (CRN) for variance reduction across baseline and mitigated runs
    const eqCommon = 0.8 + 0.4 * prng();
    const surgeCommon = 0.85 + 0.3 * prng();

    let bLoss = 0, bFat = 0, mLoss = 0, mFat = 0;

    for (let i = 0; i < numNodes; i++) {
      const node = NODES[i];
      const mod = nodeModifiers[i];

      // Shared uniform draws per node
      const uFail = prng();
      const uSev = 0.6 + 0.8 * prng(); // Severity multiplier [0.6, 1.4]

      const rawHazard =
        1.0 -
        (1.0 - Math.min(0.95, node.baseEq * eqIntensity * eqCommon * seismicExposureScale)) *
          (1.0 - Math.min(0.95, node.baseSurge * surgeIntensity * surgeCommon * coastalExposureScale));

      // Cascading dependency penalties
      let bCascade = 0;
      let mCascade = 0;
      for (let j = 0; j < i; j++) {
        const depWeight = node.deps[NODES[j].id];
        if (depWeight) {
          if (baseFailed[j]) bCascade += depWeight;
          if (mitFailed[j]) mCascade += depWeight * (0.65 + 0.35 * mod.vulnMultiplier);
        }
      }

      const bProb = Math.min(0.99, 1.0 - (1.0 - rawHazard) * Math.exp(-bCascade));
      const mProb = Math.min(0.99, 1.0 - (1.0 - rawHazard * mod.vulnMultiplier) * Math.exp(-mCascade));

      const bFail = uFail < bProb ? 1 : 0;
      const mFail = uFail < mProb ? 1 : 0;
      baseFailed[i] = bFail;
      mitFailed[i] = mFail;

      if (bFail) {
        baseFailCounts[i]++;
        bLoss += node.directCost * uSev;
        bFat += node.directFatality * uSev;
      }
      if (mFail) {
        mitFailCounts[i]++;
        mLoss += node.directCost * uSev * mod.consequenceMultiplier;
        mFat += node.directFatality * uSev * mod.consequenceMultiplier;
      }
    }

    // Compounding Natech systemic cascades (e.g., Fuel fire + Water pump failure + Evac road blockage)
    const uNatech = 0.75 + 0.5 * prng();
    if (baseFailed[2] && baseFailed[3]) {
      bLoss += 165 * uNatech; // Uncontrolled terminal fire escalation
      bFat += (baseFailed[7] ? 28 : 9) * uNatech; // Trapped evacuees amplification
    }
    if (mitFailed[2] && mitFailed[3]) {
      const natechMod = (nodeModifiers[2].consequenceMultiplier + nodeModifiers[7].consequenceMultiplier) * 0.5;
      mLoss += 165 * uNatech * natechMod;
      mFat += (mitFailed[7] ? 28 : 9) * uNatech * natechMod;
    }

    baseLosses[iter] = bLoss;
    baseFatalities[iter] = bFat;
    mitLosses[iter] = mLoss;
    mitFatalities[iter] = mFat;
  }

  const baseline = calcMetrics(baseLosses, baseFatalities, baseFailCounts, iterations);
  const mitigated = calcMetrics(mitLosses, mitFatalities, mitFailCounts, iterations);

  const lossDiff = baseline.expectedLossMillions - mitigated.expectedLossMillions;
  const fatDiff = baseline.expectedFatalities - mitigated.expectedFatalities;
  const varDiff = baseline.var99Millions - mitigated.var99Millions;

  const runtimeMs = Number(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(2));

  return {
    config: {
      earthquakeMagnitude: mag,
      coastalSurgeMeters: surge,
      iterations,
      seed,
      budgetMillions: budgetMillions === Infinity ? null : budgetMillions,
      spentMillions: Number(spentMillions.toFixed(2)),
      appliedFixIds: activeFixes.map(f => f.id),
      skippedFixIdsDueToBudget: skippedFixes,
      runtimeMs,
      seismicExposureScale,
      coastalExposureScale
    },
    baseline,
    mitigated,
    overallReduction: {
      expectedLossSavedMillions: Number(lossDiff.toFixed(2)),
      expectedLossReductionPct: baseline.expectedLossMillions > 0 ? Number(((lossDiff / baseline.expectedLossMillions) * 100).toFixed(2)) : 0,
      expectedFatalitiesSaved: Number(fatDiff.toFixed(2)),
      expectedFatalitiesReductionPct: baseline.expectedFatalities > 0 ? Number(((fatDiff / baseline.expectedFatalities) * 100).toFixed(2)) : 0,
      var99ReductionMillions: Number(varDiff.toFixed(2)),
      cvar99ReductionMillions: Number((baseline.cvar99Millions - mitigated.cvar99Millions).toFixed(2)),
      netBenefitMillions: Number((lossDiff - spentMillions).toFixed(2)),
      benefitCostRatio: spentMillions > 0 ? Number((lossDiff / spentMillions).toFixed(2)) : null
    }
  };
}

