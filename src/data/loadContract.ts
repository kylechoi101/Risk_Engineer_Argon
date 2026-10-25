/**
 * Fetch and validate the backend contract files from /public/data.
 * Throws with every validation error when a file does not match the contract.
 */
import type { BuildingsMetadataSchema, ContractBundle } from '../types/dataContract';
import { validateDamageAndSummary, validatePipelineEvents, validateScenario } from '../utils/validators';

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function loadContract(meta: BuildingsMetadataSchema): Promise<ContractBundle> {
  const [scenarioRaw, damageRaw, summaryRaw, pipelineRaw] = await Promise.all([
    getJson('/data/scenario.json'),
    getJson('/data/buildings_damage.json'),
    getJson('/data/summary.json'),
    getJson('/data/pipeline_events.json'),
  ]);
  const scenario = validateScenario(scenarioRaw);
  const damageAndSummary = validateDamageAndSummary(damageRaw, summaryRaw);
  const pipeline = validatePipelineEvents(pipelineRaw);
  const errors = [...scenario.errors, ...damageAndSummary.errors, ...pipeline.errors];
  // Invariant 1: damage rows are keyed to exactly the ids in buildings.json.
  const ids = damageAndSummary.data?.damage.building_ids ?? [];
  if (ids.length !== meta.buildings.length || ids.some((id, i) => id !== meta.buildings[i].id)) {
    errors.push('buildings_damage.json building_ids do not match buildings.json; re-run npm run bake:damage');
  }
  if (errors.length || !scenario.data || !damageAndSummary.data || !pipeline.data) {
    throw new Error(`Contract files failed validation: ${errors.slice(0, 5).join('; ')}`);
  }
  return {
    scenario: scenario.data,
    damage: damageAndSummary.data.damage,
    summary: damageAndSummary.data.summary,
    pipeline: pipeline.data,
  };
}
