/**
 * Coordinate System Configuration & Helpers (Single Shared File)
 *
 * Origin: San Francisco Ferry Building (approx. 37.7955 N, 122.3937 W)
 * Local East-North-Up (ENU) in meters mapped to Three.js:
 *   +X = East (meters)
 *   +Y = Up (elevation in meters above sea level = 0 m)
 *   -Z = North (so +Z = South)
 *   1 Three.js unit = 1 meter.
 *
 * District radius: 1 mile = 1609 meters.
 */

export const ORIGIN_LAT = 37.7955;
export const ORIGIN_LON = -122.3937;
export const DISTRICT_RADIUS_M = 1609;

const DEG_TO_RAD = Math.PI / 180;
export const METERS_PER_DEG_LAT = 111132.92;
export const METERS_PER_DEG_LON = 111412.84 * Math.cos(ORIGIN_LAT * DEG_TO_RAD);

export interface ENUCoord {
  east: number;
  north: number;
  up: number;
}

export interface ThreeXYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert WGS84 (lat, lon, elevationM) to local ENU meters relative to Ferry Building.
 */
export function latLonToEnu(lat: number, lon: number, upM = 0): ENUCoord {
  const east = (lon - ORIGIN_LON) * METERS_PER_DEG_LON;
  const north = (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT;
  return { east, north, up: upM };
}

/**
 * Convert local ENU (east, north, up) to Three.js coordinates (+X = east, +Y = up, -Z = north).
 */
export function enuToThree(east: number, north: number, up = 0): [number, number, number] {
  return [east, up, -north];
}

/**
 * Convert Three.js coordinates (x, y, z) to local ENU (east, north, up).
 */
export function threeToEnu(x: number, y: number, z: number): ENUCoord {
  return { east: x, north: -z, up: y };
}

/**
 * Check if an ENU coordinate (east, north) lies within the 1-mile (1609 m) district radius.
 */
export function isWithinDistrict(east: number, north: number, radiusM = DISTRICT_RADIUS_M): boolean {
  return Math.hypot(east, north) <= radiusM;
}

/**
 * Lookup cell index (row, col) in a row-major inundation grid given ENU (east, north).
 */
export function getInundationGridCell(
  east: number,
  north: number,
  originEnuM: [number, number] = [-1609, -1609],
  cellM = 25,
  cols = 129,
  rows = 129
): { col: number; row: number; index: number } | null {
  const col = Math.floor((east - originEnuM[0]) / cellM);
  const row = Math.floor((north - originEnuM[1]) / cellM);
  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    return null;
  }
  return { col, row, index: row * cols + col };
}
