import { Cpu, Terminal, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import {
  PIPELINE_NODES,
  PIPELINE_NODE_LABELS,
  type PipelineNodeId,
  type PipelineStatus,
} from '../../config/constants';
import { useSimulationStore } from '../../store/useSimulationStore';

const SHORT_NODE_LABELS: Record<PipelineNodeId, string> = {
  gov_data: 'Gov Data Retrieval',
  hazard_model: 'Hazard Modeling',
  monte_carlo: 'Monte Carlo Sim',
  failure_analysis: 'Failure Analysis',
  fix_planning: 'Fix Planning',
};

/**
 * RIGHT BOTTOM CARD: "Architectural View".
 * Shows the 5-node Argon multi-agent pipeline (queued / running / done)
 * and the streaming reasoning log area below it.
 */
export function ArchitecturalViewCard() {
  const phase = useSimulationStore((s) => s.phase);
  const clock = useSimulationStore((s) => s.clock);
  const isShaderProof = useSimulationStore((s) => s.isShaderProof);

  // Derive visual node status (queued in idle; progressive during 20s shader proof)
  const getNodeStatus = (idx: number): PipelineStatus => {
    if (phase === 'idle') return 'queued';
    if (phase === 'analysis_done') return 'done';
    if (isShaderProof) {
      const stepDuration = 20 / PIPELINE_NODES.length;
      const nodeStart = idx * stepDuration;
      const nodeEnd = (idx + 1) * stepDuration;
      if (clock >= nodeEnd) return 'done';
      if (clock >= nodeStart) return 'running';
    }
    return 'queued';
  };

  return (
    <section className="sidebar-card architectural-view-card" aria-label="Architectural View">
      {/* Card Header */}
      <header className="card-header">
        <div className="arch-header-left">
          <Cpu size={16} className="arch-icon" />
          <div>
            <h2 className="card-title">Architectural View</h2>
            <p className="card-subtitle">Argon multi-agent orchestration pipeline</p>
          </div>
        </div>
        <span className="arch-status-pill">
          {phase === 'idle'
            ? 'Pipeline Standby'
            : phase === 'playing'
              ? 'Shader Proof Active'
              : 'Run Complete'}
        </span>
      </header>

      {/* 5-Stage Agent Pipeline Flow */}
      <div className="pipeline-nodes-track" role="list" aria-label="Pipeline Nodes">
        {PIPELINE_NODES.map((nodeId, idx) => {
          const status = getNodeStatus(idx);
          return (
            <div
              key={nodeId}
              role="listitem"
              className={`pipeline-node-chip status-${status}`}
              title={`${PIPELINE_NODE_LABELS[nodeId]} (${status})`}
            >
              <div className="node-status-icon">
                {status === 'done' ? (
                  <CheckCircle2 size={13} />
                ) : status === 'running' ? (
                  <Loader2 size={13} className="spin-icon" />
                ) : (
                  <Clock size={13} />
                )}
              </div>
              <div className="node-chip-content">
                <span className="node-step-num">0{idx + 1}</span>
                <span className="node-chip-label">{SHORT_NODE_LABELS[nodeId]}</span>
                <span className={`node-status-tag ${status}`}>{status}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Streaming Reasoning Log Area */}
      <div className="pipeline-log-container">
        <div className="pipeline-log-header">
          <Terminal size={13} />
          <span>Argon Orchestrator Event Stream</span>
          <span className="log-source-tag">/public/data/pipeline_events.json</span>
        </div>

        <div className="pipeline-log-body">
          {phase === 'idle' ? (
            <div className="log-placeholder-message">
              <div className="log-line muted">
                [00.0s] <span className="log-node-tag">[system]</span> District mesh loaded (1
                draw call). Waiting for simulation trigger...
              </div>
              <div className="log-line muted">
                [00.0s] <span className="log-node-tag">[adapter]</span> RecordedPipelineAdapter
                ready (SSE live stream interface compatible).
              </div>
              <div className="log-line hint">
                Press <strong>[P]</strong> or click <strong>Play Simulation</strong> to test
                the 20-second GPU damage-shader proof.
              </div>
            </div>
          ) : (
            <div className="log-placeholder-message">
              <div className="log-line">
                [00.2s] <span className="log-node-tag">[shader_proof]</span> Assigned seeded
                damage states (0..4) &amp; onset_s across all buildings via RGBA Float DataTexture.
              </div>
              {clock >= 1.0 && (
                <div className="log-line">
                  [01.0s] <span className="log-node-tag">[earthquake]</span> Synthetic M7.0
                  ground shaking envelope active (building sway + camera shake).
                </div>
              )}
              {clock >= 4.0 && (
                <div className="log-line">
                  [04.0s] <span className="log-node-tag">[damage_ramp]</span> States 1–4
                  transitioning in vertex/fragment shader; state-4 collapses triggering dust puffs.
                </div>
              )}
              {clock >= 8.0 && (
                <div className="log-line">
                  [08.0s] <span className="log-node-tag">[wave_surge]</span> Extreme bay wave
                  surge crossing Embarcadero seawall; applying blue-teal flood tint.
                </div>
              )}
              {clock >= 19.5 && (
                <div className="log-line">
                  [20.0s] <span className="log-node-tag">[complete]</span> 20-second Phase 1
                  damage-shader proof complete.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
