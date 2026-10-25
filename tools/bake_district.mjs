#!/usr/bin/env node
/**
 * District Bake Pipeline (tools/bake_district.mjs)
 *
 * Generates:
 *   1. /public/models/district.glb — Binary glTF 2.0 scene containing:
 *      - "Terrain" mesh (elevation + bathymetry in local ENU -> Three.js frame)
 *      - "Waterfront" mesh (Embarcadero seawall, 18 finger piers, street grid)
 *      - "BayBridge" mesh (Western suspension span inside the 1609 m radius)
 *      - "Buildings" mesh (SINGLE merged mesh of all ~2,850 buildings with custom
 *        vertex attributes _BUILDINGID, _BASEELEV, _BHEIGHT, _CENTROID for 1-draw-call
 *        GPU damage + flood shader rendering)
 *   2. /public/data/buildings.json — Per-building metadata & data_quality report.
 *
 * If tools/cache/datasf_buildings.geojson exists (from tools/fetch_real_data.py) and
 * --placeholder is not passed, bakes real DataSF footprints. Otherwise generates a
 * clearly labeled PROCEDURAL PLACEHOLDER district of ~2,850 buildings around the
 * Ferry Building (0, 0, 0).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const ORIGIN_LAT = 37.7955;
const ORIGIN_LON = -122.3937;
const DISTRICT_RADIUS_M = 1609;
const METERS_PER_DEG_LAT = 111132.92;
const METERS_PER_DEG_LON = 111412.84 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

// Deterministic seeded PRNG (Mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Signed distance from the Embarcadero shoreline in local ENU (east, north).
 * Positive = in San Francisco Bay (water); Negative = inland (land).
 */
function shorelineSignedDistance(east, north) {
  // Piecewise-smooth approximation of SF's northeast Embarcadero curvature:
  // At north = +1300 (Pier 35/39): shoreline is around east = -720
  // At north = +600 (Pier 15/17): shoreline is around east = -240
  // At north = 0 (Ferry Building): shoreline is at east = +55
  // At north = -600 (Rincon Point / Bay Bridge): shoreline is at east = +440
  // At north = -1300 (South Beach / Pier 40): shoreline curves back to east = +190
  let shoreEast;
  if (north >= 0) {
    shoreEast = 55 - 0.52 * north - 0.00006 * north * north;
  } else {
    const nAbs = -north;
    shoreEast = 55 + 0.88 * Math.min(nAbs, 650) - 0.52 * Math.max(0, nAbs - 650);
  }
  return east - shoreEast;
}

/**
 * Compute terrain / bathymetry elevation (meters above sea level = 0 m)
 * at local ENU (east, north).
 */
function sampleElevation(east, north) {
  const bayDist = shorelineSignedDistance(east, north);

  if (bayDist > 12) {
    // San Francisco Bay bathymetry (-2.5m near seawall sloping to -14m offshore)
    const depth = -2.2 - Math.min(12.0, Math.pow((bayDist - 12) / 180, 0.85) * 3.8);
    return depth;
  }

  // Smooth transition right at the seawall edge (0 .. 12m)
  if (bayDist > 0) {
    const t = bayDist / 12;
    return 2.4 * (1 - t) + -2.2 * t;
  }

  const inlandDist = -bayDist;
  // Base coastal flat (Embarcadero / historic Bay fill zone: 2.2m to 4.5m)
  let elev = 2.3 + Math.min(3.5, inlandDist * 0.0032);

  // 1. Telegraph Hill (NW: centered around east = -680, north = +1020, peak ~82m)
  const dTelegraph = Math.hypot((east - -680) / 360, (north - 1020) / 340);
  if (dTelegraph < 1.8) {
    elev += 76 * Math.exp(-dTelegraph * dTelegraph * 1.45);
  }

  // 2. Nob Hill / Russian Hill eastern flank (W/NW: east = -1480, north = +320, rises to ~74m)
  const dNob = Math.hypot((east - -1520) / 620, (north - 280) / 780);
  if (dNob < 1.8) {
    elev += 68 * Math.exp(-dNob * dNob * 1.1);
  }

  // 3. Rincon Hill (S/SE: centered around east = +80, north = -680, peak ~32m)
  const dRincon = Math.hypot((east - 80) / 380, (north - -680) / 310);
  if (dRincon < 1.7) {
    elev += 27 * Math.exp(-dRincon * dRincon * 1.35);
  }

  // 4. Market Street corridor remains a gentle low valley running SW from (0, 0)
  // Direction vector SW along Market St: (-0.76, -0.65)
  const marketProj = east * -0.76 + north * -0.65;
  const marketPerp = Math.abs(east * -0.65 - north * 0.76);
  if (marketProj > 0 && marketPerp < 220) {
    const valleyFactor = (1 - marketPerp / 220) * 0.35;
    elev = elev * (1 - valleyFactor) + 3.2 * valleyFactor;
  }

  return elev;
}

/**
 * Geometry Builder Helper for standard meshes (Terrain, Waterfront, BayBridge)
 * with POSITION, NORMAL, COLOR_0.
 */
class ColoredMeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }

  addVertex(x, y, z, nx, ny, nz, r, g, b) {
    const idx = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(r, g, b);
    return idx;
  }

  addQuad(p0, p1, p2, p3, normal, color) {
    const [nx, ny, nz] = normal;
    const [r, g, b] = color;
    const i0 = this.addVertex(p0[0], p0[1], p0[2], nx, ny, nz, r, g, b);
    const i1 = this.addVertex(p1[0], p1[1], p1[2], nx, ny, nz, r, g, b);
    const i2 = this.addVertex(p2[0], p2[1], p2[2], nx, ny, nz, r, g, b);
    const i3 = this.addVertex(p3[0], p3[1], p3[2], nx, ny, nz, r, g, b);
    this.indices.push(i0, i1, i2, i0, i2, i3);
  }

  /**
   * Add an oriented box centered at (cx, baseY, cz) in Three.js coords with given width (X),
   * height (Y), depth (Z), and yaw angle around +Y.
   */
  addOrientedBox(cx, baseY, cz, width, height, depth, angleRad, color, includeBottom = false) {
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    const hw = width * 0.5;
    const hd = depth * 0.5;

    const localCorners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    const worldXZ = localCorners.map(([lx, lz]) => [
      cx + lx * c - lz * s,
      cz + lx * s + lz * c,
    ]);

    const y0 = baseY;
    const y1 = baseY + height;

    // 4 side walls
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const [x0, z0] = worldXZ[i];
      const [x1, z1] = worldXZ[next];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len;
      const nz = -dx / len;
      this.addQuad(
        [x0, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z0],
        [nx, 0, nz],
        color
      );
    }

    // Roof
    this.addQuad(
      [worldXZ[0][0], y1, worldXZ[0][1]],
      [worldXZ[3][0], y1, worldXZ[3][1]],
      [worldXZ[2][0], y1, worldXZ[2][1]],
      [worldXZ[1][0], y1, worldXZ[1][1]],
      [0, 1, 0],
      color
    );

    if (includeBottom) {
      this.addQuad(
        [worldXZ[0][0], y0, worldXZ[0][1]],
        [worldXZ[1][0], y0, worldXZ[1][1]],
        [worldXZ[2][0], y0, worldXZ[2][1]],
        [worldXZ[3][0], y0, worldXZ[3][1]],
        [0, -1, 0],
        color
      );
    }
  }
}

