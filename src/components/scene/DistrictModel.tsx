import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { DISTRICT_RADIUS_M } from '../../config/coordinates';
import { THEME } from '../../config/theme';
import { useSimulationStore } from '../../store/useSimulationStore';
import {
  createBuildingsShaderMaterial,
  createBuildingStateTexture,
  resetBuildingStateTexture,
  updateBuildingStateTexture,
} from './BuildingsShaderMaterial';

/**
 * Loads the baked /models/district.glb containing:
 *   - Terrain (USGS/procedural topography + bathymetry)
 *   - Waterfront (Embarcadero seawall, 18 piers, roadways)
 *   - BayBridge (Western suspension span inside 1609m radius)
 *   - Buildings (SINGLE merged mesh of all buildings with per-vertex _BUILDINGID)
 */
export function DistrictModel() {
  const gltf = useGLTF('/models/district.glb');
  const wireframe = useSimulationStore((s) => s.wireframe);
  const shaderProofPayload = useSimulationStore((s) => s.shaderProofPayload);
  const phase = useSimulationStore((s) => s.phase);

  const stateTexture = useMemo(() => createBuildingStateTexture(), []);
  const buildingsMaterial = useMemo(
    () => createBuildingsShaderMaterial(stateTexture),
    [stateTexture]
  );

  const vertexColorMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        vertexColors: true,
      }),
    []
  );

  // Extract geometries from loaded GLTF nodes
  const { terrainGeo, waterfrontGeo, bridgeGeo, buildingsGeo } = useMemo(() => {
    let tGeo: THREE.BufferGeometry | null = null;
    let wGeo: THREE.BufferGeometry | null = null;
    let brGeo: THREE.BufferGeometry | null = null;
    let bGeo: THREE.BufferGeometry | null = null;

    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const name = (mesh.name || mesh.parent?.name || '').toLowerCase();
        if (name.includes('terrain')) {
          tGeo = mesh.geometry;
        } else if (name.includes('waterfront')) {
          wGeo = mesh.geometry;
        } else if (name.includes('bridge')) {
          brGeo = mesh.geometry;
        } else if (name.includes('building')) {
          bGeo = mesh.geometry;
        }
      }
    });

    if (bGeo) {
      const geo = bGeo as THREE.BufferGeometry;
      // Alias glTF custom attributes (_BUILDINGID or _buildingid -> aBuildingId, etc.)
      const mapAttr = (gltfKeyUpper: string, shaderAttr: string) => {
        const attr =
          geo.getAttribute(gltfKeyUpper) ||
          geo.getAttribute(gltfKeyUpper.toLowerCase());
        if (attr && !geo.getAttribute(shaderAttr)) {
          geo.setAttribute(shaderAttr, attr);
        }
      };
      mapAttr('_BUILDINGID', 'aBuildingId');
      mapAttr('_BASEELEV', 'aBaseElev');
      mapAttr('_BHEIGHT', 'aBHeight');
      mapAttr('_CENTROID', 'aCentroid');
    }

    return {
      terrainGeo: tGeo,
      waterfrontGeo: wGeo,
      bridgeGeo: brGeo,
      buildingsGeo: bGeo as THREE.BufferGeometry | null,
    };
  }, [gltf]);

  // Sync DataTexture whenever Shader Proof ('P') starts or simulation resets
  useEffect(() => {
    if (phase === 'idle' || !shaderProofPayload) {
      resetBuildingStateTexture(stateTexture);
      buildingsMaterial.uniforms.uIsPlaying.value = 0.0;
      buildingsMaterial.uniforms.uClock.value = 0.0;
      buildingsMaterial.uniforms.uShakeAmp.value = 0.0;
      buildingsMaterial.uniforms.uWaveProgress.value = 0.0;
    } else {
      updateBuildingStateTexture(
        stateTexture,
        shaderProofPayload.states,
        shaderProofPayload.onsetS,
        shaderProofPayload.modes
      );
      buildingsMaterial.uniforms.uIsPlaying.value = 1.0;
    }
  }, [phase, shaderProofPayload, stateTexture, buildingsMaterial]);

  // Toggle wireframe on materials
  useEffect(() => {
    buildingsMaterial.wireframe = wireframe;
    vertexColorMaterial.wireframe = wireframe;
  }, [wireframe, buildingsMaterial, vertexColorMaterial]);

  // Update simulation clock, earthquake shake envelope, and wave progress uniforms each frame
  useFrame((_, delta) => {
    const state = useSimulationStore.getState();
    if (state.phase === 'playing') {
      state.advanceClock(Math.min(delta, 0.1));
    }

    const simClock = state.clock;
    buildingsMaterial.uniforms.uClock.value = simClock;
    buildingsMaterial.uniforms.uHoveredBuildingId.value =
      state.hoveredBuildingId !== null ? state.hoveredBuildingId : -1.0;

    if (state.phase === 'playing' || state.phase === 'analysis_done') {
      buildingsMaterial.uniforms.uIsPlaying.value = 1.0;

      if (state.isShaderProof) {
        // 20s Shader Proof Sequence:
        // 0..8.5s: Earthquake shake envelope (ramps up quickly, peaks at 2..6s, tapers by 8.5s)
        let shakeAmp = 0.0;
        if (simClock < 8.5) {
          const attack = Math.min(1.0, simClock / 1.2);
          const decay = simClock > 5.5 ? Math.max(0.0, 1.0 - (simClock - 5.5) / 3.0) : 1.0;
          const modulation = 0.8 + 0.2 * Math.sin(simClock * 4.2);
          shakeAmp = attack * decay * modulation;
        }
        buildingsMaterial.uniforms.uShakeAmp.value = shakeAmp;

        // 7.8..16.5s: Wave surge progresses inland from Bay
        const waveProg = simClock >= 7.8 ? Math.min(1.0, (simClock - 7.8) / 7.5) : 0.0;
        buildingsMaterial.uniforms.uWaveProgress.value = waveProg;
      }
    } else {
      buildingsMaterial.uniforms.uIsPlaying.value = 0.0;
      buildingsMaterial.uniforms.uShakeAmp.value = 0.0;
      buildingsMaterial.uniforms.uWaveProgress.value = 0.0;
    }
  });

  // Throttle pointer move raycast lookups slightly for smooth 60fps
  const lastHoverTime = useRef(0);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const now = performance.now();
    if (now - lastHoverTime.current < 24) return;
    lastHoverTime.current = now;

    if (e.face && buildingsGeo) {
      const idAttr = buildingsGeo.getAttribute('aBuildingId');
      if (idAttr) {
        const bId = Math.round(idAttr.getX(e.face.a));
        useSimulationStore
          .getState()
          .setHoveredBuilding(bId, { x: e.clientX, y: e.clientY });
      }
    }
  };

  const handlePointerOut = () => {
    useSimulationStore.getState().setHoveredBuilding(null, null);
  };

  return (
    <group name="SFDistrictRoot">
      {/* 1. Terrain & Bathymetry */}
      {terrainGeo && (
        <mesh
          name="Terrain"
          geometry={terrainGeo}
          material={vertexColorMaterial}
          receiveShadow
        />
      )}

      {/* 2. Embarcadero Waterfront, Seawall, Piers & Main Roadways */}
      {waterfrontGeo && (
        <mesh
          name="Waterfront"
          geometry={waterfrontGeo}
          material={vertexColorMaterial}
          receiveShadow
        />
      )}

      {/* 3. Western Span of the Bay Bridge */}
      {bridgeGeo && (
        <mesh
          name="BayBridge"
          geometry={bridgeGeo}
          material={vertexColorMaterial}
          castShadow
        />
      )}

      {/* 4. All District Buildings in ONE Merged Draw Call */}
      {buildingsGeo && (
        <mesh
          name="Buildings"
          geometry={buildingsGeo}
          material={buildingsMaterial}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
        />
      )}

      {/* Subtle 1-Mile (1609 m) District Perimeter Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 3.2, 0]}>
        <ringGeometry args={[DISTRICT_RADIUS_M - 4, DISTRICT_RADIUS_M + 4, 128]} />
        <meshBasicMaterial
          color={THEME.ui.accentPrimary}
          transparent
          opacity={0.28}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

useGLTF.preload('/models/district.glb');
