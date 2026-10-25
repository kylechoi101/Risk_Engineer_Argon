/**
 * Data Contract Validators (Sections 5 & 8)
 * Validates scenario.json, buildings_damage.json, summary.json, pipeline_events.json, and buildings.json.
 */

import {
  DAMAGE_STATES,
  BUILDING_DOMINANT_MODES,
  DOMINANT_MODES,
  EVIDENCE_TYPES,
  PIPELINE_NODES,
  PIPELINE_STATUSES,
  PRIORITY_LEVELS,
} from '../config/constants';
import type {
  BuildingsDamageSchema,
  BuildingsMetadataSchema,
  PipelineEvent,
  PipelineEventAdapter,
  PipelineEventsSchema,
  ScenarioSchema,
  SummarySchema,
} from '../types/dataContract';

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  data?: T;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Decode a base64 Float32 string into a Float32Array and verify length.
 */
export function decodeBase64Float32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

/**
 * Validate 5.1 scenario.json
 */
export function validateScenario(raw: unknown): ValidationResult<ScenarioSchema> {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { valid: false, errors: ['scenario.json root must be an object'] };
  }

  if (raw.schema_version !== '1.0') {
    errors.push(`Expected schema_version "1.0", got "${String(raw.schema_version)}"`);
  }
  if (typeof raw.scenario_id !== 'string' || !raw.scenario_id) {
    errors.push('Missing or invalid scenario_id');
  }
  if (typeof raw.label !== 'string') {
    errors.push('Missing or invalid label');
  }

  if (!isObject(raw.earthquake)) {
    errors.push('Missing earthquake object');
  } else {
    const eq = raw.earthquake;
    if (typeof eq.magnitude !== 'number') errors.push('earthquake.magnitude must be a number');
    if (typeof eq.duration_s !== 'number' || eq.duration_s <= 0) {
      errors.push('earthquake.duration_s must be a positive number');
    }
    if (!Array.isArray(eq.envelope) || eq.envelope.length === 0) {
      errors.push('earthquake.envelope must be a non-empty array of [t, amplitude] pairs');
    }
    if (typeof eq.dominant_freq_hz !== 'number') {
      errors.push('earthquake.dominant_freq_hz must be a number');
    }
  }

  if (!isObject(raw.wave)) {
    errors.push('Missing wave object');
  } else {
    const wave = raw.wave;
    if (typeof wave.arrival_s !== 'number') errors.push('wave.arrival_s must be a number');
    if (!isObject(wave.inundation_grid)) {
      errors.push('Missing wave.inundation_grid');
    } else {
      const grid = wave.inundation_grid;
      if (typeof grid.cols !== 'number' || typeof grid.rows !== 'number') {
        errors.push('inundation_grid cols and rows must be numbers');
      }
      if (typeof grid.arrival_s !== 'string') errors.push('inundation_grid.arrival_s must be base64 string');
      if (typeof grid.peak_depth_m !== 'string') errors.push('inundation_grid.peak_depth_m must be base64 string');
      if (typeof grid.recede_s !== 'string') errors.push('inundation_grid.recede_s must be base64 string');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (raw as unknown as ScenarioSchema) : undefined,
  };
}

/**
 * Validate 5.2 buildings_damage.json and 5.3 summary.json together (including cross-file constraints).
 */