/**
 * Merged Buildings Geometry Builder.
 * Every vertex stores:
 *   POSITION (VEC3)
 *   NORMAL (VEC3)
 *   _BUILDINGID (SCALAR float32)
 *   _BASEELEV (SCALAR float32)
 *   _BHEIGHT (SCALAR float32)
 *   _CENTROID (VEC2 float32: [east, north])
 */
class MergedBuildingsBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.buildingIds = [];
    this.baseElevs = [];
    this.bHeights = [];
    this.centroids = [];
    this.indices = [];
  }

  addVertex(x, y, z, nx, ny, nz, bId, baseElev, bHeight, cEast, cNorth) {
    const idx = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.buildingIds.push(bId);
    this.baseElevs.push(baseElev);
    this.bHeights.push(bHeight);
    this.centroids.push(cEast, cNorth);
    return idx;
  }

  addBoxPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    partEast,
    partNorth,
    partBaseY,
    width,
    partHeight,
    depth,
    angleRad
  ) {
    const cx = partEast;
    const cz = -partNorth; // ENU -> Three.js (+X = East, -Z = North)
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    const hw = width * 0.5;
    const hd = depth * 0.5;

    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([lx, lz]) => [cx + lx * c - lz * s, cz + lx * s + lz * c]);

    const y0 = partBaseY;
    const y1 = partBaseY + partHeight;

    // 4 walls
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[next];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len;
      const nz = -dx / len;

      const i0 = this.addVertex(x0, y0, z0, nx, 0, nz, bId, baseElev, totalHeight, cEast, cNorth);
      const i1 = this.addVertex(x1, y0, z1, nx, 0, nz, bId, baseElev, totalHeight, cEast, cNorth);
      const i2 = this.addVertex(x1, y1, z1, nx, 0, nz, bId, baseElev, totalHeight, cEast, cNorth);
      const i3 = this.addVertex(x0, y1, z0, nx, 0, nz, bId, baseElev, totalHeight, cEast, cNorth);
      this.indices.push(i0, i1, i2, i0, i2, i3);
    }

    // Roof
    const r0 = this.addVertex(
      corners[0][0],
      y1,
      corners[0][1],
      0,
      1,
      0,
      bId,
      baseElev,
      totalHeight,
      cEast,
      cNorth
    );
    const r1 = this.addVertex(
      corners[3][0],
      y1,
      corners[3][1],
      0,
      1,
      0,
      bId,
      baseElev,
      totalHeight,
      cEast,
      cNorth
    );
    const r2 = this.addVertex(
      corners[2][0],
      y1,
      corners[2][1],
      0,
      1,
      0,
      bId,
      baseElev,
      totalHeight,
      cEast,
      cNorth
    );
    const r3 = this.addVertex(
      corners[1][0],
      y1,
      corners[1][1],
      0,
      1,
      0,
      bId,
      baseElev,
      totalHeight,
      cEast,
      cNorth
    );
    this.indices.push(r0, r1, r2, r0, r2, r3);
  }

  /**
   * Add a pyramidal spire part (used for the Ferry Building clock tower spire and landmark tops).
   */
  addPyramidPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    partEast,
    partNorth,
    partBaseY,
    width,
    spireHeight,
    depth,
    angleRad
  ) {
    const cx = partEast;
    const cz = -partNorth;
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    const hw = width * 0.5;
    const hd = depth * 0.5;

    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([lx, lz]) => [cx + lx * c - lz * s, cz + lx * s + lz * c]);

    const y0 = partBaseY;
    const apex = [cx, partBaseY + spireHeight, cz];

    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[next];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (dz / len) * 0.85;
      const nz = (-dx / len) * 0.85;
      const ny = 0.52;

      const i0 = this.addVertex(x0, y0, z0, nx, ny, nz, bId, baseElev, totalHeight, cEast, cNorth);
      const i1 = this.addVertex(x1, y0, z1, nx, ny, nz, bId, baseElev, totalHeight, cEast, cNorth);
      const i2 = this.addVertex(
        apex[0],
        apex[1],
        apex[2],
        nx,
        ny,
        nz,
        bId,
        baseElev,
        totalHeight,
        cEast,
        cNorth
      );
      this.indices.push(i0, i1, i2);
    }
  }

  /**
   * Extrude an arbitrary 2D ENU polygon ring [(east, north), ...] from baseElev to baseElev + height.
   */
  addExtrudedPolygon(bId, cEast, cNorth, baseElev, height, ringEnu) {
    // Ensure counter-clockwise winding in ENU (East, North)
    let signedArea2 = 0;
    for (let i = 0; i < ringEnu.length; i++) {
      const [x0, y0] = ringEnu[i];
      const [x1, y1] = ringEnu[(i + 1) % ringEnu.length];
      signedArea2 += x0 * y1 - x1 * y0;
    }
    const pts = signedArea2 < 0 ? [...ringEnu].reverse() : ringEnu;
    const y0 = baseElev;
    const y1 = baseElev + height;

    // Walls
    for (let i = 0; i < pts.length; i++) {
      const [e0, n0] = pts[i];
      const [e1, n1] = pts[(i + 1) % pts.length];
      const x0 = e0,
        z0 = -n0;
      const x1 = e1,
        z1 = -n1;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = dz / len;
      const nz = -dx / len;

      const i0 = this.addVertex(x0, y0, z0, nx, 0, nz, bId, baseElev, height, cEast, cNorth);
      const i1 = this.addVertex(x1, y0, z1, nx, 0, nz, bId, baseElev, height, cEast, cNorth);
      const i2 = this.addVertex(x1, y1, z1, nx, 0, nz, bId, baseElev, height, cEast, cNorth);
      const i3 = this.addVertex(x0, y1, z0, nx, 0, nz, bId, baseElev, height, cEast, cNorth);
      this.indices.push(i0, i1, i2, i0, i2, i3);
    }

    // Simple fan triangulation from centroid for roof
    const centerIdx = this.addVertex(
      cEast,
      y1,
      -cNorth,
      0,
      1,
      0,
      bId,
      baseElev,
      height,
      cEast,
      cNorth
    );
    const ringIndices = pts.map(([e, n]) =>
      this.addVertex(e, y1, -n, 0, 1, 0, bId, baseElev, height, cEast, cNorth)
    );
    for (let i = 0; i < ringIndices.length; i++) {
      const next = (i + 1) % ringIndices.length;
      this.indices.push(centerIdx, ringIndices[i], ringIndices[next]);
    }
  }
}

