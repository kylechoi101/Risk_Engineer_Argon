import * as THREE from 'three';

const hash = (x, y, s = 1337) => {
  let h = Math.imul(x ^ s, 374761393) + Math.imul(y ^ s, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const noise2D = (x, y, s = 1337) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

const fbm = (x, y, s) => noise2D(x, y, s) * 0.55 + noise2D(x * 2.1, y * 2.1, s + 17) * 0.3 + noise2D(x * 4.3, y * 4.3, s + 31) * 0.15;

const mkTex = (w, h, fn, repeat = [1, 1]) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};

export function makeSurfaceTextures() {
  const land = mkTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(x / 24, y / 24, 101), g = (x % 32 < 2 || y % 32 < 2) ? 0.82 : 1;
      const i = (y * w + x) * 4, v = (36 + n * 42) * g;
      d[i] = v * 0.95; d[i + 1] = v * 1.02; d[i + 2] = v * 1.12; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [0.006, 0.006]);

  const sea = mkTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(x / 18, y / 10, 202), r = Math.pow(noise2D(x / 6, y / 14, 303), 3);
      const i = (y * w + x) * 4;
      d[i] = 8 + n * 20 + r * 50; d[i + 1] = 34 + n * 57 + r * 75; d[i + 2] = 64 + n * 84 + r * 92; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [18, 18]);

  const facade = mkTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#607782'; ctx.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 16) for (let x = 4; x < w; x += 12) {
      const lit = hash(x, y, 404) > 0.38;
      ctx.fillStyle = lit ? (hash(x, y, 505) > 0.2 ? '#bdd5d9' : '#ffd28a') : '#314b59';
      ctx.fillRect(x, y, 7, 10);
    }
  }, [0.035, 0.08]);

  return { land, sea, facade };
}

