import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useSimulationStore } from '../../store/useSimulationStore';

/**
 * High-oblique district camera controller with:
 *   1. Slow idle camera drift over the 1-mile district ('drift' mode)
 *   2. Free-orbit interactive camera ('orbit' mode)
 *   3. Seeded synthetic camera shake during the earthquake window
 *   4. Real-time FPS / draw call / triangle counter for the 'D' debug overlay
 */
export function CameraRig() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const cameraMode = useSimulationStore((s) => s.cameraMode);

  // Perf measurement accumulators
  const frameCount = useRef(0);
  const lastPerfUpdate = useRef(performance.now());
  const targetVec = useRef(new THREE.Vector3(-80, 12, 0));

  useFrame(({ clock: threeClock }) => {
    const state = useSimulationStore.getState();
    const elapsed = threeClock.getElapsedTime();

    if (state.cameraMode === 'drift') {
      // High oblique panorama arc around the east/southeast/northeast bay outlook
      // so the whole 1-mile district, Embarcadero waterfront, Ferry Building,
      // downtown skyline, Telegraph Hill, and Bay Bridge read clearly.
      const baseAzimuth = 0.65 + Math.sin(elapsed * 0.085) * 0.42; // Gentle sweep
      const orbitDist = 1820 + Math.cos(elapsed * 0.06) * 90;
      const elevationY = 820 + Math.sin(elapsed * 0.07) * 45;

      let camX = Math.cos(baseAzimuth) * orbitDist;
      let camZ = Math.sin(baseAzimuth) * orbitDist;
      let camY = elevationY;

      // Apply seeded camera shake during the Earthquake window
      if (state.phase === 'playing' && state.isShaderProof && state.clock < 8.5) {
        const simT = state.clock;
        const attack = Math.min(1.0, simT / 1.0);
        const decay = simT > 5.5 ? Math.max(0.0, 1.0 - (simT - 5.5) / 3.0) : 1.0;
        const amp = attack * decay * 9.5;

        camX += Math.sin(simT * 27.0) * amp + Math.cos(simT * 41.0) * (amp * 0.5);
        camY += Math.cos(simT * 31.0) * (amp * 0.65);
        camZ += Math.sin(simT * 23.0 + 1.4) * amp;
      }

      camera.position.set(camX, camY, camZ);
      targetVec.current.set(-90, 15, 0);
      camera.lookAt(targetVec.current);
      if (controlsRef.current) {
        controlsRef.current.target.copy(targetVec.current);
      }
    } else if (controlsRef.current) {
      controlsRef.current.update();
    }

    // Update FPS, triangle count, and draw calls every ~400ms
    frameCount.current += 1;
    const now = performance.now();
    const dtMs = now - lastPerfUpdate.current;
    if (dtMs >= 400) {
      const fps = Math.round((frameCount.current * 1000) / dtMs);
      const renderInfo = gl.info.render;
      state.setPerfStats({
        fps,
        triangles: renderInfo.triangles,
        drawCalls: renderInfo.calls,
      });
      frameCount.current = 0;
      lastPerfUpdate.current = now;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={cameraMode === 'orbit'}
      enableDamping
      dampingFactor={0.08}
      minDistance={120}
      maxDistance={3400}
      maxPolarAngle={Math.PI * 0.48}
      target={[-90, 15, 0]}
    />
  );
}