/**
 * 1. Build Terrain Mesh
 */
function buildTerrainMesh() {
  const builder = new ColoredMeshBuilder();
  const gridN = 140;
  const extent = 1780; // Slightly beyond 1609m so edge haze blends cleanly
  const step = (extent * 2) / gridN;

  const vertGrid = [];
  for (let r = 0; r <= gridN; r++) {
    const north = -extent + r * step;
    const row = [];
    for (let c = 0; c <= gridN; c++) {
      const east = -extent + c * step;
      const elev = sampleElevation(east, north);
      row.push({ east, north, elev, x: east, y: elev, z: -north });
    }
    vertGrid.push(row);
  }

  const idxGrid = [];
  for (let r = 0; r <= gridN; r++) {
    const idxRow = [];
    for (let c = 0; c <= gridN; c++) {
      const v = vertGrid[r][c];
      const eL = vertGrid[r][Math.max(0, c - 1)].elev;
      const eR = vertGrid[r][Math.min(gridN, c + 1)].elev;
      const eD = vertGrid[Math.max(0, r - 1)][c].elev;
      const eU = vertGrid[Math.min(gridN, r + 1)][c].elev;

      const dx = (eR - eL) / (2 * step);
      const dz = -(eU - eD) / (2 * step);
      const len = Math.hypot(dx, 1, dz);
      const nx = -dx / len;
      const ny = 1 / len;
      const nz = -dz / len;

      // Color ramp by elevation: bay floor -> low coastal -> warm hill slope
      let col;
      if (v.elev < 0) {
        col = [0.72, 0.77, 0.75]; // Submerged bay floor
      } else {
        const hFactor = Math.min(1, v.elev / 75);
        col = [
          0.875 - hFactor * 0.08,
          0.843 - hFactor * 0.08,
          0.776 - hFactor * 0.09,
        ];
      }

      idxRow.push(builder.addVertex(v.x, v.y, v.z, nx, ny, nz, col[0], col[1], col[2]));
    }
    idxGrid.push(idxRow);
  }

  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const i00 = idxGrid[r][c];
      const i10 = idxGrid[r][c + 1];
      const i01 = idxGrid[r + 1][c];
      const i11 = idxGrid[r + 1][c + 1];
      // Note: r increases North (-Z), c increases East (+X)
      builder.indices.push(i00, i10, i11, i00, i11, i01);
    }
  }

  return builder;
}

/**
 * Compute finger piers along the Embarcadero so both Waterfront deck and Pier Shed buildings align.
 */
function getEmbarcaderoPiers() {
  const pierSpecs = [
    { name: 'Pier 35', north: 1290, len: 250, width: 48 },
    { name: 'Pier 33', north: 1185, len: 230, width: 42 },
    { name: 'Pier 31', north: 1090, len: 235, width: 42 },
    { name: 'Pier 29', north: 995, len: 250, width: 50 },
    { name: 'Pier 27 (Cruise Terminal)', north: 875, len: 310, width: 68 },
    { name: 'Pier 23', north: 740, len: 225, width: 42 },
    { name: 'Pier 19', north: 640, len: 225, width: 42 },
    { name: 'Pier 17', north: 540, len: 245, width: 46 },
    { name: 'Pier 15 (Exploratorium)', north: 435, len: 250, width: 52 },
    { name: 'Pier 9', north: 320, len: 235, width: 44 },
    { name: 'Pier 7', north: 225, len: 210, width: 22, noShed: true },
    { name: 'Pier 5', north: 145, len: 185, width: 38 },
    { name: 'Pier 3', north: 115, len: 205, width: 42 },
    { name: 'Pier 1', north: 65, len: 165, width: 40 },
    { name: 'Pier 14', north: -125, len: 195, width: 20, noShed: true },
    { name: 'Pier 22 1/2', north: -245, len: 180, width: 38 },
    { name: 'Pier 24', north: -340, len: 210, width: 44 },
    { name: 'Pier 26', north: -450, len: 235, width: 46 },
    { name: 'Pier 28', north: -555, len: 230, width: 46 },
    { name: 'Pier 30-32', north: -790, len: 290, width: 95, noShed: true },
    { name: 'Pier 38', north: -1020, len: 240, width: 48 },
    { name: 'Pier 40 (South Beach Harbor)', north: -1140, len: 220, width: 65 },
  ];

  return pierSpecs.map((p) => {
    // Find shore east at this north
    let shoreEast = 0;
    for (let e = -1000; e <= 800; e += 2) {
      if (shorelineSignedDistance(e, p.north) >= 0) {
        shoreEast = e;
        break;
      }
    }
    // Normal direction pointing into the bay
    const shoreEastNext = shoreEast - (shorelineSignedDistance(shoreEast, p.north + 20) - shorelineSignedDistance(shoreEast, p.north - 20)) * 0.5;
    const tangentAngle = Math.atan2(40, shoreEastNext - shoreEast);
    const outAngleEnu = tangentAngle - Math.PI * 0.5;
    // Outward direction into bay (NE / E)
    const dirEast = p.north >= -600 ? 0.85 : 0.92;
    const dirNorth = p.north >= -600 ? 0.52 : 0.25;
    const angleThree = Math.atan2(-dirNorth, dirEast);

    const centerEast = shoreEast + dirEast * (p.len * 0.5 - 8);
    const centerNorth = p.north + dirNorth * (p.len * 0.5 - 8);

    return {
      ...p,
      shoreEast,
      centerEast,
      centerNorth,
      dirEast,
      dirNorth,
      angleThree,
      outAngleEnu,
    };
  });
}

/**
 * 2. Build Waterfront & Roadways Mesh (Seawall edge, finger piers, Embarcadero & Market St)
 */
