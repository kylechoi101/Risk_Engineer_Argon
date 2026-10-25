import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { THEME } from '../../config/theme';
import { useSimulationStore } from '../../store/useSimulationStore';

/**
 * Water Plane at Sea Level (y = 0 m) with a calm light-themed shader.
 * Drivable by the inundation front during the Phase 1 Shader Proof ('P')
 * and by the scenario inundation grid in Phase 2.
 */
export function WaterSurface() {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireframe = useSimulationStore((s) => s.wireframe);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uWaveProgress: { value: 0 },
        uSurgeHeight: { value: 0 },
        uShallowColor: { value: new THREE.Color(THEME.scene.waterShallow) },
        uDeepColor: { value: new THREE.Color(THEME.scene.waterDeep) },
        uFloodTint: { value: new THREE.Color(THEME.overlays.floodTint) },
        uFoamColor: { value: new THREE.Color(THEME.scene.waterFoam) },
        uFogColor: { value: new THREE.Color(THEME.scene.fogColor) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWaveProgress;
        uniform float uSurgeHeight;

        varying vec3 vWorldPos;
        varying float vSurgeCrest;
        varying float vShoreDist;

        // Approximate Embarcadero shoreline signed distance (positive = Bay, negative = inland)
        float shorelineDist(float east, float north) {
          float shoreEast = (north >= 0.0)
            ? (55.0 - 0.52 * north - 0.00006 * north * north)
            : (55.0 + 0.88 * min(-north, 650.0) - 0.52 * max(0.0, -north - 650.0));
          return east - shoreEast;
        }

        void main() {
          // PlaneGeometry is in XY before rotation; after -PI/2 X rotation:
          // worldPos.x = East, worldPos.z = -North
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          float east = worldPos.x;
          float north = -worldPos.z;
          float sDist = shorelineDist(east, north);

          // Gentle ambient bay ripples
          float ripple = sin(east * 0.025 + uTime * 1.1) * cos(north * 0.025 - uTime * 0.85) * 0.14;
          float yHeight = 0.05 + ripple;
          float crestFactor = 0.0;

          if (uWaveProgress > 0.001) {
            // Front moves from Bay (sDist = +650) inland to sDist = -420
            float frontPos = mix(650.0, -420.0, clamp(uWaveProgress * 1.25, 0.0, 1.0));
            // Behind the front (towards the bay), water level rises up to uSurgeHeight (e.g., 4.6m)
            float behindFront = smoothstep(frontPos - 140.0, frontPos + 90.0, sDist);
            // Pronounced wave crest right along the advancing front
            float crestBand = exp(-pow((sDist - frontPos) / 75.0, 2.0));
            crestFactor = crestBand * clamp(uSurgeHeight / 4.0, 0.0, 1.0);

            yHeight += behindFront * uSurgeHeight + crestBand * (1.85 * (uSurgeHeight / 4.2));
          } else {
            // When idle, keep inland water surface slightly below ground (-0.8m) so dry land never z-fights
            if (sDist < -15.0) {
              yHeight = -1.2;
            }
          }

          worldPos.y = yHeight;
          vWorldPos = worldPos.xyz;
          vSurgeCrest = crestFactor;
          vShoreDist = sDist;

          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uWaveProgress;
        uniform float uSurgeHeight;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFloodTint;
        uniform vec3 uFoamColor;
        uniform vec3 uFogColor;

        varying vec3 vWorldPos;
        varying float vSurgeCrest;
        varying float vShoreDist;

        void main() {
          // Discard submerged inland water plane where it sits beneath dry terrain
          if (uWaveProgress <= 0.005 && vShoreDist < -8.0) {
            discard;
          }
          if (uWaveProgress > 0.005) {
            float frontPos = mix(650.0, -420.0, clamp(uWaveProgress * 1.25, 0.0, 1.0));
            if (vShoreDist < frontPos - 95.0) {
              discard;
            }
          }

          // Depth gradient from shallow waterfront to deep SF Bay channel
          float depthFactor = clamp(vShoreDist / 650.0, 0.0, 1.0);
          vec3 waterCol = mix(uShallowColor, uDeepColor, depthFactor);

          // Subtle animated caustic / wave sheen pattern
          float wavePattern = sin(vWorldPos.x * 0.045 + uTime * 1.3) * cos(vWorldPos.z * 0.045 - uTime * 1.0);
          waterCol = mix(waterCol, uFoamColor, smoothstep(0.65, 0.98, wavePattern) * 0.14);

          // During surge inundation over land (vShoreDist < 10), tint toward flood blue-teal
          if (vShoreDist < 15.0 && uWaveProgress > 0.01) {
            waterCol = mix(waterCol, uFloodTint, 0.42);
          }

          // White foam along shoreline and advancing tsunami wave crest
          float shoreFoam = exp(-pow(vShoreDist / 16.0, 2.0)) * 0.28;
          float totalFoam = clamp(shoreFoam + vSurgeCrest * 0.65, 0.0, 0.85);
          waterCol = mix(waterCol, uFoamColor, totalFoam);

          // Radial haze at the 1-mile district edge
          float radialDist = length(vWorldPos.xz);
          float fogFactor = smoothstep(1450.0, 1900.0, radialDist);
          vec3 finalColor = mix(waterCol, uFogColor, fogFactor);

          float alpha = mix(0.84, 0.93, depthFactor);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
    });
  }, []);

  useFrame(({ clock: threeClock }) => {
    const state = useSimulationStore.getState();
    material.wireframe = state.wireframe;
    material.uniforms.uTime.value = threeClock.getElapsedTime();

    if (
      (state.phase === 'playing' || state.phase === 'analysis_done') &&
      state.isShaderProof
    ) {
      // In the 20-second Shader Proof ('P' key):
      // 0..8.0s: Earthquake shaking
      // 8.0..16.5s: Wave surge advances from Bay across Embarcadero & low waterfront
      // 16.5..20.0s: Peak inundation holds and begins slow recession
      const simT = state.clock;
      if (simT >= 7.8) {
        const waveT = Math.min(1.0, (simT - 7.8) / 7.5);
        const recede = simT > 16.8 ? Math.max(0.65, 1.0 - (simT - 16.8) * 0.08) : 1.0;
        material.uniforms.uWaveProgress.value = waveT;
        material.uniforms.uSurgeHeight.value = 4.4 * Math.sin(waveT * Math.PI * 0.5) * recede;
      } else {
        material.uniforms.uWaveProgress.value = 0.0;
        material.uniforms.uSurgeHeight.value = 0.0;
      }
    } else {
      material.uniforms.uWaveProgress.value = 0.0;
      material.uniforms.uSurgeHeight.value = 0.0;
    }
  });

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      material={material}
    >
      <planeGeometry args={[3600, 3600, 140, 140]} />
    </mesh>
  );
}
