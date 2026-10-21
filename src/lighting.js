import {
  Cartesian3,
  Cartesian4,
  CelestialFrameTransforms,
  CustomShader,
  CustomShaderMode,
  CustomShaderTranslucencyMode,
  JulianDate,
  LightingModel,
  Matrix3,
  PostProcessStage,
  Simon1994PlanetaryPositions,
  UniformType,
} from 'cesium';
import { bearingDegrees, distanceMeters } from './geo.js';

// Visual estimates only: these are neither measured facade emissions nor a
// calibrated scattering/exposure model. The shader never changes mesh geometry.
const BUILDING_FRAGMENT = `
float windowSeed(vec2 cell) {
    vec3 p = fract(vec3(cell.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
    vec3 worldPosition = fsInput.attributes.positionWC;
    vec3 worldNormal = normalize(czm_inverseViewRotation * fsInput.attributes.normalEC);
    vec3 relativePosition = worldPosition - u_buildingOrigin;
    vec3 enuPosition = vec3(dot(relativePosition, u_buildingEast),
                            dot(relativePosition, u_buildingNorth),
                            dot(relativePosition, u_buildingUp));
    vec2 horizontalNormal = vec2(dot(worldNormal, u_buildingEast),
                                  dot(worldNormal, u_buildingNorth));
    float across = abs(horizontalNormal.x) > abs(horizontalNormal.y)
        ? enuPosition.y : enuPosition.x;
    vec2 grid = vec2(across / 3.6, enuPosition.z / 3.3);
    vec2 cell = floor(grid);
    vec2 within = fract(grid);
    vec2 antialiasWidth = max(fwidth(grid), vec2(0.015));
    vec2 rectangle = smoothstep(vec2(0.20), vec2(0.20) + antialiasWidth, within)
        * (vec2(1.0) - smoothstep(vec2(0.77) - antialiasWidth, vec2(0.77), within));
    float occupied = step(0.69, windowSeed(cell));
    float windows = rectangle.x * rectangle.y * occupied;
    // Integrate unresolved windows into a faint mean instead of making their
    // apparent dimensions larger or allowing a subpixel grid to shimmer.
    float unresolved = smoothstep(0.45, 1.6, max(antialiasWidth.x, antialiasWidth.y));
    windows = mix(windows, 0.10, unresolved);
    float facade = 1.0 - smoothstep(0.25, 0.60,
        abs(dot(worldNormal, normalize(worldPosition))));
    float directional = 0.45 + 0.55 * max(0.0,
        dot(normalize(fsInput.attributes.normalEC), czm_lightDirectionEC));
    vec3 body = vec3(0.0010, 0.0015, 0.0024)
        + u_moonIntensity * directional * vec3(0.020, 0.025, 0.035)
        + u_twilight * directional * vec3(0.20, 0.22, 0.25);
    float night = 1.0 - u_twilight;
    vec3 warm = mix(vec3(0.88, 0.56, 0.25), vec3(0.60, 0.74, 0.90),
        step(0.80, windowSeed(cell + vec2(47.0, 19.0))));
    // Cesium's UNLIT path uses diffuse directly, not material.emissive.
    material.diffuse = body + u_cityBrightness * warm * windows * facade
        * (0.70 * night * night + 0.008);
    material.alpha = 1.0;
}
`;

const SKY_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec3 u_up;
uniform vec3 u_east;
uniform vec3 u_north;
uniform vec4 u_rayFrustum;
uniform vec4 u_seattleGlow;
uniform vec4 u_bremertonGlow;
uniform vec4 u_everettGlow;
uniform vec3 u_moonPosition;
uniform float u_moonRadius;
uniform float u_showMoon;
uniform float u_moonIntensity;
uniform float u_twilight;
uniform float u_cityBrightness;
in vec2 v_textureCoordinates;

float cityLobe(vec2 horizontalDirection, vec4 city) {
    float aligned = pow(max(0.0, dot(horizontalDirection, city.xy)), 5.0);
    return city.z * mix(1.0, aligned, city.w);
}