function buildWaterfrontMesh(piers) {
  const builder = new ColoredMeshBuilder();
  const seawallColor = [0.74, 0.70, 0.63];
  const pierDeckColor = [0.79, 0.75, 0.67];
  const roadColor = [0.81, 0.77, 0.70];

  // 1. Seawall concrete bulkhead & Embarcadero promenade following the shoreline
  const numSteps = 120;
  const nMin = -1580;
  const nMax = 1580;
  for (let i = 0; i < numSteps; i++) {
    const n0 = nMin + ((nMax - nMin) * i) / numSteps;
    const n1 = nMin + ((nMax - nMin) * (i + 1)) / numSteps;
    const nMid = 0.5 * (n0 + n1);

    let eMid = 0;
    for (let e = -1100; e <= 800; e += 2) {
      if (shorelineSignedDistance(e, nMid) >= 0) {
        eMid = e;
        break;
      }
    }
    if (Math.hypot(eMid, nMid) > DISTRICT_RADIUS_M + 120) continue;

    // Seawall coping & Embarcadero roadway strip
    builder.addOrientedBox(
      eMid - 14,
      0.0,
      -nMid,
      32,
      2.55,
      (nMax - nMin) / numSteps + 4,
      pAngleForNorth(nMid),
      seawallColor
    );
    builder.addOrientedBox(
      eMid - 36,
      2.35,
      -nMid,
      26,
      0.35,
      (nMax - nMin) / numSteps + 4,
      pAngleForNorth(nMid),
      roadColor
    );
  }

  // 2. Finger Pier Decks
  for (const pier of piers) {
    if (Math.hypot(pier.centerEast, pier.centerNorth) > DISTRICT_RADIUS_M + 80) continue;
    builder.addOrientedBox(
      pier.centerEast,
      0.8,
      -pier.centerNorth,
      pier.len,
      1.65,
      pier.width,
      pier.angleThree,
      pierDeckColor
    );
  }

  // 3. Market Street Diagonal Corridor (from Ferry Plaza SW to (-1250, -1080))
  const marketLen = 1620;
  const marketAngleThree = Math.atan2(1080, -1250); // SW in Three.js (+Z = South, -X = West)
  builder.addOrientedBox(
    -625,
    2.45,
    540,
    marketLen,
    0.45,
    34,
    marketAngleThree,
    roadColor
  );

  return builder;
}

function pAngleForNorth(north) {
  return north >= 0 ? -0.48 : 0.58;
}

/**
 * 3. Build Western Span of the San Francisco–Oakland Bay Bridge inside the 1609 m radius
 */
function buildBayBridgeMesh() {
  const builder = new ColoredMeshBuilder();
  const steelColor = [0.60, 0.64, 0.66];
  const cableColor = [0.54, 0.58, 0.60];
  const concreteColor = [0.76, 0.73, 0.67];

  // Bridge trajectory from Rincon Hill anchorage (east = +140, north = -680)
  // to northeast edge of radius (east = +1540, north = +380)
  const startE = 140;
  const startN = -680;
  const endE = 1540;
  const endN = 380;
  const spanDx = endE - startE;
  const spanDn = endN - startN;
  const totalLen = Math.hypot(spanDx, spanDn);
  const dirE = spanDx / totalLen;
  const dirN = spanDn / totalLen;
  // Angle in Three.js XZ plane (+X = East, +Z = -North)
  const bridgeAngle = Math.atan2(-dirN, dirE);
  const perpE = -dirN;
  const perpN = dirE;

  // 1. Concrete Anchorage at Rincon Hill (t = 0.04) and Pier W1 (t = 0.14)
  for (const [tPos, pHeight, pWidth, pDepth] of [
    [0.02, 46, 36, 28],
    [0.14, 54, 24, 28],
  ]) {
    const e = startE + dirE * totalLen * tPos;
    const n = startN + dirN * totalLen * tPos;
    builder.addOrientedBox(e, -4, -n, pWidth, pHeight, pDepth, bridgeAngle, concreteColor);
  }

  // 2. Suspension Towers (W2 at t = 0.34, W3 at t = 0.72) and Center Anchorage (W4 at t = 0.98)
  const towerPositions = [0.34, 0.72];
  for (const tPos of towerPositions) {
    const e = startE + dirE * totalLen * tPos;
    const n = startN + dirN * totalLen * tPos;

    // Concrete caisson base in the Bay
    builder.addOrientedBox(e, -10, -n, 22, 18, 36, bridgeAngle, concreteColor);

    // Twin vertical steel tower legs
    const towerHeight = 152;
    for (const side of [-11, 11]) {
      const legE = e + perpE * side;
      const legN = n + perpN * side;
      builder.addOrientedBox(legE, 8, -legN, 5.5, towerHeight, 5.5, bridgeAngle, steelColor);
    }

    // Horizontal cross-struts and portal beams
    for (const strutY of [38, 56, 95, 132, 156]) {
      builder.addOrientedBox(e, strutY, -n, 4.5, 4.5, 26, bridgeAngle, steelColor);
    }
  }

  // Center Anchorage Pier (W4 near the radius boundary)
  {
    const e = startE + dirE * totalLen * 0.98;
    const n = startN + dirN * totalLen * 0.98;
    builder.addOrientedBox(e, -12, -n, 38, 72, 32, bridgeAngle, concreteColor);
  }

  // 3. Double-Deck Truss Roadway along the span
  const deckSegments = 48;
  const segLen = totalLen / deckSegments;
  for (let i = 0; i < deckSegments; i++) {
    const t = (i + 0.5) / deckSegments;
    const e = startE + dirE * totalLen * t;
    const n = startN + dirN * totalLen * t;
    // Gentle camber from 44m at anchorage to 58m over the Bay channel
    const deckY = 44 + Math.sin(t * Math.PI * 0.85) * 14;

    // Lower & Upper deck truss box
    builder.addOrientedBox(e, deckY, -n, segLen + 1.2, 6.2, 22, bridgeAngle, steelColor);

    // Main suspension cables & vertical suspenders for t > 0.14
    if (t >= 0.14) {
      // Compute parabolic cable sag between towers [0.14, 0.34], [0.34, 0.72], [0.72, 0.98]
      let localU = 0;
      if (t < 0.34) {
        localU = (t - 0.14) / 0.20; // Anchorage to W2
      } else if (t < 0.72) {
        localU = (t - 0.34) / 0.38; // Main span W2 to W3
      } else {
        localU = (t - 0.72) / 0.26; // W3 to Center Anchorage
      }
      const parabola = 4 * localU * (1 - localU); // 0 at towers, 1 at midspan
      const cableY = 156 - parabola * 86;

      for (const side of [-10.5, 10.5]) {
        const cE = e + perpE * side;
        const cN = n + perpN * side;
        // Main cable segment
        builder.addOrientedBox(cE, cableY, -cN, segLen + 1.5, 1.8, 1.8, bridgeAngle, cableColor);

        // Vertical suspender rope every 2 segments
        if (i % 2 === 0 && cableY > deckY + 6) {
          builder.addOrientedBox(
            cE,
            deckY + 6,
            -cN,
            0.9,
            cableY - (deckY + 6),
            0.9,
            bridgeAngle,
            cableColor
          );
        }
      }
    }
  }

  return builder;
}

