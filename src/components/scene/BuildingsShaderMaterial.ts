import * as THREE from 'three';
import { THEME } from '../../config/theme';

export const DATA_TEX_SIZE = 64; // 64 x 64 = 4,096 building slots

/**
 * Create the 64x64 RGBA Float DataTexture storing per-building state:
 *   R = target damage state (0..4)
 *   G = onset_s (seconds)
 *   B = dominant_mode (0 = shaking, 1 = flood)
 *   A = highlight flag (0 = normal, 1 = sidebar group highlight)
 */
export function createBuildingStateTexture(): THREE.DataTexture {
  const data = new Float32Array(DATA_TEX_SIZE * DATA_TEX_SIZE * 4);
  // Default onset_s to 9999 so no damage triggers when idle
  for (let i = 0; i < DATA_TEX_SIZE * DATA_TEX_SIZE; i++) {
    data[i * 4 + 0] = 0; // state 0
    data[i * 4 + 1] = 9999.0; // onset_s
    data[i * 4 + 2] = 0; // mode
    data[i * 4 + 3] = 0; // highlight
  }

  const tex = new THREE.DataTexture(
    data,
    DATA_TEX_SIZE,
    DATA_TEX_SIZE,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Populate the DataTexture in-place from state arrays and mark needsUpdate = true.
 */
export function updateBuildingStateTexture(
  tex: THREE.DataTexture,
  states: ArrayLike<number>,
  onsetS: ArrayLike<number>,
  modes: ArrayLike<number>,
  highlightedIds?: Set<number>
): void {
  const data = tex.image.data as unknown as Float32Array;
  const count = Math.min(states.length, DATA_TEX_SIZE * DATA_TEX_SIZE);

  for (let i = 0; i < count; i++) {
    const base = i * 4;
    data[base + 0] = states[i];
    data[base + 1] = onsetS[i];
    data[base + 2] = modes[i];
    data[base + 3] = highlightedIds?.has(i) ? 1.0 : 0.0;
  }
  tex.needsUpdate = true;
}

/**
 * Reset all buildings in DataTexture back to undamaged state 0.
 */
export function resetBuildingStateTexture(tex: THREE.DataTexture): void {
  const data = tex.image.data as unknown as Float32Array;
  const total = DATA_TEX_SIZE * DATA_TEX_SIZE;
  for (let i = 0; i < total; i++) {
    const base = i * 4;
    data[base + 0] = 0.0;
    data[base + 1] = 9999.0;
    data[base + 2] = 0.0;
    data[base + 3] = 0.0;
  }
  tex.needsUpdate = true;
}

/**
 * Update ONLY the highlight flag channel (A) for sidebar hover_building_ids.
 */
export function updateBuildingHighlightChannel(
  tex: THREE.DataTexture,
  highlightedIds: Set<number> | null,
  buildingCount: number
): void {
  const data = tex.image.data as unknown as Float32Array;
  const count = Math.min(buildingCount, DATA_TEX_SIZE * DATA_TEX_SIZE);
  for (let i = 0; i < count; i++) {
    data[i * 4 + 3] = highlightedIds && highlightedIds.has(i) ? 1.0 : 0.0;
  }
  tex.needsUpdate = true;
}

/**
 * Create the one-draw-call custom ShaderMaterial for the entire district's buildings.
 */
export function createBuildingsShaderMaterial(
  stateTexture: THREE.DataTexture
): THREE.ShaderMaterial {
  const c0 = new THREE.Color(THEME.damageRamp[0]);
  const c1 = new THREE.Color(THEME.damageRamp[1]);
  const c2 = new THREE.Color(THEME.damageRamp[2]);
  const c3 = new THREE.Color(THEME.damageRamp[3]);
  const c4 = new THREE.Color(THEME.damageRamp[4]);
  const cFlood = new THREE.Color(THEME.overlays.floodTint);
  const cHighlight = new THREE.Color(THEME.overlays.hoverHighlight);
  const cFog = new THREE.Color(THEME.scene.fogColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      uStateTex: { value: stateTexture },
      uTexSize: { value: DATA_TEX_SIZE },
      uClock: { value: 0.0 },
      uIsPlaying: { value: 0.0 },
      uShakeAmp: { value: 0.0 },
      uWaveProgress: { value: 0.0 },
      uHoveredBuildingId: { value: -1.0 },
      uColor0: { value: c0 },
      uColor1: { value: c1 },
      uColor2: { value: c2 },
      uColor3: { value: c3 },
      uColor4: { value: c4 },
      uFloodColor: { value: cFlood },
      uHighlightColor: { value: cHighlight },
      uFogColor: { value: cFog },
      uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.32).normalize() },
    },
    vertexShader: /* glsl */ `
      attribute float aBuildingId;
      attribute float aBaseElev;
      attribute float aBHeight;
      attribute vec2 aCentroid;

      uniform sampler2D uStateTex;
      uniform float uTexSize;
      uniform float uClock;
      uniform float uIsPlaying;
      uniform float uShakeAmp;
      uniform float uWaveProgress;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vBuildingId;
      varying float vDamageState;
      varying float vDamageProgress;
      varying float vDominantMode;
      varying float vHighlight;
      varying float vRelHeight;
      varying float vNormHeight;
      varying float vBaseElev;
      varying vec2 vCentroid;

      // Deterministic hash from buildingId
      float hash11(float p) {
        p = fract(p * 0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
      }

      void main() {
        float bId = floor(aBuildingId + 0.5);
        float col = mod(bId, uTexSize);
        float row = floor(bId / uTexSize);
        vec2 uv = (vec2(col, row) + 0.5) / uTexSize;

        vec4 stateData = texture2D(uStateTex, uv);
        float targetState = stateData.r;
        float onsetS = stateData.g;
        float domMode = stateData.b;
        float highlightFlag = stateData.a;

        // Smooth transition from 0 -> 1 over 2.2 seconds after onset_s
        float dmgProg = 0.0;
        if (uIsPlaying > 0.5 && uClock >= onsetS) {
          dmgProg = clamp((uClock - onsetS) / 2.2, 0.0, 1.0);
        }

        vec3 pos = position;
        vec3 norm = normal;

        float relY = max(0.0, pos.y - aBaseElev);
        float safeH = max(aBHeight, 4.0);
        float normY = clamp(relY / safeH, 0.0, 1.0);

        float seed = hash11(bId + 17.0);
        float seed2 = hash11(bId * 3.17 + 5.0);
        float anglePhase = seed * 6.2831853;

        // 1. Earthquake Ground Shake + Height-Dependent Building Sway
        if (uShakeAmp > 0.001) {
          float freq = 5.5 + seed * 4.5;
          float swayMag = pow(normY, 1.35) * (0.35 + safeH * 0.022) * uShakeAmp;
          // Amplify sway slightly for damaged buildings
          swayMag *= (1.0 + 0.25 * targetState * dmgProg);
          float groundJitter = 0.18 * uShakeAmp;

          pos.x += (sin(uClock * freq + anglePhase) * swayMag) + sin(uClock * 19.0 + seed * 12.0) * groundJitter;
          pos.z += (cos(uClock * (freq * 0.87) + anglePhase) * swayMag) + cos(uClock * 17.0 + seed2 * 12.0) * groundJitter;
        }

        // 2. State 3 (Extensive Damage): Permanent Tilt & Slight Sink
        if (targetState > 2.5 && targetState < 3.5 && dmgProg > 0.001) {
          float easeTilt = smoothstep(0.0, 1.0, dmgProg);
          float tiltAngle = 0.085 * easeTilt; // ~4.8 degrees
          vec2 tiltDir = vec2(cos(anglePhase), sin(anglePhase));
          pos.x += relY * sin(tiltAngle) * tiltDir.x;
          pos.z += relY * sin(tiltAngle) * tiltDir.y;
          pos.y -= (0.65 * easeTilt) + relY * (1.0 - cos(tiltAngle));
        }

        // 3. State 4 (Complete / Collapse): Vertical Squash, Base Flare & Sink
        if (targetState >= 3.5 && dmgProg > 0.001) {
          // Smooth ease-in-out collapse over 1.8s
          float collapseT = smoothstep(0.0, 0.85, dmgProg);
          // Squash vertical height down to 20% of original height
          float squashFactor = mix(1.0, 0.18, collapseT);
          float newRelY = relY * squashFactor;

          // Slight outward rubble flare near base + directional lean
          vec2 fromCenter = vec2(pos.x - aCentroid.x, pos.z - (-aCentroid.y));
          float flare = 1.0 + 0.16 * collapseT * (1.0 - normY * 0.5);
          vec2 leanOffset = vec2(cos(anglePhase), sin(anglePhase)) * (normY * 2.8 * collapseT);

          pos.x = aCentroid.x + fromCenter.x * flare + leanOffset.x;
          pos.z = (-aCentroid.y) + fromCenter.y * flare + leanOffset.y;
          pos.y = aBaseElev + newRelY - (1.1 * collapseT);
        }

        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * norm);
        vBuildingId = bId;
        vDamageState = targetState;
        vDamageProgress = dmgProg;
        vDominantMode = domMode;
        vHighlight = highlightFlag;
        vRelHeight = relY;
        vNormHeight = normY;
        vBaseElev = aBaseElev;
        vCentroid = aCentroid;

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor0;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform vec3 uColor3;
      uniform vec3 uColor4;
      uniform vec3 uFloodColor;
      uniform vec3 uHighlightColor;
      uniform vec3 uFogColor;
      uniform vec3 uSunDir;
      uniform float uHoveredBuildingId;
      uniform float uWaveProgress;
      uniform float uClock;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vBuildingId;
      varying float vDamageState;
      varying float vDamageProgress;
      varying float vDominantMode;
      varying float vHighlight;
      varying float vRelHeight;
      varying float vNormHeight;
      varying float vBaseElev;
      varying vec2 vCentroid;

      vec3 sampleDamageRamp(float stateVal) {
        if (stateVal <= 1.0) {
          return mix(uColor0, uColor1, clamp(stateVal, 0.0, 1.0));
        } else if (stateVal <= 2.0) {
          return mix(uColor1, uColor2, clamp(stateVal - 1.0, 0.0, 1.0));
        } else if (stateVal <= 3.0) {
          return mix(uColor2, uColor3, clamp(stateVal - 2.0, 0.0, 1.0));
        } else {
          return mix(uColor3, uColor4, clamp(stateVal - 3.0, 0.0, 1.0));
        }
      }

      void main() {
        // Effective animated damage state (0..4)
        float effectiveState = vDamageState * vDamageProgress;
        vec3 baseColor = sampleDamageRamp(effectiveState);

        // Subtle architectural story banding on vertical walls
        float isWall = 1.0 - abs(vNormal.y);
        if (isWall > 0.35) {
          float floorBand = smoothstep(0.78, 0.92, fract(vRelHeight / 3.8));
          baseColor *= (1.0 - 0.045 * floorBand);
        }

        // Flood blue-teal tint overlay for flood-mode buildings or inundated low-elevation bases
        float shorelineSigned = vCentroid.x * 0.78 + vCentroid.y * 0.62;
        bool isFloodedBuilding = (vDominantMode > 0.5 && vDamageProgress > 0.01);
        float waveReach = uWaveProgress * 520.0 - 140.0;
        bool isInWaveZone = (uWaveProgress > 0.01 && vBaseElev < 5.0 && shorelineSigned > -waveReach);

        if (isFloodedBuilding || isInWaveZone) {
          float waterLineFactor = 1.0 - smoothstep(0.0, 14.0, vRelHeight);
          float floodStrength = isFloodedBuilding
            ? mix(0.32, 0.72, waterLineFactor) * vDamageProgress
            : mix(0.15, 0.52, waterLineFactor) * clamp(uWaveProgress, 0.0, 1.0);
          baseColor = mix(baseColor, uFloodColor, clamp(floodStrength, 0.0, 0.78));
        }

        // Soft daylight lighting (directional sun + warm sky hemisphere + base AO)
        float ndl = max(0.0, dot(vNormal, uSunDir));
        float hemi = 0.5 + 0.5 * vNormal.y;
        float ao = mix(0.84, 1.0, clamp(vRelHeight / 18.0, 0.0, 1.0));
        float lighting = (0.58 + 0.34 * ndl + 0.14 * hemi) * ao;
        vec3 litColor = baseColor * lighting;

        // Hover Highlight (either 3D hovered building or sidebar weak-point group hover)
        bool isHovered3D = abs(vBuildingId - uHoveredBuildingId) < 0.25;
        bool isGroupHighlighted = vHighlight > 0.5;
        if (isHovered3D || isGroupHighlighted) {
          float pulse = 0.55 + 0.2 * sin(uClock * 6.0);
          litColor = mix(litColor, uHighlightColor * 1.25, isHovered3D ? 0.55 : pulse);
          // Subtle top/rim highlight
          litColor += vec3(0.08, 0.16, 0.15);
        }

        // Radial distance haze at the 1-mile (1609m) edge so the scene blends softly into the sky
        float radialDist = length(vWorldPos.xz);
        float fogFactor = smoothstep(1480.0, 1920.0, radialDist);
        vec3 finalColor = mix(litColor, uFogColor, fogFactor);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
}
