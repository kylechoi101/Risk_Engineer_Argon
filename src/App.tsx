import { useEffect } from 'react';
import { SimulationPanel } from './components/ui/SimulationPanel';
import { WeakPointsCard } from './components/ui/WeakPointsCard';
import { ArchitecturalViewCard } from './components/ui/ArchitecturalViewCard';
import { useSimulationStore } from './store/useSimulationStore';
import { validateBuildingsMetadata } from './utils/validators';
import './styles/app.css';

export function App() {
  const setBuildingsMeta = useSimulationStore((s) => s.setBuildingsMeta);
  const startShaderProof = useSimulationStore((s) => s.startShaderProof);
  const toggleDebug = useSimulationStore((s) => s.toggleDebug);
  const resetSimulation = useSimulationStore((s) => s.resetSimulation);

  // Load /public/data/buildings.json metadata on startup
  useEffect(() => {
    let cancelled = false;
    fetch('/data/buildings.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((raw) => {
        if (cancelled) return;
        const result = validateBuildingsMetadata(raw);
        if (result.valid && result.data) {
          setBuildingsMeta(result.data);
        } else {
          console.error('[Validator] buildings.json validation failed:', result.errors);
        }
      })
      .catch((err) => {
        console.error('[Startup] Failed to load /data/buildings.json:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [setBuildingsMeta]);

  // Keyboard shortcuts:
  //   P -> Run 20-second Damage-Shader Proof across all buildings
  //   D -> Toggle Debug Overlay (Axes helper, FPS, triangles, draw calls, buildings, wireframe)
  //   R -> Reset Simulation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        startShaderProof();
      } else if (key === 'd') {
        e.preventDefault();
        toggleDebug();
      } else if (key === 'r') {
        e.preventDefault();
        resetSimulation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startShaderProof, toggleDebug, resetSimulation]);

  return (
    <main className="app-shell">
      {/* LEFT (~70% width): Disaster Simulation 3D Panel */}
      <div className="left-region">
        <SimulationPanel />
      </div>

      {/* RIGHT (~30% width): Two Stacked Cards */}
      <aside className="right-region">
        <WeakPointsCard />
        <ArchitecturalViewCard />
      </aside>
    </main>
  );
}

export default App;