/**
 * 4A. Build Real DataSF Buildings if cached in tools/cache/datasf_buildings.geojson
 */
function buildRealDataSFBuildings(rawGeojson) {
  const bBuilder = new MergedBuildingsBuilder();
  const metadataList = [];

  // Building 0: Ensure Ferry Building at (0, 0) is always Building 0 with its landmark clock tower
  addFerryBuildingLandmark(bBuilder, metadataList, false);

  for (const feature of rawGeojson.features || []) {
    const geom = feature.geometry;
    if (!geom) continue;
    const polys =
      geom.type === 'MultiPolygon'
        ? geom.coordinates
        : geom.type === 'Polygon'
          ? [geom.coordinates]
          : [];
    if (polys.length === 0) continue;

    const outerRing = polys.reduce((best, p) => (p[0].length > best.length ? p[0] : best), polys[0][0]);
    if (!outerRing || outerRing.length < 4) continue;

    const ringEnu = outerRing.slice(0, -1).map(([lon, lat]) => [
      (lon - ORIGIN_LON) * METERS_PER_DEG_LON,
      (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT,
    ]);

    let cEast = 0,
      cNorth = 0;
    for (const [e, n] of ringEnu) {
      cEast += e;
      cNorth += n;
    }
    cEast /= ringEnu.length;
    cNorth /= ringEnu.length;

    // Skip outside 1-mile radius or duplicate overlapping Ferry Building at (0,0)
    if (Math.hypot(cEast, cNorth) > DISTRICT_RADIUS_M) continue;
    if (Math.hypot(cEast, cNorth) < 65) continue;

    // Shoelace area
    let area2 = 0;
    for (let i = 0; i < ringEnu.length; i++) {
      const [x0, y0] = ringEnu[i];
      const [x1, y1] = ringEnu[(i + 1) % ringEnu.length];
      area2 += x0 * y1 - x1 * y0;
    }
    const areaM2 = Math.max(18, Math.abs(area2) * 0.5);

    const props = feature.properties || {};
    const rawHeight = parseFloat(props.hgt_median_m || props.hgt_max_m || '');
    const hasSourcedHeight = Number.isFinite(rawHeight) && rawHeight > 0;
    const heightM = hasSourcedHeight ? Math.max(3.5, Math.min(260, rawHeight)) : 12.0;

    const rawGnd = parseFloat(props.gnd_min_m || '');
    const hasSourcedGnd = Number.isFinite(rawGnd);
    const groundElevM = hasSourcedGnd ? rawGnd : sampleElevation(cEast, cNorth);

    const bId = metadataList.length;
    bBuilder.addExtrudedPolygon(bId, cEast, cNorth, groundElevM, heightM, ringEnu);

    metadataList.push({
      id: bId,
      centroid: [Number(cEast.toFixed(2)), Number(cNorth.toFixed(2))],
      footprint_area_m2: Number(areaM2.toFixed(1)),
      height_m: Number(heightM.toFixed(1)),
      stories: null,
      year_built: null,
      material: null,
      ground_elevation_m: Number(groundElevM.toFixed(2)),
      data_quality: {
        footprint_area_m2: 'sourced',
        height_m: hasSourcedHeight ? 'sourced' : 'inferred',
        stories: 'unavailable',
        year_built: 'unavailable',
        material: 'unavailable',
        ground_elevation_m: hasSourcedGnd ? 'sourced' : 'inferred',
      },
    });
  }

  return { bBuilder, metadataList };
}

/**
 * Add the Ferry Building at Origin (0, 0) as Building ID 0.
 * Recognizable 200m waterfront nave hall + gabled gallery + 75m central Clock Tower + spire.
 * Uses the exact same merged mesh and _BUILDINGID = 0 as every other building.
 */
function addFerryBuildingLandmark(bBuilder, metadataList, isPlaceholder) {
  const bId = 0;
  const cEast = 0;
  const cNorth = 0;
  const baseElev = 2.45;
  const totalHeight = 74.5; // Clock tower peak
  const ferryAngle = -0.48; // Aligned with the Embarcadero waterfront

  // 1. Long 200m Beaux-Arts Nave Hall (width = 28m, depth/length = 200m, height = 18m)
  bBuilder.addBoxPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    0,
    0,
    baseElev,
    28,
    18.5,
    204,
    ferryAngle
  );

  // 2. Central Clerestory Monitor Roof Ridge along the Nave
  bBuilder.addBoxPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    0,
    0,
    baseElev + 18.5,
    13,
    4.8,
    184,
    ferryAngle
  );

  // 3. Central Clock Tower Pedestal & Shaft (10m x 10m rising to 60m)
  bBuilder.addBoxPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    0,
    0,
    baseElev + 23.3,
    10.5,
    34.0,
    10.5,
    ferryAngle
  );

  // 4. Clock Tower Belfry / Lantern Tier
  bBuilder.addBoxPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    0,
    0,
    baseElev + 57.3,
    8.2,
    8.2,
    8.2,
    ferryAngle
  );

  // 5. Pyramidal Clock Tower Spire (rising to 74.5m above base)
  bBuilder.addPyramidPart(
    bId,
    cEast,
    cNorth,
    baseElev,
    totalHeight,
    0,
    0,
    baseElev + 65.5,
    8.2,
    9.0,
    8.2,
    ferryAngle
  );

  metadataList.push({
    id: bId,
    name: 'San Francisco Ferry Building (Origin Landmark)',
    is_landmark: true,
    centroid: [0.0, 0.0],
    footprint_area_m2: 5712.0,
    height_m: totalHeight,
    stories: null,
    year_built: null,
    material: null,
    ground_elevation_m: baseElev,
    data_quality: {
      footprint_area_m2: isPlaceholder ? 'inferred' : 'sourced',
      height_m: isPlaceholder ? 'inferred' : 'sourced',
      stories: 'unavailable',
      year_built: 'unavailable',
      material: 'unavailable',
      ground_elevation_m: isPlaceholder ? 'inferred' : 'sourced',
    },
  });
}

/**
 * 4B. Generate Procedural Placeholder District (~2,850 buildings across the 1-mile radius)
 * Follows San Francisco's real street grids (North-of-Market orthogonal grid, South-of-Market
 * 45-degree diagonal grid, Financial District high-rise cluster, Jackson Square / Chinatown /
 * North Beach mid-rises, Telegraph Hill & Rincon Hill blocks, and Embarcadero Pier sheds).
 */
