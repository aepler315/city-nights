export const DATASET_IDS = Object.freeze(['terrain', 'buildings', 'satellite', 'nightLights', 'stars']);

const QUALITY_FACTORS = [1, 2, 4];
const MAX_RENDER_SCALE = 2;
const MAX_RENDER_PIXELS = 16_000_000;

export function defaultQuality() {
  return Object.fromEntries(DATASET_IDS.map(id => [id, 1]));
}

/**
 * Source refinement requests existing detail, never synthetic geography or stars.
 * The render boost is a pixel-count multiplier: 4x requests 2x each dimension.
 * Cesium renders all layers into one framebuffer, so this boost is shared.
 * baseResolutionScale preserves the caller's capped device-pixel-ratio baseline;
 * useBrowserRecommendedResolution must remain true to avoid applying DPR twice.
 * maxTextureSize should be the smallest texture, renderbuffer, and viewport limit.
 */
export function qualitySettings(
  quality = defaultQuality(), viewportWidth = 1920, viewportHeight = 1080,
  maxTextureSize = 4096, baseResolutionScale = 1,
) {
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)
    || Object.keys(quality).some(id => !DATASET_IDS.includes(id))) {
    throw new RangeError('Quality must contain known dataset selections.');
  }
  const selections = { ...defaultQuality(), ...quality };
  if (Object.values(selections).some(value => !QUALITY_FACTORS.includes(value))) {
    throw new RangeError('Dataset quality must be 1, 2, or 4.');
  }
  for (const dimension of [viewportWidth, viewportHeight, maxTextureSize]) {
    if (!Number.isFinite(dimension) || dimension < 1 || dimension > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Viewport dimensions and GPU limits must be finite and at least one pixel.');
    }
  }
  if (!Number.isFinite(baseResolutionScale) || baseResolutionScale <= 0) {
    throw new RangeError('Base resolution scale must be positive and finite.');
  }

  const terrainSSE = 2 / selections.terrain;
  const buildingSSE = 4 / selections.buildings;
  // Cesium 1.146 selects imagery detail from terrain tile geometric error and
  // clamps it to the provider's maximumLevel. There is no per-layer imagery SSE.
  const imagerySSE = 2 / Math.max(selections.satellite, selections.nightLights);
  const requestedResolutionScale = baseResolutionScale * Math.sqrt(Math.max(...Object.values(selections)));
  const textureLimit = Math.floor(maxTextureSize);
  const resolutionScale = Math.min(
    requestedResolutionScale, MAX_RENDER_SCALE,
    textureLimit / viewportWidth, textureLimit / viewportHeight,
    Math.sqrt(MAX_RENDER_PIXELS / (viewportWidth * viewportHeight)),
  );
  const datasets = Object.fromEntries(DATASET_IDS.map(id => [id, {
    factor: selections[id],
    mode: id === 'stars' ? 'render-only'
      : ['satellite', 'nightLights'].includes(id) ? 'shared-source-refinement' : 'source-refinement',
  }]));

  return {
    terrainSSE, buildingSSE, imagerySSE,
    globeSSE: Math.min(terrainSSE, imagerySSE),
    requestedResolutionScale, resolutionScale,
    renderWidth: Math.max(1, Math.floor(viewportWidth * resolutionScale)),
    renderHeight: Math.max(1, Math.floor(viewportHeight * resolutionScale)),
    pixelMultiplier: (resolutionScale / baseResolutionScale) ** 2,
    renderLimited: resolutionScale < requestedResolutionScale - 1e-12,
    datasets,
  };
}