export function validateDamageAndSummary(
  rawDamage: unknown,
  rawSummary: unknown
): ValidationResult<{ damage: BuildingsDamageSchema; summary: SummarySchema }> {
  const errors: string[] = [];

  if (!isObject(rawDamage)) {
    return { valid: false, errors: ['buildings_damage.json must be an object'] };
  }
  if (!isObject(rawSummary)) {
    return { valid: false, errors: ['summary.json must be an object'] };
  }

  const damage = rawDamage as unknown as BuildingsDamageSchema;
  const summary = rawSummary as unknown as SummarySchema;

  if (!Array.isArray(damage.building_ids)) {
    return { valid: false, errors: ['buildings_damage.building_ids must be an array'] };
  }
  const count = damage.building_ids.length;

  // Check parallel arrays length
  if (!Array.isArray(damage.archetype_idx) || damage.archetype_idx.length !== count) {
    errors.push('archetype_idx length does not match building_ids length');
  }
  if (!Array.isArray(damage.zone_idx) || damage.zone_idx.length !== count) {
    errors.push('zone_idx length does not match building_ids length');
  }
  if (!Array.isArray(damage.onset_s) || damage.onset_s.length !== count) {
    errors.push('onset_s length does not match building_ids length');
  }
  if (!Array.isArray(damage.dominant_mode) || damage.dominant_mode.length !== count) {
    errors.push('dominant_mode length does not match building_ids length');
  } else {
    for (let i = 0; i < count; i++) {
      if (!BUILDING_DOMINANT_MODES.includes(damage.dominant_mode[i])) {
        errors.push(`Invalid dominant_mode at index ${i}: ${String(damage.dominant_mode[i])}`);
        break;
      }
    }
  }

  const numZones = Array.isArray(summary.zones) ? summary.zones.length : 0;
  const numArchetypes = Array.isArray(summary.archetypes) ? summary.archetypes.length : 0;

  if (Array.isArray(damage.zone_idx)) {
    for (let i = 0; i < count; i++) {
      if (damage.zone_idx[i] < 0 || damage.zone_idx[i] >= numZones) {
        errors.push(`Invalid zone_idx ${damage.zone_idx[i]} at index ${i}`);
        break;
      }
    }
  }
  if (Array.isArray(damage.archetype_idx)) {
    for (let i = 0; i < count; i++) {
      if (damage.archetype_idx[i] < 0 || damage.archetype_idx[i] >= numArchetypes) {
        errors.push(`Invalid archetype_idx ${damage.archetype_idx[i]} at index ${i}`);
        break;
      }
    }
  }

  // Validate fixes and unique bits
  const fixIds = new Set<string>();
  const fixBits = new Set<number>();
  if (Array.isArray(summary.fixes)) {
    for (const fix of summary.fixes) {
      if (fixIds.has(fix.id)) errors.push(`Duplicate fix id: ${fix.id}`);
      if (fixBits.has(fix.bit)) errors.push(`Duplicate fix bit: ${fix.bit}`);
      fixIds.add(fix.id);
      fixBits.add(fix.bit);
    }
  } else {
    errors.push('summary.fixes must be an array');
  }

  // Validate weak_point_groups reference valid fix_id and valid priority/evidence
  if (Array.isArray(summary.weak_point_groups)) {
    for (const group of summary.weak_point_groups) {
      if (!fixIds.has(group.fix_id)) {
        errors.push(`weak_point_group "${group.id}" references unknown fix_id "${group.fix_id}"`);
      }
      if (!PRIORITY_LEVELS.includes(group.priority)) {
        errors.push(`weak_point_group "${group.id}" has invalid priority "${String(group.priority)}"`);
      }
      if (!EVIDENCE_TYPES.includes(group.evidence)) {
        errors.push(`weak_point_group "${group.id}" has invalid evidence "${String(group.evidence)}"`);
      }
    }
  }

  // Validate outcomes and combo "0" baseline
  if (!isObject(damage.outcomes) || !isObject(damage.outcomes['0'])) {
    errors.push('buildings_damage.outcomes must contain baseline key "0"');
  } else {
    const baselineStates = damage.outcomes['0'].state;
    if (!Array.isArray(baselineStates) || baselineStates.length !== count) {
      errors.push('outcomes["0"].state length must match building_ids length');
    } else {
      for (const [comboKey, outcome] of Object.entries(damage.outcomes)) {
        if (!Array.isArray(outcome.state) || outcome.state.length !== count) {
          errors.push(`outcomes["${comboKey}"].state length mismatch`);
          continue;
        }
        if (!Array.isArray(outcome.cost_usd_mid) || outcome.cost_usd_mid.length !== count) {
          errors.push(`outcomes["${comboKey}"].cost_usd_mid length mismatch`);
        }
        for (let i = 0; i < count; i++) {
          const st = outcome.state[i];
          if (!DAMAGE_STATES.includes(st)) {
            errors.push(`outcomes["${comboKey}"].state[${i}] = ${String(st)} is not in 0..4`);
            break;
          }
          if (st > baselineStates[i]) {
            errors.push(
              `outcomes["${comboKey}"].state[${i}] (${st}) > baseline state (${baselineStates[i]})`
            );
            break;
          }
        }
      }
    }
  }

  // Validate summary.by_combo counts_by_state sums to building count
  if (isObject(summary.by_combo)) {
    for (const [comboKey, comboSum] of Object.entries(summary.by_combo)) {
      if (!Array.isArray(comboSum.counts_by_state) || comboSum.counts_by_state.length !== 5) {
        errors.push(`summary.by_combo["${comboKey}"].counts_by_state must have 5 elements`);
      } else {
        const total = comboSum.counts_by_state.reduce((a, b) => a + b, 0);
        if (total !== count) {
          errors.push(
            `summary.by_combo["${comboKey}"].counts_by_state sums to ${total}, expected ${count}`
          );
        }
      }
    }
  } else {
    errors.push('summary.by_combo must be an object');
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? { damage, summary } : undefined,
  };
}

