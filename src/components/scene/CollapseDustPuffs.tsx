import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { THEME } from '../../config/theme';
import { useSimulationStore } from '../../store/useSimulationStore';

const PUFFS_PER_BUILDING = 4;
const MAX_COLLAPSE_BUILDINGS = 65;
const MAX_INSTANCES = MAX_COLLAPSE_BUILDINGS * PUFFS_PER_BUILDING;

/**
 * Instanced dust puff particle system for State-4 collapsing buildings.
 * Renders in a single instanced draw call with no physics engine.
 */
export function CollapseDustPuffs() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(THEME.scene.dustPuff),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    []
  );

  useFrame(() => {
    const instMesh = meshRef.current;
    if (!instMesh) return;

    const state = useSimulationStore.getState();
    const payload = state.shaderProofPayload;

    if (
      state.phase === 'idle' ||
      !payload ||
      payload.collapseTargets.length === 0
    ) {
      instMesh.count = 0;
      return;
    }

    const targets = payload.collapseTargets;
    const clock = state.clock;
    let instanceIdx = 0;

    for (let i = 0; i < targets.length && i < MAX_COLLAPSE_BUILDINGS; i++) {
      const target = targets[i];
      const elapsed = clock - target.onset;

      if (elapsed <= 0 || elapsed > 4.8) {
        continue;
      }

      // Puff lifecycle: 0..4.8s
      const life = elapsed / 4.8;
      // Fast expansion in first 0.8s, then gradual fade/shrink
      const expand = Math.sin(Math.min(1, life * 1.8) * Math.PI * 0.5);
      const fade = life < 0.45 ? 1.0 : Math.max(0.01, 1.0 - (life - 0.45) / 0.55);
      const scaleBase = (6.5 + Math.min(14, target.height * 0.16)) * expand * fade;

      for (let p = 0; p < PUFFS_PER_BUILDING; p++) {
        const angle = (p * Math.PI * 0.5) + (i * 0.7);
        const radius = (4.0 + expand * 14.0) * (0.8 + (p % 2) * 0.35);
        const px = target.x + Math.cos(angle) * radius;
        const pz = target.z + Math.sin(angle) * radius;
        const py = target.y + 2.5 + elapsed * (3.2 + p * 0.6);

        dummy.position.set(px, py, pz);
        dummy.scale.set(
          scaleBase * 1.25,
          scaleBase * 0.65,
          scaleBase * 1.25
        );
        dummy.rotation.set(0, angle + elapsed * 0.4, 0);
        dummy.updateMatrix();
        instMesh.setMatrixAt(instanceIdx++, dummy.matrix);
      }
    }

    instMesh.count = instanceIdx;
    instMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
    />
  );
}
