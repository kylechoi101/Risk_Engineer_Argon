import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { THEME } from '../../config/theme';
import { useSimulationStore } from '../../store/useSimulationStore';
import { DistrictModel } from './DistrictModel';
import { WaterSurface } from './WaterSurface';
import { CollapseDustPuffs } from './CollapseDustPuffs';
import { CameraRig } from './CameraRig';

/**
 * Full 3D District Scene Canvas.
 * Self-contained with zero external network dependencies (no tile servers, no CDN textures).
 */
export function DistrictCanvas() {
  const debugOpen = useSimulationStore((s) => s.debugOpen);
  const phase = useSimulationStore((s) => s.phase);
  const clock = useSimulationStore((s) => s.clock);
  const isShaderProof = useSimulationStore((s) => s.isShaderProof);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        position: [1420, 820, 1120],
        fov: 42,
        near: 8,
        far: 6500,
      }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
      }}
      onCreated={({ scene }) => {
        scene.background = null;
      }}
      style={{
        width: '100%',
        height: '100%',
        background: `linear-gradient(180deg, ${THEME.scene.skyColor} 0%, #E7E1D3 100%)`,
      }}
    >
      {/* Soft Daylight Illumination */}
      <ambientLight color={THEME.scene.ambientLight} intensity={0.78} />
      <hemisphereLight
        color={THEME.scene.sunLight}
        groundColor={THEME.scene.hemisphereGround}
        intensity={0.55}
      />
      <directionalLight
        color={THEME.scene.sunLight}
        intensity={1.15}
        position={[950, 1450, 620]}
      />

      {/* Camera Controller (Idle Drift + Free Orbit + Earthquake Camera Shake) */}
      <CameraRig />

      {/* Debug Axes Helper at Ferry Building Origin (0,0,0) when 'D' is active */}
      {debugOpen && <axesHelper args={[450]} position={[0, 4, 0]} />}

      {/* Subtle Floating Hotspot Callout Badges during Shader Proof */}
      {isShaderProof && (phase === 'playing' || phase === 'analysis_done') && clock > 3.5 && (
        <group>
          <Html position={[-280, 125, -80]} center distanceFactor={1800}>
            <div className="hotspot-callout">
              <span className="hotspot-dot high" />
              <span>Financial District North: Soft-story &amp; URM shaking</span>
            </div>
          </Html>
          {clock > 8.5 && (
            <Html position={[180, 45, 420]} center distanceFactor={1800}>
              <div className="hotspot-callout flood">
                <span className="hotspot-dot flood" />
                <span>Embarcadero &amp; South Beach Piers: Wave surge inundation</span>
              </div>
            </Html>
          )}
        </group>
      )}

      {/* District Geometry, Water Plane, and Collapse Dust Puffs */}
      <Suspense fallback={null}>
        <DistrictModel />
        <WaterSurface />
        <CollapseDustPuffs />
      </Suspense>
    </Canvas>
  );
}
