import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXES, NODES, runSimulation } from '../src/simulation.js';

const scene = JSON.parse(readFileSync(new URL('../public/data/scene.json', import.meta.url)));
assert.ok(scene.buildings.length > 3000, 'DataSF building geometry should cover the study area');
assert.ok(scene.roads.length > 800, 'DataSF streets should cover the study area');
assert.equal(FIXES.length, 20);
assert.equal(new Set(FIXES.map(f => f.id)).size, 20);
assert.equal(NODES.length, 8);

const options = { earthquakeMagnitude: 7.2, coastalSurgeMeters: 2.2, seed: 42, iterations: 4096 };
const first = runSimulation(options);
const second = runSimulation(options);
assert.deepEqual(first.baseline, second.baseline, 'same seed should reproduce the baseline');
const protectedRun = runSimulation({ ...options, selectedFixIds: FIXES.map(f => f.id) });
assert.ok(protectedRun.mitigated.var99Millions < first.baseline.var99Millions, 'full portfolio should reduce VaR');
assert.ok(protectedRun.mitigated.cvar99Millions < first.baseline.cvar99Millions, 'full portfolio should reduce CVaR');
assert.ok(protectedRun.mitigated.expectedFatalities < first.baseline.expectedFatalities, 'full portfolio should reduce modeled casualties');
assert.ok(protectedRun.config.runtimeMs < 2000, 'portfolio run should stay under two seconds');
const budgeted = runSimulation({ ...options, selectedFixIds: FIXES.map(f => f.id), budgetMillions: 50 });
assert.ok(budgeted.config.spentMillions <= 50, 'budget ceiling should hold');
console.log(`Verified ${scene.buildings.length} footprints, ${scene.roads.length} streets, 20 fixes; full portfolio run ${protectedRun.config.runtimeMs} ms.`);