export function createDisasterEffects({ scene, coastline = [], nodePositions = {} }) {
  const root = new THREE.Group();
  root.name = 'DisasterEffectsLayer';
  scene.add(root);

  const ringTex = mkTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(255,90,30,0)');
    g.addColorStop(0.55, 'rgba(255,140,40,0.85)');
    g.addColorStop(0.78, 'rgba(255,220,140,0.95)');
    g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });

  const waveTex = mkTex(256, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,245,255,0)');
    g.addColorStop(0.35, 'rgba(80,250,255,0.85)');
    g.addColorStop(0.55, 'rgba(225,255,255,1)');
    g.addColorStop(1, 'rgba(0,150,220,0.15)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let x = 0; x < w; x += 6) ctx.fillRect(x, h * 0.35 + fbm(x / 10, 1, 77) * 14, 4, 5);
  }, [8, 1]);

  const epi = new THREE.Vector3(-450, 5.4, -250);
  const ringGeo = new THREE.RingGeometry(0.68, 1.0, 64);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 3 }, (_, i) => {
    const mat = new THREE.MeshBasicMaterial({
      map: ringTex, color: 0xff9a44, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.copy(epi).setY(5.35 + i * 0.05);
    root.add(m);
    return { m, mat, delay: i * 0.55 };
  });

  const pts = (coastline.length >= 2 ? coastline : [[-1200, 1400], [-400, 650], [0, 0], [550, -650], [1300, -1350]])
    .map(([e, n]) => new THREE.Vector3(e, 5.2, -n));
  const curve = new THREE.CatmullRomCurve3(pts);
  const cPts = curve.getPoints(80);
  const normals = cPts.map((p, i) => {
    const a = cPts[Math.max(0, i - 1)], b = cPts[Math.min(cPts.length - 1, i + 1)];
    const t = b.clone().sub(a).setY(0).normalize();
    // Coastline points run north to south; this normal points inland, toward west SF.
    return new THREE.Vector3(-t.z, 0, t.x);
  });

  const buildStrip = (w0, w1, y0, y1) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < cPts.length; i++) {
      const p = cPts[i], n = normals[i], u = i / (cPts.length - 1);
      pos.push(p.x + n.x * w0, y0, p.z + n.z * w0, p.x + n.x * w1, y1, p.z + n.z * w1);
      uv.push(u * 8, 0, u * 8, 1);
      if (i < cPts.length - 1) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  const floodGeo = buildStrip(-120, 1, 4.9, 5.35);
  const floodBase = floodGeo.attributes.position.array.slice();
  const floodMat = new THREE.MeshStandardMaterial({
    map: waveTex, color: 0x00d8ff, emissive: 0x00587a, emissiveIntensity: 0.7,
    transparent: true, opacity: 0, roughness: 0.25, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide
  });
  const floodMesh = new THREE.Mesh(floodGeo, floodMat);
  root.add(floodMesh);

  const crestGeo = new THREE.TubeGeometry(curve, 72, 9, 8, false);
  const crestMat = new THREE.MeshBasicMaterial({
    map: waveTex, color: 0x66ffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const crestMesh = new THREE.Mesh(crestGeo, crestMat);
  root.add(crestMesh);

  const entries = Object.entries(nodePositions);
  const nCount = Math.max(1, entries.length);
  const beaconGeo = new THREE.CylinderGeometry(11, 24, 125, 12, 1, true);
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xff6a00, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, nCount);
  beacons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const plumeGeo = new THREE.SphereGeometry(17, 10, 8);
  const plumeMat = new THREE.MeshStandardMaterial({
    color: 0x2a2625, emissive: 0xff4500, emissiveIntensity: 0.55, transparent: true, opacity: 0.72, depthWrite: false, roughness: 0.95
  });
  const plumes = new THREE.InstancedMesh(plumeGeo, plumeMat, nCount * 3);
  plumes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(beacons, plumes);

  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < nCount; i++) beacons.setColorAt(i, white);
  for (let i = 0; i < nCount * 3; i++) plumes.setColorAt(i, white);

  const nodes = entries.map(([id, [e, n]], i) => {
    const d = Math.hypot(e - epi.x, -n - epi.z);
    return { id, x: e, z: -n, i, seed: hash(i * 19, Math.round(e), 909), dist: d, prob: 0.5, tFail: 4.5 };
  });

  let scen = { magnitude: 7.2, surge: 2.5, probabilities: {} };
  let t = 0, playing = false, shake = 0;
  const dummy = new THREE.Object3D(), col = new THREE.Color();

  const applyScenario = () => {
    const magFactor = THREE.MathUtils.clamp((scen.magnitude - 5) / 3.5, 0.15, 1.3);
    nodes.forEach((nd) => {
      const p = scen.probabilities?.[nd.id] ?? THREE.MathUtils.clamp(0.25 + magFactor * 0.45 + (1 - Math.min(nd.dist / 2600, 1)) * 0.25, 0.05, 0.98);
      nd.prob = p;
      nd.tFail = 3.6 + Math.min(nd.dist / 2400, 1) * 3.2 + (1 - p) * 2.1 + nd.seed * 0.7;
    });
  };

  function setScenario({ magnitude = 7.2, surge = 2.5, probabilities = {} } = {}) {
    scen = { magnitude, surge, probabilities };
    applyScenario();
  }

  function play() { playing = true; }
  function pause() { playing = false; }
  function replay() { t = 0; playing = true; }

  function update(delta = 0.016, elapsed = 0) {
    if (playing) {
      t = Math.min(10, t + Math.min(Math.max(delta, 0), 0.1));
      if (t >= 10) playing = false;
    }
    const mag = THREE.MathUtils.clamp((scen.magnitude - 4.8) / 3.7, 0.1, 1.35);
    const surgeM = THREE.MathUtils.clamp(scen.surge / 3.5, 0, 1.8);

    const qEnv = t < 4.5 ? Math.sin(Math.min(1, t / 0.45) * Math.PI * 0.5) * Math.pow(1 - t / 4.5, 1.35) : 0;
    shake = qEnv * mag * 7.5;
    root.position.set(Math.sin(t * 47) * shake * 0.35, Math.cos(t * 59) * shake * 0.18, Math.sin(t * 53 + 1.2) * shake * 0.35);

    rings.forEach(({ m, mat, delay }, i) => {
      const lt = t - delay;
      if (lt > 0 && lt < 4.2) {
        const p = lt / 4.2, r = 45 + p * (1750 + mag * 900);
        m.visible = true;
        m.scale.set(r, 1, r);
        mat.opacity = Math.sin(p * Math.PI) * (1 - p * 0.45) * Math.min(1, mag * 0.95);
        m.rotation.y = lt * (0.4 - i * 0.12);
      } else m.visible = false;
    });

    const wEnv = surgeM > 0 && t > 1.8 ? THREE.MathUtils.smoothstep(t, 1.8, 5.6) * (1 - 0.18 * THREE.MathUtils.smoothstep(t, 8.2, 10)) : 0;
    const inland = surgeM * 360 * wEnv;
    const pos = floodGeo.attributes.position.array;
    for (let i = 0; i < cPts.length; i++) {
      const k = (i * 2 + 1) * 3, n = normals[i];
      const ripple = Math.sin(t * 4.2 + i * 0.35) * 14 * wEnv;
      pos[k] = floodBase[k] + n.x * (inland + ripple);
      pos[k + 1] = 5.35 + surgeM * 0.9 * wEnv + Math.cos(t * 5.5 + i * 0.5) * 0.25 * wEnv;
      pos[k + 2] = floodBase[k + 2] + n.z * (inland + ripple);
    }
    floodGeo.attributes.position.needsUpdate = true;
    waveTex.offset.x = -t * 0.45;
    waveTex.offset.y = -t * 0.22;
    floodMat.opacity = Math.min(0.78, wEnv * (0.42 + surgeM * 0.26));

    const cAdv = inland * 0.72;
    crestMesh.position.set(-cAdv * 0.55, 5.2 + wEnv * surgeM * 0.8, -cAdv * 0.45);
    crestMesh.scale.set(1, 0.4 + wEnv * surgeM * 1.15, 1);
    crestMat.opacity = Math.min(0.95, wEnv * (0.55 + surgeM * 0.35));

    nodes.forEach((nd, idx) => {
      const active = nd.prob >= 0.18 && t >= nd.tFail;
      const a = active ? Math.min(1, (t - nd.tFail) / 0.65) : 0;
      const pulse = active ? 0.65 + 0.35 * Math.sin((t + nd.seed) * (8 + nd.prob * 10)) : 0;
      if (a > 0.001) {
        const s = (0.65 + nd.prob * 0.95) * a * (0.85 + pulse * 0.35);
        dummy.position.set(nd.x, 5 + 62.5 * s, nd.z);
        dummy.scale.set(s, s * (0.9 + pulse * 0.5), s);
        dummy.rotation.set(0, t * 1.8 + nd.seed * 6, 0);
        dummy.updateMatrix();
        beacons.setMatrixAt(idx, dummy.matrix);
        col.setHSL(0.08 - nd.prob * 0.065, 1.0, 0.5 + pulse * 0.2);
        beacons.setColorAt(idx, col);
      } else {
        dummy.position.set(0, -500, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
        beacons.setMatrixAt(idx, dummy.matrix);
      }
      for (let p = 0; p < 3; p++) {
        const pi = idx * 3 + p;
        if (a > 0.001) {
          const cyc = (t * (0.75 + p * 0.18) + nd.seed + p * 0.33) % 1;
          const rad = (0.45 + cyc * 1.45) * (0.6 + nd.prob * 0.7) * a;
          dummy.position.set(nd.x + Math.sin(t * 2 + p * 2.1 + nd.seed * 5) * 9 * cyc, 8 + cyc * (42 + nd.prob * 36), nd.z + Math.cos(t * 2.3 + p) * 9 * cyc);
          dummy.scale.setScalar(rad);
          dummy.updateMatrix();
          plumes.setMatrixAt(pi, dummy.matrix);
          col.setHSL(0.055, 0.85 - cyc * 0.65, 0.48 - cyc * 0.3);
          plumes.setColorAt(pi, col);
        } else {
          dummy.position.set(0, -500, 0); dummy.scale.setScalar(0.001); dummy.updateMatrix();
          plumes.setMatrixAt(pi, dummy.matrix);
        }
      }
    });
    beacons.instanceMatrix.needsUpdate = true;
    plumes.instanceMatrix.needsUpdate = true;
    if (beacons.instanceColor) beacons.instanceColor.needsUpdate = true;
    if (plumes.instanceColor) plumes.instanceColor.needsUpdate = true;
    return { timeline: t, cameraShake: shake, floodReachMeters: inland, playing };
  }

  function dispose() {
    scene.remove(root);
    [ringGeo, floodGeo, crestGeo, beaconGeo, plumeGeo, ringTex, waveTex, floodMat, crestMat, beaconMat, plumeMat, ...rings.map(r => r.mat)].forEach(x => x?.dispose?.());
  }

  applyScenario();
  return { setScenario, play, pause, replay, update, dispose };
}
export default createDisasterEffects;