void main() {
    vec4 source = texture(colorTexture, v_textureCoordinates);
    // Scene's depth attachment clears to 1.0 (Scene.js). It is a raw depth
    // texture, not the separately packed czm_globeDepthTexture.
    if (texture(depthTexture, v_textureCoordinates).r < 1.0) {
        out_FragColor = source;
        return;
    }

    vec2 ndc = v_textureCoordinates * 2.0 - 1.0;
    vec3 rayEC = normalize(vec3(ndc.x * u_rayFrustum.x,
                               ndc.y * u_rayFrustum.y, -1.0));
    vec3 ray = normalize(czm_inverseViewRotation * rayEC);

    // Moon is rendered as an environment object before depth is cleared.
    // Protect its true angular disk explicitly, including observer parallax.
    vec3 toMoon = u_moonPosition - czm_viewerPositionWC;
    float moonAngle = asin(clamp(u_moonRadius / length(toMoon), 0.0, 1.0));
    if (u_showMoon > 0.5 && dot(ray, normalize(toMoon)) > cos(moonAngle + 0.00005)) {
        out_FragColor = source;
        return;
    }

    float elevationSine = dot(ray, u_up);
    float above = max(0.0, elevationSine);
    vec2 horizontal = vec2(dot(ray, u_east), dot(ray, u_north));
    horizontal /= max(length(horizontal), 0.0001);
    float horizon = exp(-above / 0.12);
    float cityGlow = cityLobe(horizontal, u_seattleGlow)
        + cityLobe(horizontal, u_bremertonGlow)
        + cityLobe(horizontal, u_everettGlow);
    vec3 sky = vec3(0.0014, 0.0026, 0.0060)
        + horizon * vec3(0.003, 0.004, 0.005);
    sky += u_cityBrightness * cityGlow * horizon * vec3(0.68, 0.49, 0.30)
        * pow(1.0 - u_twilight, 2.0);
    sky += u_moonIntensity * (0.30 + 0.70 * horizon) * vec3(0.023, 0.035, 0.064);
    sky = mix(sky, vec3(0.075, 0.14, 0.25)
        + horizon * vec3(0.17, 0.10, 0.035), u_twilight);

    // Screen composition retains rendered star/sun radiance rather than
    // replacing the scene color with an opaque gradient. Faint stars naturally
    // lose contrast against the brighter estimated sky.
    out_FragColor = vec4(source.rgb + sky * (vec3(1.0) - source.rgb), source.a);
}
`;

const CITIES = [
  { latitude: 47.6062, longitude: -122.3321, strength: 0.11 },
  { latitude: 47.5673, longitude: -122.6326, strength: 0.050 },
  { latitude: 47.97898, longitude: -122.20208, strength: 0.060 },
];

const unit = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function localFrame(latitude, longitude) {
  const lat = latitude * Math.PI / 180;
  const lon = longitude * Math.PI / 180;
  return {
    east: new Cartesian3(-Math.sin(lon), Math.cos(lon), 0),
    north: new Cartesian3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)),
    up: new Cartesian3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)),
  };
}

/**
 * Install estimated facade emission and a depth-aware regional night sky.
 * Assign buildingShader to the OSM tileset. update() takes observer coordinates
 * in degrees, moonIntensity/twilight in [0,1], and cityBrightness in [0,3]
 * (default 1). Zero removes artificial facade emission and regional skyglow.
 * No measured brightness claim.
 * The caller owns scene lights, fog, atmosphere, clock, and camera settings.
 */
export function installNightMaterials(viewer) {
  const scene = viewer.scene;
  const buildingFrame = localFrame(CITIES[0].latitude, CITIES[0].longitude);
  const state = {
    moonIntensity: 0,
    twilight: 0,
    cityBrightness: 1,
    ...localFrame(47.80138888888889, -122.95269444444445),
    cityGlows: CITIES.map(() => new Cartesian4()),
  };
  const buildingShader = new CustomShader({
    mode: CustomShaderMode.REPLACE_MATERIAL,
    lightingModel: LightingModel.UNLIT,
    translucencyMode: CustomShaderTranslucencyMode.OPAQUE,
    uniforms: {
      u_moonIntensity: { type: UniformType.FLOAT, value: 0 },
      u_twilight: { type: UniformType.FLOAT, value: 0 },
      u_cityBrightness: { type: UniformType.FLOAT, value: 1 },
      u_buildingOrigin: { type: UniformType.VEC3, value: Cartesian3.fromDegrees(CITIES[0].longitude, CITIES[0].latitude) },
      u_buildingEast: { type: UniformType.VEC3, value: buildingFrame.east },
      u_buildingNorth: { type: UniformType.VEC3, value: buildingFrame.north },
      u_buildingUp: { type: UniformType.VEC3, value: buildingFrame.up },
    },
    fragmentShaderText: BUILDING_FRAGMENT,
  });

  const moonPosition = new Cartesian3();
  const moonRotation = new Matrix3();
  let moonDate;
  function currentMoonPosition() {
    const date = viewer.clock.currentTime;
    if (!moonDate || !JulianDate.equals(date, moonDate)) {
      Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(date, moonPosition);
      if (!CelestialFrameTransforms.computeIcrfToFixedMatrix(date, moonRotation)) {
        CelestialFrameTransforms.computeTemeToPseudoFixedMatrix(date, moonRotation);
      }
      Matrix3.multiplyByVector(moonRotation, moonPosition, moonPosition);
      moonDate = JulianDate.clone(date, moonDate);
    }
    return moonPosition;
  }

  const rayFrustum = new Cartesian4();
  const skyStage = scene.postProcessStages.add(new PostProcessStage({
    name: 'city-nights-estimated-regional-sky',
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      u_up: () => state.up,
      u_east: () => state.east,
      u_north: () => state.north,
      u_moonIntensity: () => state.moonIntensity,
      u_twilight: () => state.twilight,
      u_cityBrightness: () => state.cityBrightness,
      u_seattleGlow: () => state.cityGlows[0],
      u_bremertonGlow: () => state.cityGlows[1],
      u_everettGlow: () => state.cityGlows[2],
      u_moonPosition: currentMoonPosition,
      u_moonRadius: () => scene.moon?.ellipsoid.maximumRadius ?? 1_737_400,
      u_showMoon: () => scene.moon?.show ? 1 : 0,
      u_rayFrustum: () => {
        const frustum = viewer.camera.frustum;
        const tanHalfVertical = Math.tan(frustum.fovy / 2);
        rayFrustum.x = tanHalfVertical * frustum.aspectRatio;
        rayFrustum.y = tanHalfVertical;
        return rayFrustum;
      },
    },
  }));

  let destroyed = false;
  function update({ moonIntensity = 0, twilight = 0, cityBrightness = 1, latitude, longitude }) {
    if (destroyed) return;
    state.moonIntensity = unit(moonIntensity);
    state.twilight = unit(twilight);
    state.cityBrightness = Math.max(0, Math.min(3, Number.isFinite(cityBrightness) ? cityBrightness : 1));
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      Object.assign(state, localFrame(latitude, longitude));
      const observer = { latitude, longitude };
      CITIES.forEach((city, index) => {
        const distance = distanceMeters(observer, city);
        const bearing = bearingDegrees(observer, city) * Math.PI / 180;
        const glow = state.cityGlows[index];
        glow.x = Math.sin(bearing);
        glow.y = Math.cos(bearing);
        glow.z = city.strength / (1 + (distance / 35_000) ** 1.35);
        glow.w = Math.min(1, distance / 8_000);
      });
    }
    buildingShader.setUniform('u_moonIntensity', state.moonIntensity);
    buildingShader.setUniform('u_twilight', state.twilight);
    buildingShader.setUniform('u_cityBrightness', state.cityBrightness);
    scene.requestRender();
  }

  update({ latitude: 47.80138888888889, longitude: -122.95269444444445 });
  return {
    buildingShader,
    update,
    moonDisk() {
      const toMoon = Cartesian3.subtract(currentMoonPosition(), viewer.camera.positionWC, new Cartesian3());
      const distance = Cartesian3.magnitude(toMoon);
      return {
        direction: Cartesian3.normalize(toMoon, toMoon),
        cosineRadius: Math.cos(Math.asin((scene.moon?.ellipsoid.maximumRadius ?? 1_737_400) / distance)),
        show: Boolean(scene.moon?.show),
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!scene.isDestroyed()) scene.postProcessStages.remove(skyStage);
      if (!buildingShader.isDestroyed()) buildingShader.destroy();
    },
  };
}