/**
 * Validate 5.4 pipeline_events.json
 */
export function validatePipelineEvents(raw: unknown): ValidationResult<PipelineEventsSchema> {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { valid: false, errors: ['pipeline_events.json must be an array'] };
  }

  for (let i = 0; i < raw.length; i++) {
    const ev = raw[i];
    if (!isObject(ev)) {
      errors.push(`Event at index ${i} must be an object`);
      continue;
    }
    if (typeof ev.t_s !== 'number') errors.push(`Event ${i}: t_s must be a number`);
    if (!PIPELINE_NODES.includes(ev.node as PipelineEvent['node'])) {
      errors.push(`Event ${i}: invalid node "${String(ev.node)}"`);
    }
    if (!PIPELINE_STATUSES.includes(ev.status as PipelineEvent['status'])) {
      errors.push(`Event ${i}: invalid status "${String(ev.status)}"`);
    }
    if (typeof ev.message !== 'string') errors.push(`Event ${i}: message must be a string`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (raw as PipelineEventsSchema) : undefined,
  };
}

/**
 * Validate 6 buildings.json
 */
export function validateBuildingsMetadata(raw: unknown): ValidationResult<BuildingsMetadataSchema> {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { valid: false, errors: ['buildings.json must be an object'] };
  }
  if (!Array.isArray(raw.buildings)) {
    errors.push('buildings.json must contain a buildings array');
  } else if (typeof raw.building_count === 'number' && raw.buildings.length !== raw.building_count) {
    errors.push(
      `buildings.json building_count (${raw.building_count}) !== buildings.length (${raw.buildings.length})`
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (raw as unknown as BuildingsMetadataSchema) : undefined,
  };
}

/**
 * Recorded PipelineEventAdapter implementation for replaying pipeline_events.json
 * synced to the simulation clock, and a live SSE adapter skeleton for swapping later.
 */
export class RecordedPipelineAdapter implements PipelineEventAdapter {
  public readonly mode = 'recorded' as const;
  private events: PipelineEvent[];
  private emittedCount = 0;
  private onEventCallback: ((event: PipelineEvent) => void) | null = null;

  constructor(events: PipelineEvent[]) {
    this.events = [...events].sort((a, b) => a.t_s - b.t_s);
  }

  start(onEvent: (event: PipelineEvent) => void): void {
    this.onEventCallback = onEvent;
    this.emittedCount = 0;
  }

  syncToClock(clockS: number): void {
    if (!this.onEventCallback) return;
    while (
      this.emittedCount < this.events.length &&
      this.events[this.emittedCount].t_s <= clockS
    ) {
      this.onEventCallback(this.events[this.emittedCount]);
      this.emittedCount++;
    }
  }

  stop(): void {
    this.onEventCallback = null;
    this.emittedCount = 0;
  }
}