function buildProceduralPlaceholderBuildings(piers) {
  const rand = mulberry32(19062026);
  const bBuilder = new MergedBuildingsBuilder();
  const metadataList = [];

  // Building 0: Ferry Building at Origin (0, 0)
  addFerryBuildingLandmark(bBuilder, metadataList, true);

  // Helper to add a procedural building (with optional setback upper tier for tall towers)
  function addProceduralBuilding(east, north, width, depth, height, angleRad, customElev = null, name = null) {
    if (Math.hypot(east, north) > DISTRICT_RADIUS_M - 18) return;
    if (Math.hypot(east, north) < 115) return; // Keep Ferry Plaza & Ferry Building clear

    const baseElev = customElev !== null ? customElev : sampleElevation(east, north);
    if (customElev === null && baseElev < 1.2) return; // Don't place land buildings in the water

    const bId = metadataList.length;
    const areaM2 = width * depth;

    if (height > 65) {
      // Multi-tier tower (podium + main shaft + mechanical crown)
      const podiumH = Math.min(22, height * 0.2);
      const shaftH = height * 0.68;
      const crownH = height - podiumH - shaftH;
      bBuilder.addBoxPart(
        bId,
        east,
        north,
        baseElev,
        height,
        east,
        north,
        baseElev,
        width,
        podiumH,
        depth,
        angleRad
      );
      bBuilder.addBoxPart(
        bId,
        east,
        north,
        baseElev,
        height,
        east,
        north,
        baseElev + podiumH,
        width * 0.82,
        shaftH,
        depth * 0.82,
        angleRad
      );
      bBuilder.addBoxPart(
        bId,
        east,
        north,
        baseElev,
        height,
        east,
        north,
        baseElev + podiumH + shaftH,
        width * 0.62,
        crownH,
        depth * 0.62,
        angleRad
      );
    } else {
      bBuilder.addBoxPart(
        bId,
        east,
        north,
        baseElev,
        height,
        east,
        north,
        baseElev,
        width,
        height,
        depth,
        angleRad
      );
    }

    metadataList.push({
      id: bId,
      name,
      centroid: [Number(east.toFixed(2)), Number(north.toFixed(2))],
      footprint_area_m2: Number(areaM2.toFixed(1)),
      height_m: Number(height.toFixed(1)),
      stories: null,
      year_built: null,
      material: null,
      ground_elevation_m: Number(baseElev.toFixed(2)),
      data_quality: {
        footprint_area_m2: 'inferred',
        height_m: 'inferred',
        stories: 'unavailable',
        year_built: 'unavailable',
        material: 'unavailable',
        ground_elevation_m: 'inferred',
      },
    });
  }

  // 1. Finger Pier Sheds along the Embarcadero waterfront
  for (const pier of piers) {
    if (pier.noShed) continue;
    if (Math.hypot(pier.centerEast, pier.centerNorth) > DISTRICT_RADIUS_M - 30) continue;
    // Bulkhead building at seawall entrance + long pier shed
    const shedLen = pier.len * 0.82;
    const shedWidth = pier.width * 0.76;
    const shedHeight = 11.5 + rand() * 3.5;
    addProceduralBuilding(
      pier.centerEast,
      pier.centerNorth,
      shedLen,
      shedWidth,
      shedHeight,
      pier.angleThree,
      2.45,
      `${pier.name} Shed`
    );
  }

  // Market Street divider line in ENU: runs SW from (20, 0) along angle -140 deg
  // Points with (north - 0.84 * (east - 20)) > 18 are North of Market;
  // Points with (north - 0.84 * (east - 20)) < -18 are South of Market (SoMa).
  function marketSignedDist(east, north) {
    // Line passing through (-20, -10) with direction (-0.766, -0.643)
    // Normal pointing NW (North of Market): (-0.643, +0.766)
    return (east + 20) * -0.643 + (north + 10) * 0.766;
  }

  // 2. North-of-Market Orthogonal Grid (Financial District, Jackson Square, Chinatown, North Beach, Telegraph Hill)
  // SF North-of-Market blocks are ~85m N-S by ~115m E-W with ~20m streets
  const blockStepE = 112;
  const blockStepN = 86;

  for (let bE = -1560; bE <= 420; bE += blockStepE) {
    for (let bN = -520; bN <= 1560; bN += blockStepN) {
      const blockCenterE = bE + blockStepE * 0.5;
      const blockCenterN = bN + blockStepN * 0.5;

      // Must be North of Market and inland from the Embarcadero shoreline
      const mDist = marketSignedDist(blockCenterE, blockCenterN);
      if (mDist < 28) continue;
      if (shorelineSignedDistance(blockCenterE, blockCenterN) > -38) continue;
      if (Math.hypot(blockCenterE, blockCenterN) > DISTRICT_RADIUS_M - 25) continue;

      // Determine neighborhood typology based on ENU coordinates
      const distFiDiCore = Math.hypot((blockCenterE - -380) / 380, (blockCenterN - 20) / 320);
      const distEmbarcaderoCtr = Math.hypot((blockCenterE - -240) / 220, (blockCenterN - 120) / 140);
      const distTelegraph = Math.hypot(blockCenterE - -680, blockCenterN - 1020);

      if (distEmbarcaderoCtr < 1.1 || (distFiDiCore < 0.85 && rand() < 0.55)) {
        // High-rise downtown block (2 to 4 large footprints per block)
        const subCols = 2;
        const subRows = 2;
        for (let r = 0; r < subRows; r++) {
          for (let c = 0; c < subCols; c++) {
            if (rand() < 0.08) continue; // occasional plaza
            const pE = bE + 18 + (c + 0.5) * ((blockStepE - 36) / subCols) + (rand() - 0.5) * 4;
            const pN = bN + 16 + (r + 0.5) * ((blockStepN - 32) / subRows) + (rand() - 0.5) * 4;
            if (shorelineSignedDistance(pE, pN) > -32) continue;

            const w = 28 + rand() * 14;
            const d = 22 + rand() * 10;
            const h =
              distFiDiCore < 0.55
                ? 85 + Math.pow(rand(), 1.3) * 145
                : 45 + Math.pow(rand(), 1.5) * 95;
            addProceduralBuilding(pE, pN, w, d, h, 0);
          }
        }
      } else {
        // Dense mid-rise / low-rise urban block (Chinatown, Jackson Square, North Beach, Telegraph Hill)
        // Subdivide block into 4x2 or 5x2 parcels
        const subCols = distTelegraph < 380 ? 4 : 5;
        const subRows = 2;
        const usableW = blockStepE - 24;
        const usableD = blockStepN - 22;

        for (let r = 0; r < subRows; r++) {
          for (let c = 0; c < subCols; c++) {
            if (rand() < 0.06) continue;
            const pE = bE + 12 + (c + 0.5) * (usableW / subCols) + (rand() - 0.5) * 2.5;
            const pN = bN + 11 + (r + 0.5) * (usableD / subRows) + (rand() - 0.5) * 2.5;
            if (shorelineSignedDistance(pE, pN) > -30) continue;
            if (marketSignedDist(pE, pN) < 22) continue;

            const w = usableW / subCols - (3.5 + rand() * 3.0);
            const d = usableD / subRows - (4.0 + rand() * 3.0);

            let h;
            if (distTelegraph < 350) {
              // Telegraph Hill residential 2-4 stories (plus Coit Tower landmark near peak)
              h = 8.5 + rand() * 11.5;
            } else if (distFiDiCore < 1.35) {
              // Financial District / Jackson Square transition
              h = 16 + Math.pow(rand(), 1.6) * 42;
            } else {
              // Chinatown / North Beach / Russian Hill 3-6 stories
              h = 10.5 + Math.pow(rand(), 1.4) * 20;
            }
            addProceduralBuilding(pE, pN, w, d, h, 0);
          }
        }
      }
    }
  }

  // Add Coit Tower landmark atop Telegraph Hill (-680, 1020)
  addProceduralBuilding(-680, 1020, 14, 14, 64, 0, null, 'Coit Tower (Telegraph Hill)');

  // 3. South-of-Market (SoMa / Rincon Hill / South Beach / Transbay) 45-Degree Rotated Grid
  // Aligned with Market Street: U axis along Market SW (-0.766, -0.643), V axis SE (0.643, -0.766)
  const uDirE = -0.766;
  const uDirN = -0.643;
  const vDirE = 0.643;
  const vDirN = -0.766;
  const somaAngleThree = Math.atan2(-uDirN, uDirE);

  const somaStepU = 138; // Large SoMa blocks along Market/Mission/Howard/Folsom/Harrison
  const somaStepV = 108;

  for (let u = -320; u <= 1650; u += somaStepU) {
    for (let v = 35; v <= 1550; v += somaStepV) {
      const centerE = -20 + u * uDirE + v * vDirE;
      const centerN = -10 + u * uDirN + v * vDirN;

      if (shorelineSignedDistance(centerE, centerN) > -38) continue;
      if (Math.hypot(centerE, centerN) > DISTRICT_RADIUS_M - 25) continue;

      const distTransbay = Math.hypot((centerE - -240) / 340, (centerN - -240) / 260);
      const distRincon = Math.hypot((centerE - 80) / 300, (centerN - -680) / 260);

      const subCols = distTransbay < 1.0 ? 2 : 4;
      const subRows = 2;
      const usableU = somaStepU - 28;
      const usableV = somaStepV - 24;

      for (let r = 0; r < subRows; r++) {
        for (let c = 0; c < subCols; c++) {
          if (rand() < 0.08) continue;
          const localU = u + 14 + (c + 0.5) * (usableU / subCols);
          const localV = v + 12 + (r + 0.5) * (usableV / subRows);
          const pE = -20 + localU * uDirE + localV * vDirE;
          const pN = -10 + localU * uDirN + localV * vDirN;

          if (shorelineSignedDistance(pE, pN) > -32) continue;
          if (Math.hypot(pE, pN) > DISTRICT_RADIUS_M - 22) continue;

          const w = usableU / subCols - (5 + rand() * 4);
          const d = usableV / subRows - (5 + rand() * 4);

          let h;
          if (distTransbay < 0.85) {
            // Transbay / South Financial District towers
            h = 55 + Math.pow(rand(), 1.35) * 165;
          } else if (distRincon < 0.95) {
            // Rincon Hill residential towers & mid-rises
            h = 24 + Math.pow(rand(), 1.5) * 110;
          } else {
            // SoMa / South Beach warehouse & residential blocks
            h = 11 + Math.pow(rand(), 1.5) * 28;
          }

          addProceduralBuilding(pE, pN, w, d, h, somaAngleThree);
        }
      }
    }
  }

  return { bBuilder, metadataList };
}

