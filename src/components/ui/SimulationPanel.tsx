import {
  Play,
  RotateCcw,
  Compass,
  Move3d,
  Bug,
  Sparkles,
  Layers,
  Info,
} from 'lucide-react';
import { DAMAGE_STATE_LABELS, THEME } from '../../config/theme';
import { DAMAGE_STATES, type DamageState } from '../../config/constants';
import { useSimulationStore } from '../../store/useSimulationStore';
import { DistrictCanvas } from '../scene/DistrictCanvas';

/**
 * LEFT (~70% width) "Disaster Simulation" Panel.
 * Contains the 3D district canvas, bottom-center Play Simulation + timeline/status bar,
 * corner Reset + Camera mode buttons, corner Damage Legend, 3D Hover Tooltip,
 * and the 'D' Debug Overlay.
 */
export function SimulationPanel() {
  const phase = useSimulationStore((s) => s.phase);
  const clock = useSimulationStore((s) => s.clock);
  const duration = useSimulationStore((s) => s.duration);
  const statusLabel = useSimulationStore((s) => s.statusLabel);
  const isShaderProof = useSimulationStore((s) => s.isShaderProof);
  const cameraMode = useSimulationStore((s) => s.cameraMode);
  const debugOpen = useSimulationStore((s) => s.debugOpen);
  const wireframe = useSimulationStore((s) => s.wireframe);
  const perfStats = useSimulationStore((s) => s.perfStats);
  const buildingsMeta = useSimulationStore((s) => s.buildingsMeta);
  const hoveredBuildingId = useSimulationStore((s) => s.hoveredBuildingId);
  const hoveredPointer = useSimulationStore((s) => s.hoveredPointer);
  const shaderProofPayload = useSimulationStore((s) => s.shaderProofPayload);

  const startShaderProof = useSimulationStore((s) => s.startShaderProof);
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const contract = useSimulationStore((s) => s.contract);
  const resetSimulation = useSimulationStore((s) => s.resetSimulation);
  const setCameraMode = useSimulationStore((s) => s.setCameraMode);
  const toggleDebug = useSimulationStore((s) => s.toggleDebug);
  const toggleWireframe = useSimulationStore((s) => s.toggleWireframe);

  const progressPct = duration > 0 ? Math.min(100, (clock / duration) * 100) : 0;

  // Lookup hovered building record
  const hoveredBuilding =
    hoveredBuildingId !== null && buildingsMeta?.buildings[hoveredBuildingId]
      ? buildingsMeta.buildings[hoveredBuildingId]
      : null;

  // Compute current damage state of hovered building if Shader Proof is active
  let hoveredDamageState: DamageState = 0;
  let hoveredModeLabel = 'None';
  if (
    hoveredBuildingId !== null &&
    shaderProofPayload &&
    (phase === 'playing' || phase === 'analysis_done')
  ) {
    const onset = shaderProofPayload.onsetS[hoveredBuildingId];
    if (clock >= onset) {
      hoveredDamageState = shaderProofPayload.states[hoveredBuildingId] as DamageState;
    }
    hoveredModeLabel =
      shaderProofPayload.modes[hoveredBuildingId] === 1 ? 'Wave / Flood' : 'Ground Shaking';
  }

  return (
    <section className="sim-panel-card" aria-label="Disaster Simulation">
      {/* 3D Canvas filling the card */}
      <div className="sim-canvas-wrapper">
        <DistrictCanvas />
      </div>

      {/* Top-Left Overlay: Panel Title & District Data Badge */}
      <div className="sim-overlay-top-left">
        <div className="sim-title-pill">
          <span className="sim-title-dot" />
          <div>
            <h1 className="sim-title-text">Disaster Simulation</h1>
            <p className="sim-subtitle-text">
              1-Mile Radius • SF Ferry Building Origin (37.7955°N, 122.3937°W)
            </p>
          </div>
        </div>

        {buildingsMeta?.is_placeholder && (
          <div
            className="placeholder-data-badge"
            title={buildingsMeta.generation_note}
          >
            <Info size={13} />
            <span>
              Procedural Placeholder District ({buildingsMeta.building_count.toLocaleString()}{' '}
              buildings)
            </span>
          </div>
        )}
      </div>

      {/* Top-Right Corner Overlay: Camera Mode, Debug Toggle & Discreet Reset */}
      <div className="sim-overlay-top-right">
        <button
          type="button"
          className={`corner-btn ${cameraMode === 'orbit' ? 'active' : ''}`}
          onClick={() => setCameraMode(cameraMode === 'drift' ? 'orbit' : 'drift')}
          title="Switch between slow idle camera drift and interactive free-orbit mode"
        >
          {cameraMode === 'drift' ? <Compass size={14} /> : <Move3d size={14} />}
          <span>{cameraMode === 'drift' ? 'Camera: Idle Drift' : 'Camera: Free Orbit'}</span>
        </button>

        <button
          type="button"
          className={`corner-btn ${debugOpen ? 'active' : ''}`}
          onClick={toggleDebug}
          title="Toggle Debug Overlay (Shortcut: D)"
        >
          <Bug size={14} />
          <span>Debug (D)</span>
        </button>

        <button
          type="button"
          className="corner-btn reset-btn"
          onClick={resetSimulation}
          disabled={phase === 'idle' && clock === 0}
          title="Reset simulation clock and building states"
        >
          <RotateCcw size={14} />
          <span>Reset</span>
        </button>
      </div>

      {/* Debug Overlay (Toggled with key 'D') */}
      {debugOpen && (
        <div className="debug-overlay-card" role="region" aria-label="Debug Statistics">
          <div className="debug-header">
            <span className="debug-title">
              <Bug size={13} /> 3D Performance &amp; Debug
            </span>
            <span className="debug-shortcut-tag">Key: D</span>
          </div>

          <div className="debug-stats-grid">
            <div className="debug-stat-item">
              <span className="debug-stat-label">FPS</span>
              <span className="debug-stat-value">{perfStats.fps}</span>
            </div>
            <div className="debug-stat-item">
              <span className="debug-stat-label">Draw Calls</span>
              <span className="debug-stat-value">{perfStats.drawCalls}</span>
            </div>
            <div className="debug-stat-item">
              <span className="debug-stat-label">Triangles</span>
              <span className="debug-stat-value">
                {perfStats.triangles.toLocaleString()}
              </span>
            </div>
            <div className="debug-stat-item">
              <span className="debug-stat-label">Buildings</span>
              <span className="debug-stat-value">
                {perfStats.buildingCount.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="debug-controls-row">
            <button
              type="button"
              className={`debug-toggle-btn ${wireframe ? 'active' : ''}`}
              onClick={toggleWireframe}
            >
              <Layers size={13} />
              <span>Wireframe: {wireframe ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              className="debug-toggle-btn proof-btn"
              onClick={startShaderProof}
            >
              <Sparkles size={13} />
              <span>Run 20s Shader Proof (P)</span>
            </button>
          </div>

          <div className="debug-axes-note">
            Axes at Ferry Bldg (0,0,0): <strong style={{ color: '#c94a4a' }}>+X East</strong> •{' '}
            <strong style={{ color: '#4a9e5c' }}>+Y Up</strong> •{' '}
            <strong style={{ color: '#3b78b5' }}>+Z South (-North)</strong>
          </div>
        </div>
      )}

      {/* Bottom-Left Corner Overlay: Damage Color Ramp Legend */}
      <div className="sim-overlay-bottom-left">
        <div className="legend-card">
          <div className="legend-title">Building Damage State</div>
          <div className="legend-items">
            {DAMAGE_STATES.map((st) => (
              <div key={st} className="legend-item">
                <span
                  className="legend-swatch"
                  style={{ backgroundColor: THEME.damageRamp[st] }}
                />
                <span className="legend-label">
                  {st}: {DAMAGE_STATE_LABELS[st]}
                </span>
              </div>
            ))}
            <div className="legend-divider" />
            <div className="legend-item">
              <span
                className="legend-swatch flood-swatch"
                style={{ backgroundColor: THEME.overlays.floodTint }}
              />
              <span className="legend-label">Flood Inundation</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-Center Overlay: Play Simulation Button + Timeline & Status Label */}
      <div className="sim-overlay-bottom-center">
        <div className="playback-dock">
          <div className="playback-top-row">
            <button
              type="button"
              className="play-sim-button"
              onClick={startSimulation}
              title={contract ? 'Play the Argon scenario (key P)' : 'Phase 1: Triggers the 20s full-district shader proof (also triggered with key P)'}
            >
              <Play size={16} fill="currentColor" />
              <span>
                {phase === 'playing'
                  ? contract
                    ? 'Playing Scenario...'
                    : 'Replaying Shader Proof...'
                  : phase === 'analysis_done'
                    ? 'Replay Simulation'
                    : 'Play Simulation'}
              </span>
            </button>

            <div className="status-timeline-group">
              <div className="status-row">
                <span className={`status-badge status-${statusLabel.toLowerCase().replace(/\s+/g, '-')}`}>
                  {statusLabel}
                </span>
                <span className="clock-readout">
                  {clock.toFixed(1)}s / {duration.toFixed(0)}s
                </span>
              </div>

              <div className="timeline-track" role="progressbar" aria-valuenow={progressPct}>
                <div
                  className="timeline-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="playback-hint-row">
            <span>
              {contract
                ? `${contract.scenario.label}: M${contract.scenario.earthquake.magnitude.toFixed(1)} earthquake, then the wave at ${contract.scenario.wave.arrival_s}s • ${contract.damage.building_ids.length.toLocaleString()} buildings • Toggle fixes to see the mitigated outcome instantly`
                : isShaderProof
                ? 'Running Phase 1 GPU Damage-Shader Proof (1 draw call for all 2,439 buildings)'
                : 'Phase 1 Ready • Press [P] or click Play Simulation to test 20s district shader proof • Press [D] for Debug'}
            </span>
          </div>
        </div>
      </div>

      {/* 3D Building Hover Tooltip */}
      {hoveredBuilding && hoveredPointer && (
        <div
          className="building-hover-tooltip"
          style={{
            left: Math.min(window.innerWidth * 0.65, hoveredPointer.x + 16),
            top: Math.max(20, hoveredPointer.y - 10),
          }}
        >
          <div className="tooltip-header">
            <span className="tooltip-id">Building #{hoveredBuilding.id}</span>
            <span
              className="tooltip-state-pill"
              style={{
                backgroundColor: THEME.damageRamp[hoveredDamageState],
                color: hoveredDamageState >= 3 ? '#FFFDF8' : THEME.ui.textPrimary,
              }}
            >
              State {hoveredDamageState}: {DAMAGE_STATE_LABELS[hoveredDamageState]}
            </span>
          </div>
          {hoveredBuilding.name && (
            <div className="tooltip-landmark-name">{hoveredBuilding.name}</div>
          )}
          <div className="tooltip-meta-grid">
            <span>Height: {hoveredBuilding.height_m} m</span>
            <span>Elev: {hoveredBuilding.ground_elevation_m} m</span>
            <span>Area: {Math.round(hoveredBuilding.footprint_area_m2)} m²</span>
            <span>
              Mode: {phase === 'idle' ? 'Baseline' : hoveredModeLabel}
            </span>
          </div>
          <div className="tooltip-archetype">
            Archetype: <em>Pending Phase 2 summary.json</em>
          </div>
        </div>
      )}
    </section>
  );
}
