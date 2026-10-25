/**
 * Single centralized theme constants file.
 * Warm, light, calm palette for UI and 3D daylight scene.
 */

export const THEME = {
  // Page & Card UI Colors
  ui: {
    pageBg: '#F5F0E6',
    cardBg: '#FFFDF8',
    cardBgSubtle: '#F9F5EC',
    cardBorder: '#E7DFCF',
    cardBorderStrong: '#D5CBB8',
    textPrimary: '#2B2620',
    textSecondary: '#6B6256',
    textMuted: '#948A7C',
    accentPrimary: '#2F6F6B', // Deep teal
    accentPrimaryHover: '#255956',
    accentPrimaryLight: '#E6F0EF',
    accentSecondary: '#B5573A', // Terracotta
    accentSecondaryLight: '#F7EAE5',
    shadowSoft: '0 4px 20px rgba(43, 38, 32, 0.06), 0 1px 3px rgba(43, 38, 32, 0.04)',
    shadowOverlay: '0 6px 24px rgba(43, 38, 32, 0.12)',
  },

  // Severity / Priority Colors
  severity: {
    high: '#B8473D', // Muted red
    highBg: '#F9EAE8',
    medium: '#D69A2D', // Amber
    mediumBg: '#FBF3E2',
    low: '#7A8B3C', // Olive
    lowBg: '#F0F3E6',
  },

  // Building Damage Ramp (States 0..4)
  damageRamp: {
    0: '#EAE3D5', // State 0: None (Neutral warm cream)
    1: '#E9D386', // State 1: Slight (Pale yellow)
    2: '#DF9B43', // State 2: Moderate (Amber)
    3: '#CF653C', // State 3: Extensive (Orange-red)
    4: '#9E332E', // State 4: Complete / Collapse (Deep red)
  } as Record<0 | 1 | 2 | 3 | 4, string>,

  // Flood & Highlight Overlays in 3D Shader
  overlays: {
    floodTint: '#2E7D87', // Blue-teal flood overlay
    hoverHighlight: '#2F6F6B', // Deep teal glow when hovered in sidebar or 3D
    selectedHighlight: '#B5573A',
  },

  // 3D Scene Environment Colors (Soft daylight, pale sky, light haze)
  scene: {
    skyColor: '#EFECE4',
    fogColor: '#EFECE4',
    groundBase: '#DFD7C6',
    terrainLow: '#DED6C6',
    terrainHigh: '#CBBFA9',
    seawallEdge: '#B8AE9C',
    pierDeck: '#C8BFA8',
    roadPrimary: '#CFC6B4',
    roadSecondary: '#D6CEBE',
    bayBridgeSteel: '#9DA5A8',
    waterShallow: '#9BC1C4',
    waterDeep: '#76A4AA',
    waterFoam: '#E4F0F0',
    sunLight: '#FFFDF7',
    ambientLight: '#F3EFE6',
    hemisphereGround: '#D8CFC0',
    dustPuff: '#C7BBA6',
  },
} as const;

export const DAMAGE_STATE_LABELS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'None',
  1: 'Slight',
  2: 'Moderate',
  3: 'Extensive',
  4: 'Complete',
};