/**
 * Pack Terrain, Waterfront, BayBridge, and Merged Buildings into a single binary glTF 2.0 (.glb) buffer.
 */
function exportDistrictGlb(terrain, waterfront, bayBridge, buildings) {
  const bufferViews = [];
  const accessors = [];
  const binChunks = [];
  let byteOffset = 0;

  function appendTypedArray(typedArr, target) {
    const rawBuf = Buffer.from(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength);
    const pad = (4 - (rawBuf.length % 4)) % 4;
    const viewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: rawBuf.length,
      ...(target ? { target } : {}),
    });
    binChunks.push(rawBuf);
    if (pad > 0) {
      binChunks.push(Buffer.alloc(pad));
    }
    byteOffset += rawBuf.length + pad;
    return viewIdx;
  }

  function computeMinMaxVec3(arr) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] < min[0]) min[0] = arr[i];
      if (arr[i + 1] < min[1]) min[1] = arr[i + 1];
      if (arr[i + 2] < min[2]) min[2] = arr[i + 2];
      if (arr[i] > max[0]) max[0] = arr[i];
      if (arr[i + 1] > max[1]) max[1] = arr[i + 1];
      if (arr[i + 2] > max[2]) max[2] = arr[i + 2];
    }
    return { min, max };
  }

  function addColoredMeshPrimitive(builder) {
    const posArr = new Float32Array(builder.positions);
    const normArr = new Float32Array(builder.normals);
    const colArr = new Float32Array(builder.colors);
    const idxArr = new Uint32Array(builder.indices);
    const count = posArr.length / 3;
    const { min, max } = computeMinMaxVec3(posArr);

    const posView = appendTypedArray(posArr, 34962);
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count,
      type: 'VEC3',
      min,
      max,
    });

    const normView = appendTypedArray(normArr, 34962);
    const normAcc = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: 5126,
      count,
      type: 'VEC3',
    });

    const colView = appendTypedArray(colArr, 34962);
    const colAcc = accessors.length;
    accessors.push({
      bufferView: colView,
      componentType: 5126,
      count,
      type: 'VEC3',
    });

    const idxView = appendTypedArray(idxArr, 34963);
    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5125, // UNSIGNED_INT
      count: idxArr.length,
      type: 'SCALAR',
    });

    return {
      attributes: {
        POSITION: posAcc,
        NORMAL: normAcc,
        COLOR_0: colAcc,
      },
      indices: idxAcc,
      mode: 4, // TRIANGLES
    };
  }

  function addBuildingsPrimitive(bBuilder) {
    const posArr = new Float32Array(bBuilder.positions);
    const normArr = new Float32Array(bBuilder.normals);
    const idArr = new Float32Array(bBuilder.buildingIds);
    const elevArr = new Float32Array(bBuilder.baseElevs);
    const hgtArr = new Float32Array(bBuilder.bHeights);
    const centArr = new Float32Array(bBuilder.centroids);
    const idxArr = new Uint32Array(bBuilder.indices);

    const count = posArr.length / 3;
    const { min, max } = computeMinMaxVec3(posArr);

    const posView = appendTypedArray(posArr, 34962);
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count,
      type: 'VEC3',
      min,
      max,
    });

    const normView = appendTypedArray(normArr, 34962);
    const normAcc = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: 5126,
      count,
      type: 'VEC3',
    });

    const idView = appendTypedArray(idArr, 34962);
    const idAcc = accessors.length;
    accessors.push({
      bufferView: idView,
      componentType: 5126,
      count,
      type: 'SCALAR',
    });

    const elevView = appendTypedArray(elevArr, 34962);
    const elevAcc = accessors.length;
    accessors.push({
      bufferView: elevView,
      componentType: 5126,
      count,
      type: 'SCALAR',
    });

    const hgtView = appendTypedArray(hgtArr, 34962);
    const hgtAcc = accessors.length;
    accessors.push({
      bufferView: hgtView,
      componentType: 5126,
      count,
      type: 'SCALAR',
    });

    const centView = appendTypedArray(centArr, 34962);
    const centAcc = accessors.length;
    accessors.push({
      bufferView: centView,
      componentType: 5126,
      count,
      type: 'VEC2',
    });

    const idxView = appendTypedArray(idxArr, 34963);
    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5125,
      count: idxArr.length,
      type: 'SCALAR',
    });

    return {
      attributes: {
        POSITION: posAcc,
        NORMAL: normAcc,
        _BUILDINGID: idAcc,
        _BASEELEV: elevAcc,
        _BHEIGHT: hgtAcc,
        _CENTROID: centAcc,
      },
      indices: idxAcc,
      mode: 4,
    };
  }

  const terrainPrim = addColoredMeshPrimitive(terrain);
  const waterfrontPrim = addColoredMeshPrimitive(waterfront);
  const bridgePrim = addColoredMeshPrimitive(bayBridge);
  const buildingsPrim = addBuildingsPrimitive(buildings);

  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'SF-Waterfront-Disaster-Simulator-Bake/1.0',
    },
    scene: 0,
    scenes: [
      {
        name: 'SFDistrict1Mile',
        nodes: [0, 1, 2, 3],
      },
    ],
    nodes: [
      { name: 'Terrain', mesh: 0 },
      { name: 'Waterfront', mesh: 1 },
      { name: 'BayBridge', mesh: 2 },
      { name: 'Buildings', mesh: 3 },
    ],
    meshes: [
      { name: 'TerrainMesh', primitives: [terrainPrim] },
      { name: 'WaterfrontMesh', primitives: [waterfrontPrim] },
      { name: 'BayBridgeMesh', primitives: [bridgePrim] },
      { name: 'BuildingsMesh', primitives: [buildingsPrim] },
    ],
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: byteOffset,
      },
    ],
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded =
    jsonPad > 0 ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]) : jsonBuf;

  const binBuf = Buffer.concat(binChunks);
  const totalByteLength = 12 + 8 + jsonPadded.length + 8 + binBuf.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalByteLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuf.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonPadded, binChunkHeader, binBuf]);
}

