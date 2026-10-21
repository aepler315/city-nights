import assert from 'node:assert/strict';
import test from 'node:test';
import { installNightMaterials } from '../src/lighting.js';

function nightMaterials() {
  let skyStage;
  const materials = installNightMaterials({
    scene: {
      postProcessStages: {
        add(stage) { skyStage = stage; return stage; },
        remove(stage) { stage.destroy(); },
      },
      requestRender() {},
      isDestroyed: () => false,
    },
  });
  return { materials, skyStage };
}

test('city brightness drives both artificial-light shaders independently of moonlight and twilight', (t) => {
  const { materials, skyStage } = nightMaterials();
  t.after(() => materials.destroy());
  const sources = ['u_seattleGlow', 'u_bremertonGlow', 'u_everettGlow'];
  const initialGlows = sources.map((name) => ({ ...skyStage.uniforms[name]() }));

  for (const cityBrightness of [0, 0.5, 1, 3]) {
    materials.update({ cityBrightness, moonIntensity: 0.6, twilight: 0.25 });
    assert.equal(materials.buildingShader.uniforms.u_cityBrightness?.value, cityBrightness);
    assert.equal(skyStage.uniforms.u_cityBrightness?.(), cityBrightness);
    assert.equal(materials.buildingShader.uniforms.u_moonIntensity.value, 0.6);
    assert.equal(skyStage.uniforms.u_moonIntensity(), 0.6);
    assert.equal(materials.buildingShader.uniforms.u_twilight.value, 0.25);
    assert.equal(skyStage.uniforms.u_twilight(), 0.25);
    assert.deepEqual(sources.map((name) => ({ ...skyStage.uniforms[name]() })), initialGlows);
  }
});

test('city brightness defaults to one and normalizes invalid or out-of-range input before reaching GLSL', (t) => {
  const { materials, skyStage } = nightMaterials();
  t.after(() => materials.destroy());
  assert.equal(materials.buildingShader.uniforms.u_cityBrightness?.value, 1);
  assert.equal(skyStage.uniforms.u_cityBrightness?.(), 1);

  for (const [cityBrightness, expected] of [
    [-1, 0], [4, 3], [NaN, 1], [Infinity, 1], [null, 1], ['2', 1], [undefined, 1],
  ]) {
    materials.update({ cityBrightness });
    assert.equal(materials.buildingShader.uniforms.u_cityBrightness?.value, expected);
    assert.equal(skyStage.uniforms.u_cityBrightness?.(), expected);
  }
});
