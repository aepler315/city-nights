import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASET_IDS, defaultQuality, qualitySettings } from '../src/quality.js';

test('each dataset starts at native quality and changing one selection does not affect another instance', () => {
  const first = defaultQuality();
  first.terrain = 4;
  assert.deepEqual(defaultQuality(), {
    terrain: 1, buildings: 1, satellite: 1, nightLights: 1, stars: 1,
  });
  assert.deepEqual(DATASET_IDS, ['terrain', 'buildings', 'satellite', 'nightLights', 'stars']);
});

test('native quality preserves existing terrain and building refinement thresholds', () => {
  const settings = qualitySettings(defaultQuality(), 1920, 1080, 8192, 1.5);
  assert.equal(settings.terrainSSE, 1.2);
  assert.equal(settings.buildingSSE, 1);
  assert.equal(settings.imagerySSE, 1.2);
  assert.equal(settings.globeSSE, 1.2);
  assert.equal(settings.resolutionScale, 1.5);
  assert.equal(settings.renderWidth, 2880);
  assert.equal(settings.renderHeight, 1620);
  assert.equal(settings.renderLimited, false);
});

test('terrain and buildings refine their own source levels independently', () => {
  const terrain = qualitySettings({ terrain: 4 }, 1000, 500, 8192);
  assert.equal(terrain.terrainSSE, 0.3);
  assert.equal(terrain.buildingSSE, 1);
  assert.equal(terrain.globeSSE, 0.3);
  const buildings = qualitySettings({ buildings: 2 }, 1000, 500, 8192);
  assert.equal(buildings.terrainSSE, 1.2);
  assert.equal(buildings.buildingSSE, 0.5);
  assert.equal(buildings.globeSSE, 1.2);
});

test('satellite and night imagery request finer source tiles through the shared globe refinement', () => {
  const settings = qualitySettings({ satellite: 2, nightLights: 4 }, 1000, 500, 8192);
  assert.equal(settings.imagerySSE, 0.3);
  assert.equal(settings.globeSSE, 0.3);
  assert.equal(settings.terrainSSE, 1.2);
  assert.equal(settings.buildingSSE, 1);
  assert.equal(settings.datasets.satellite.mode, 'shared-source-refinement');
  assert.equal(settings.datasets.nightLights.mode, 'shared-source-refinement');
});

test('star quality increases rendered samples without changing source refinement or multiplying per dataset boosts', () => {
  const settings = qualitySettings({ stars: 4, terrain: 2, buildings: 4 }, 1000, 500, 8192);
  assert.equal(settings.resolutionScale, 2);
  assert.equal(settings.pixelMultiplier, 4);
  assert.equal(settings.datasets.stars.mode, 'render-only');
  assert.equal(settings.datasets.stars.factor, 4);
  assert.equal(settings.terrainSSE, 0.6);
  assert.equal(settings.imagerySSE, 1.2);
});

test('2x means twice the rendered pixel samples and 4x means twice each framebuffer dimension', () => {
  const double = qualitySettings({ stars: 2 }, 1000, 500, 8192);
  assert.ok(Math.abs(double.resolutionScale - Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(double.pixelMultiplier - 2) < 1e-12);
  const quadruple = qualitySettings({ stars: 4 }, 1000, 500, 8192);
  assert.equal(quadruple.renderWidth, 2000);
  assert.equal(quadruple.renderHeight, 1000);
});

test('render scale is bounded at twice CSS resolution even on a high density display', () => {
  const settings = qualitySettings({ stars: 4 }, 1920, 1080, 8192, 1.5);
  assert.equal(settings.requestedResolutionScale, 3);
  assert.equal(settings.resolutionScale, 2);
  assert.equal(settings.renderLimited, true);
  assert.ok(settings.pixelMultiplier < 4);
});

test('large displays stay within the 16 million pixel budget', () => {
  const settings = qualitySettings({ stars: 4 }, 3840, 2160, 16384);
  assert.equal(settings.renderLimited, true);
  assert.ok(settings.renderWidth * settings.renderHeight <= 16_000_000);
  assert.ok(settings.resolutionScale > 1);
  assert.ok(settings.resolutionScale < 2);
});

test('landscape and portrait framebuffers fit the device texture limit even when native resolution must shrink', () => {
  for (const [width, height] of [[6000, 3000], [3000, 6000]]) {
    const settings = qualitySettings({ satellite: 4 }, width, height, 2048);
    assert.ok(settings.renderWidth <= 2048);
    assert.ok(settings.renderHeight <= 2048);
    assert.ok(settings.resolutionScale < 1);
    assert.equal(settings.renderLimited, true);
    assert.equal(settings.globeSSE, 0.3);
  }
});

test('quality calculation preserves the caller selections', () => {
  const quality = Object.freeze({ terrain: 2, stars: 4 });
  qualitySettings(quality);
  assert.deepEqual(quality, { terrain: 2, stars: 4 });
});

test('unknown datasets and unsupported quality values fail explicitly', () => {
  for (const invalid of [null, [], '4', { windows: 4 }, { terrain: 0 }, { buildings: 3 }, { satellite: '2' }, { stars: NaN }]) {
    assert.throws(() => qualitySettings(invalid), RangeError);
  }
});

test('invalid framebuffer dimensions and hardware limits fail before creating a GPU request', () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.throws(() => qualitySettings({}, invalid, 1080), RangeError);
    assert.throws(() => qualitySettings({}, 1920, invalid), RangeError);
    assert.throws(() => qualitySettings({}, 1920, 1080, invalid), RangeError);
    assert.throws(() => qualitySettings({}, 1920, 1080, 8192, invalid), RangeError);
  }
});