function main() {
  const forcePlaceholder = process.argv.includes('--placeholder');
  const cacheBuildingsPath = path.join(ROOT, 'tools', 'cache', 'datasf_buildings.geojson');
  const useRealData = !forcePlaceholder && fs.existsSync(cacheBuildingsPath);

  console.log(
    useRealData
      ? '[Bake] Found cached DataSF footprints in tools/cache/datasf_buildings.geojson — baking real footprints...'
      : '[Bake] Generating clearly labeled PROCEDURAL PLACEHOLDER district (1-mile around Ferry Building)...'
  );

  const piers = getEmbarcaderoPiers();
  const terrain = buildTerrainMesh();
  const waterfront = buildWaterfrontMesh(piers);
  const bayBridge = buildBayBridgeMesh();

  let bBuilder, metadataList;
  if (useRealData) {
    const rawGeojson = JSON.parse(fs.readFileSync(cacheBuildingsPath, 'utf8'));
    ({ bBuilder, metadataList } = buildRealDataSFBuildings(rawGeojson));
  } else {
    ({ bBuilder, metadataList } = buildProceduralPlaceholderBuildings(piers));
  }

  const glbBuffer = exportDistrictGlb(terrain, waterfront, bayBridge, bBuilder);

  const modelsDir = path.join(ROOT, 'public', 'models');
  const dataDir = path.join(ROOT, 'public', 'data');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const glbPath = path.join(modelsDir, 'district.glb');
  fs.writeFileSync(glbPath, glbBuffer);

  const buildingsJson = {
    schema_version: '1.0',
    is_placeholder: !useRealData,
    generation_note: useRealData
      ? 'Baked from cached DataSF Building Footprints (ynuv-fyni) and NOAA tidal datums.'
      : 'PROCEDURAL PLACEHOLDER DISTRICT: Generated offline by tools/bake_district.mjs --placeholder. Run `npm run bake:real` with internet access to replace with USGS 3DEP + DataSF footprints.',
    origin_wgs84: { lat: ORIGIN_LAT, lon: ORIGIN_LON },
    radius_m: DISTRICT_RADIUS_M,
    building_count: metadataList.length,
    unavailable_attributes_report: [
      'stories: Left null (not consistently populated in DataSF footprint polygons; requires parcel assessor cross-join).',
      'year_built: Left null (unavailable without external parcel assessor tax roll join).',
      'material: Left null (structural material unavailable in public footprint polygons except for tall building subset).',
    ],
    buildings: metadataList,
  };

  const jsonPath = path.join(dataDir, 'buildings.json');
  fs.writeFileSync(jsonPath, JSON.stringify(buildingsJson, null, 2));

  const totalTriangles =
    (terrain.indices.length +
      waterfront.indices.length +
      bayBridge.indices.length +
      bBuilder.indices.length) /
    3;

  console.log(`[Bake] Wrote ${glbPath} (${(glbBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(
    `[Bake] Wrote ${jsonPath} (${metadataList.length} buildings, ${Math.round(totalTriangles).toLocaleString()} total triangles)`
  );
}

main();
