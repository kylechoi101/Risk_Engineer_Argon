// Regenerate tests/fixtures/js_golden.json: node scripts/js_golden.mjs > tests/fixtures/js_golden.json
import { FIXES, runSimulation } from '../../src/simulation.js';
// PRNG stream: mirror createPRNG (not exported) for direct parity checks.
function createPRNG(seed){let a=seed>>>0;return function(){let t=(a+=0x6d2b79f5);t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const p = createPRNG(42); const prng42 = Array.from({length: 8}, () => p());
const all = FIXES.map(f => f.id);
const cases = [
  { name: 'baseline_7_2', options: { earthquakeMagnitude: 7.2, coastalSurgeMeters: 2.2, seed: 42, iterations: 4096 } },
  { name: 'all_fixes', options: { earthquakeMagnitude: 7.2, coastalSurgeMeters: 2.2, seed: 42, iterations: 4096, selectedFixIds: all } },
  { name: 'budget_50', options: { earthquakeMagnitude: 7.2, coastalSurgeMeters: 2.2, seed: 42, iterations: 4096, selectedFixIds: all, budgetMillions: 50 } },
  { name: 'mixed_exposure', options: { earthquakeMagnitude: 6.4, coastalSurgeMeters: 0.35, seed: 7, iterations: 2000,
      selectedFixIds: ['fix_sw_1', 'fix_sub_1', 'fix_sub_3', 'fix_fuel_2', 'fix_evac_2'],
      context: { seismicExposureScale: 1.12, coastalExposureScale: 0.93 } } },
];
const out = { prng_seed42_first8: prng42, cases: cases.map(c => { const r = runSimulation(c.options); delete r.config.runtimeMs; return { ...c, result: r }; }) };
console.log(JSON.stringify(out));
