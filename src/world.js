import * as C from 'cesium';
import { HOME, SEATTLE, LENSES, bearingDegrees, distanceMeters, moveLocation, feetToMeters, verticalFov, lookAtAngles } from './geo.js';
import { computeSky, starHorizontal, skyBrightness } from './sky.js';
import { installNightMaterials } from './lighting.js';
import { DataStatus } from './data-status.js';
import { defaultQuality, qualitySettings } from './quality.js';

const rad = C.Math.toRadians;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** First-person camera over the actual WGS84 terrain. No surrogate terrain. */
export class Observatory extends EventTarget {
  constructor(element) {
    super();
    this.element = element;
    this.state = {
      ...HOME, heading: bearingDegrees(HOME, SEATTLE), pitch: 0, targetSeattle: true,
      heightFeet: 6, groundHeight: null, lens: LENSES[0], speed: 15,
      date: new Date('2026-10-22T06:00:00Z'), moonOverride: null, cityBrightness: 1,
      quality: defaultQuality(),
      ready: false, terrainStatus: 'Waiting for terrain', buildingsStatus: 'Waiting',
      imageryStatus: 'Waiting', source: 'evaluation', surface: 'satellite',
    };
    this.data = new DataStatus(() => this.emit('datachange'));
    this.sceneQueued = 0;
    this.generation = 0;
    this.sampleGeneration = 0;
    this.keys = new Set();
    this.lastFrame = performance.now();
    this.lastSample = 0;
    this.lastSky = 0;
    this.catalog = [];
    this.starPoints = [];
    this.viewer = new C.Viewer(element, {
      baseLayer: false, baseLayerPicker: false, geocoder: false,
      animation: false, timeline: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, skyBox: false, skyAtmosphere: false,
      shouldAnimate: false, requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      contextOptions: { webgl: { alpha: false, antialias: true } },
    });
    const scene = this.viewer.scene;
    this.viewer.targetFrameRate = 30;
    scene.backgroundColor = C.Color.fromCssColorString('#020409');
    scene.fog.enabled = false; // Invisible fog can still cull distant terrain.
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.tileCacheSize = 500;
    scene.globe.baseColor = C.Color.fromCssColorString('#071019');
    scene.globe.show = false; // Never present the ellipsoid as a resolved ridge.
    scene.globe.dynamicAtmosphereLighting = false;
    scene.globe.tileLoadProgressEvent.addEventListener(queued => {
      this.sceneQueued = queued;
      this.emit('datachange');
      if (!this.state.ready || this.terrainDegraded || this.groundFailure) return;
      const status = queued ? 'Loading terrain tiles' : 'Terrain resolved for this view';
      if (this.state.terrainStatus !== status) { this.state.terrainStatus = status; this.emit('change'); }
    });
    scene.highDynamicRange = false;
    scene.postProcessStages.fxaa.enabled = true;
    if (scene.sun) scene.sun.show = false;
    scene.screenSpaceCameraController.enableInputs = false;
    this.viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
    this.viewer.useBrowserRecommendedResolution = true;
    this.baseResolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
    this.applyQuality();
    this.viewer.camera.frustum.near = 0.1;
    this.viewer.camera.frustum.far = 2e9;
    this.materials = installNightMaterials(this.viewer);
    this.stars = scene.primitives.add(new C.PointPrimitiveCollection({ blendOption: C.BlendOption.OPAQUE }));
    scene.renderError.addEventListener(() => this.emit('error', {
      message: 'The 3D renderer stopped. Reload the page, and check that hardware acceleration is enabled.',
    }));
    this.viewer.clock.onTick.addEventListener(() => this.tick());
    scene.postRender.addEventListener(() => this.refreshDataStatus());
    this.bindNavigation();
    this.resizeObserver = new ResizeObserver(() => { this.applyQuality(); this.setCamera(); });
    this.resizeObserver.observe(element);
    this.updateEnvironment();
    this.setCamera();
    this.loadStars();
  }

  emit(type, detail = this.state) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async loadStars() {
    this.data.begin('stars', 'Loading real star catalog');
    try {
      const response = await fetch('/data/stars.json');
      if (!response.ok) throw new Error('catalog');
      this.catalog = (await response.json()).stars;
      this.starPoints = this.catalog.map(() => this.stars.add({ pixelSize: 1, show: false }));
      this.updateStars();
      this.data.connected('stars');
      this.data.loaded('stars');
      this.data.settle('stars', true, `${this.catalog.length.toLocaleString()} catalog stars available`);
      this.emit('change');
    } catch {
      this.data.fail('stars', 'Star catalog unavailable · reload to retry', true);
      this.emit('notice', { message: 'The star catalog could not load. Reload to try again.' });
    }
  }

  async connect(token, source = 'personal') {
    const generation = ++this.generation;
    this.bootstrapInFlight = generation;
    ++this.sampleGeneration;
    this.groundRequest = null;
    this.terrain = null;
    this.lastGroundLocation = null;
    this.terrainDegraded = false;
    this.groundFailure = false;
    for (const id of ['terrain', 'buildings', 'satellite', 'nightLights']) this.data.begin(id);
    this.state.ready = false;
    this.state.terrainStatus = 'Connecting';
    this.state.buildingsStatus = 'Connecting';
    this.state.imageryStatus = 'Connecting';
    this.state.source = source;
    this.state.groundHeight = null;
    this.viewer.scene.globe.show = false;
    if (this.buildings) {
      this.viewer.scene.primitives.remove(this.buildings);
      this.buildings = null;
    }
    this.viewer.imageryLayers.removeAll();
    this.aerial = null;
    this.nightImagery = null;
    C.Ion.defaultAccessToken = token || C.Ion.defaultAccessToken;
    this.emit('change');
    let terrain;
    try {
      terrain = await C.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
      if (generation !== this.generation) return;
      this.viewer.terrainProvider = terrain;
      this.terrain = terrain;
      this.trackProvider(terrain, 'requestTileGeometry', 'terrain', generation);
      this.data.connected('terrain', 'Resolving observer height');
      this.state.terrainStatus = 'Resolving ground';
      const sampled = await C.sampleTerrainMostDetailed(terrain, [C.Cartographic.fromDegrees(this.state.longitude, this.state.latitude)]);
      if (generation !== this.generation) return;
      if (!Number.isFinite(sampled[0].height)) throw new Error('ground unavailable');
      this.state.groundHeight = sampled[0].height;
      this.lastGroundLocation = { latitude: this.state.latitude, longitude: this.state.longitude };
      this.bootstrapInFlight = null;
      this.state.ready = true;
      this.state.terrainStatus = 'Loading terrain tiles';
      this.viewer.scene.globe.show = true;
      this.setCamera();
      this.updateEnvironment();
      this.emit('change');
    } catch {
      if (generation !== this.generation) return;
      this.bootstrapInFlight = null;
      this.terrain = null;
      this.groundRequest = null;
      this.state.terrainStatus = 'Connection failed';
      this.state.buildingsStatus = 'Not connected';
      this.state.imageryStatus = 'Not connected';
      for (const id of ['terrain', 'buildings', 'satellite', 'nightLights']) {
        this.data.fail(id, id === 'terrain' ? 'Terrain connection failed · connect or retry' : 'Waiting for a working terrain connection', true);
      }
      this.emit('change');
      this.emit('connection-error', { message: source === 'evaluation'
        ? 'Evaluation terrain is unavailable. Connect your Cesium ion token to load the real ridge and buildings.'
        : 'Terrain could not load. Check your token’s access to Cesium World Terrain and your internet connection.' });
      return;
    }
    // Imagery and buildings can fail independently without losing the terrain.
    await Promise.allSettled([
      this.loadImagery(generation), this.loadBuildings(generation),
    ]);
    this.emit('change');
  }

  async loadImagery(generation) {
    try {
      const provider = await C.IonImageryProvider.fromAssetId(2);
      if (generation !== this.generation) return;
      this.trackProvider(provider, 'requestImage', 'satellite', generation);
      this.data.connected('satellite');
      this.aerial = this.viewer.imageryLayers.addImageryProvider(provider);
      this.state.imageryStatus = 'Satellite connected';
      this.updateEnvironment();
    } catch {
      if (generation !== this.generation) return;
      this.state.imageryStatus = 'Satellite unavailable · using relief';
      this.data.fail('satellite', 'Satellite source unavailable · terrain relief remains available', true);
    }
    // Optional NASA Black Marble adds broad, faint surface-light patterns.
    // This is lit imagery; independent facade emission comes from the UNLIT shader.
    try {
      // Public NASA tiles avoid requiring a separate ion asset entitlement.
      // The published Web Mercator matrix is 256px and ends at level 8.
      const provider = new C.UrlTemplateImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
        maximumLevel: 8,
        credit: new C.Credit('NASA GIBS · Suomi NPP VIIRS Earth at Night (2012 composite)'),
      });
      if (generation !== this.generation) return;
      this.trackProvider(provider, 'requestImage', 'nightLights', generation);
      this.data.connected('nightLights');
      this.nightImagery = this.viewer.imageryLayers.addImageryProvider(provider);
      this.nightImagery.brightness = 0.75;
      this.updateEnvironment();
    } catch {
      if (generation === this.generation) this.data.fail('nightLights', 'Optional night imagery unavailable · modeled city windows still work', true);
    }
    this.emit('change');
  }

  async loadBuildings(generation) {
    try {
      const tileset = await C.createOsmBuildingsAsync({
        maximumScreenSpaceError: this.qualitySettings.buildingSSE,
        dynamicScreenSpaceError: false,
        skipLevelOfDetail: false,
        customShader: this.materials.buildingShader,
      });
      if (generation !== this.generation) { tileset.destroy(); return; }
      tileset.style = undefined;
      this.buildings = this.viewer.scene.primitives.add(tileset);
      this.buildings.maximumScreenSpaceError = this.qualitySettings.buildingSSE;
      this.data.connected('buildings');
      this.state.buildingsStatus = 'Loading building tiles';
      let tilesFailed = false;
      tileset.loadProgress.addEventListener((pending, processing) => {
        if (generation !== this.generation) return;
        this.data.setQueue('buildings', pending, processing);
        if (tilesFailed || !(pending || processing)) return;
        if (this.state.buildingsStatus !== 'Loading building tiles') {
          this.state.buildingsStatus = 'Loading building tiles'; this.emit('change');
        }
      });
      tileset.tileFailed.addEventListener(() => {
        if (generation !== this.generation) return;
        tilesFailed = true;
        this.data.fail('buildings', 'Some 3D building tiles failed · reconnect to retry');
        this.state.buildingsStatus = 'Some building tiles unavailable'; this.emit('change');
      });
      tileset.tileLoad.addEventListener(() => {
        if (generation === this.generation) this.data.loaded('buildings');
      });
      tileset.allTilesLoaded.addEventListener(() => {
        if (generation !== this.generation) return;
        this.state.buildingsStatus = tilesFailed ? 'Some building tiles unavailable · reconnect to retry' : 'Buildings resolved for this view'; this.emit('change');
      });
    } catch {
      if (generation !== this.generation) return;
      this.state.buildingsStatus = 'Buildings unavailable';
      this.data.fail('buildings', '3D building source unavailable · connect or retry', true);
      this.emit('notice', { message: 'Terrain is connected, but 3D buildings could not load. Check access to Cesium OSM Buildings.' });
    }
    this.emit('change');
  }

  setCamera() {
    if (!this.viewer || this.viewer.isDestroyed()) return;
    const { state, viewer } = this;
    if (state.targetSeattle && state.groundHeight !== null) {
      const orientation = lookAtAngles({ ...state, height: state.groundHeight + feetToMeters(state.heightFeet) }, { ...SEATTLE, height: 200 });
      state.heading = orientation.heading;
      state.pitch = orientation.pitch;
    }
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(state.longitude, state.latitude, (state.groundHeight ?? 500) + feetToMeters(state.heightFeet)),
      orientation: { heading: rad(state.heading), pitch: rad(state.pitch), roll: 0 },
    });
    const aspect = Math.max(0.1, this.element.clientWidth / Math.max(1, this.element.clientHeight));
    viewer.camera.frustum.aspectRatio = aspect;
    // Cesium fov means horizontal above landscape aspect, vertical below it.
    viewer.camera.frustum.fov = rad(aspect >= 1 ? state.lens.horizontalFov : verticalFov(state.lens.horizontalFov, aspect));
    this.emit('change');
  }

  setLens(id) {
    const lens = LENSES.find(l => l.id === id);
    if (!lens) return;
    this.state.lens = lens;
    this.setCamera();
  }

  setHeight(feet) {
    if (!Number.isFinite(feet)) return;
    this.state.heightFeet = clamp(feet, 0.5, 30000);
    this.setCamera();
  }

  setTime(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return;
    this.state.date = date;
    this.state.moonOverride = null;
    this.updateEnvironment();
    this.emit('change');
  }

  setMoon(value) {
    this.state.moonOverride = value === null ? null : clamp(value, 0, 1);
    this.updateEnvironment();
    this.emit('change');
  }

  setCityBrightness(value) {
    if (!Number.isFinite(value)) return;
    this.state.cityBrightness = clamp(value, 0, 3);
    this.updateEnvironment();
    this.emit('change');
  }

  trackProvider(provider, method, id, generation) {
    const original = provider[method];
    const owner = this;
    const attempts = new Map();
    const keyFor = (x, y, level) => `${level}/${x}/${y}`;
    provider.errorEvent.addEventListener(error => {
      if (generation !== owner.generation) return;
      const key = keyFor(error.x, error.y, error.level);
      const count = attempts.get(key) || 0;
      const permanent = [400, 401, 403, 404].includes(error.error?.statusCode);
      // Cesium creates a fresh scheduled request when retry is true. Track
      // attempts per tile: its shared error object's timesRetried is per layer.
      error.retry = !permanent && count < 2;
      attempts.set(key, count + 1);
      if (error.retry) {
        owner.data.markRefining([id], 'Retrying a temporary tile failure');
        owner.viewer.scene.requestRender();
        return;
      }
      owner.data.fail(id, `Some ${owner.data.rows.get(id).label.toLowerCase()} unavailable · use Retry data`);
      if (id === 'terrain') {
        owner.terrainDegraded = true;
        owner.state.terrainStatus = 'Some terrain unavailable · use Retry data';
      }
      if (id === 'satellite') owner.state.imageryStatus = 'Some imagery unavailable · use Retry data';
      owner.emit('change');
    });
    provider[method] = function (...args) {
      const result = original.apply(this, args);
      if (generation !== owner.generation || result === undefined) return result;
      const request = args[3];
      const tracked = owner.data.track(id, result,
        () => request?.cancelled || request?.state === C.RequestState.CANCELLED, false);
      return tracked?.then ? tracked.then(value => {
        attempts.delete(keyFor(...args));
        return value;
      }) : tracked;
    };
  }

  refreshDataStatus() {
    const scene = this.viewer.scene;
    const globeReady = this.state.ready && !this.groundFailure && scene.globe.tilesLoaded && !this.groundRequest;
    if (this.groundFailure) this.data.markRefining(['terrain'], 'Ground height unavailable · retrying; movement paused');
    else this.data.settle('terrain', globeReady);
    this.data.settle('satellite', this.state.surface !== 'satellite' || globeReady,
      this.state.surface === 'satellite' ? 'Ready for the current view' : 'Source available · terrain relief selected');
    this.data.settle('nightLights', this.state.cityBrightness === 0 || globeReady,
      this.state.cityBrightness === 0 ? 'Source available · city lights switched off' : 'Ready for the current view · optional imagery');
    this.data.settle('buildings', Boolean(this.buildings?.tilesLoaded));
    this.data.settle('stars', this.catalog.length > 0, `${this.catalog.length.toLocaleString()} catalog stars available`);
  }

  applyQuality() {
    const limits = C.ContextLimits;
    const safeLimits = [limits.maximumTextureSize, limits.maximumRenderbufferSize,
      limits.maximumViewportWidth, limits.maximumViewportHeight].filter(n => Number.isFinite(n) && n > 0);
    this.qualitySettings = qualitySettings(this.state.quality, Math.max(1, this.element.clientWidth),
      Math.max(1, this.element.clientHeight), safeLimits.length ? Math.min(...safeLimits) : 4096, this.baseResolutionScale || 1);
    this.viewer.resolutionScale = this.qualitySettings.resolutionScale;
    this.viewer.scene.globe.maximumScreenSpaceError = this.qualitySettings.globeSSE;
    if (this.buildings) this.buildings.maximumScreenSpaceError = this.qualitySettings.buildingSSE;
    this.viewer.scene.requestRender();
  }

  setQuality(id, factor) {
    const selections = { ...this.state.quality, [id]: factor };
    qualitySettings(selections); // Validate before changing the live scene.
    this.state.quality = selections;
    this.applyQuality();
    const shared = ['terrain', 'satellite', 'nightLights'].includes(id);
    this.data.markRefining(shared ? ['terrain', 'satellite', 'nightLights'] : [id], 'Applying quality boost to the current view');
    this.emit('change');
  }

  resetQuality() {
    this.state.quality = defaultQuality();
    this.applyQuality();
    this.data.markRefining();
    this.emit('change');
  }

  setSurface(surface) {
    this.state.surface = surface;
    this.updateEnvironment();
    this.emit('change');
  }

  reset() {
    if (!this.state.ready || !this.terrain) return;
    Object.assign(this.state, HOME, { heading: bearingDegrees(HOME, SEATTLE), pitch: 0, targetSeattle: true, heightFeet: 6, groundHeight: null, ready: false, terrainStatus: 'Resolving ridge ground' });
    ++this.sampleGeneration;
    this.lastGroundLocation = null;
    this.groundRequest = null;
    this.viewer.scene.globe.show = false;
    this.keys.clear();
    this.updateEnvironment();
    this.resolveGround();
    this.setCamera();
  }

  faceSeattle() {
    this.state.targetSeattle = true;
    this.setCamera();
  }

  async resolveGround() {
    if (!this.terrain || this.groundRequest) return;
    const request = {};
    this.groundRequest = request;
    const generation = this.sampleGeneration;
    const { longitude, latitude } = this.state;
    try {
      const positions = await C.sampleTerrainMostDetailed(this.terrain, [C.Cartographic.fromDegrees(longitude, latitude)]);
      if (generation !== this.sampleGeneration) return;
      if (distanceMeters({ longitude, latitude }, this.state) > 10) return;
      if (!Number.isFinite(positions[0].height)) throw new Error('height');
      this.state.groundHeight = positions[0].height;
      this.lastGroundLocation = { latitude, longitude };
      this.groundFailure = false;
      this.state.ready = true;
      this.viewer.scene.globe.show = true;
      this.state.terrainStatus = this.terrainDegraded ? 'Some terrain unavailable · reconnect to retry'
        : this.viewer.scene.globe.tilesLoaded ? 'Terrain resolved for this view' : 'Loading terrain tiles';
      this.setCamera();
    } catch {
      if (generation !== this.sampleGeneration) return;
      this.state.terrainStatus = 'Ground height unavailable · movement paused';
      this.groundFailure = true;
      this.data.markRefining(['terrain'], 'Ground height unavailable · retrying; movement paused');
      this.keys.clear();
      this.emit('change');
    } finally {
      if (this.groundRequest === request) this.groundRequest = null;
    }
  }

  worldDirection(altitude, azimuth) {
    const a = rad(altitude), z = rad(azimuth);
    const frame = C.Transforms.eastNorthUpToFixedFrame(this.viewer.camera.positionWC);
    return C.Matrix4.multiplyByPointAsVector(frame, new C.Cartesian3(Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)), new C.Cartesian3());
  }

  updateEnvironment() {
    const s = this.state;
    this.sky = computeSky({ date: s.date, latitude: s.latitude, longitude: s.longitude,
      elevation: (s.groundHeight ?? 0) + feetToMeters(s.heightFeet), moonOverride: s.moonOverride });
    this.viewer.clock.currentTime = C.JulianDate.fromDate(s.date);
    const sky = this.sky;
    if (this.viewer.scene.sun) this.viewer.scene.sun.show = sky.sunAltitude > -1;
    const direction = this.worldDirection(sky.twilight > 0.4 ? sky.sunAltitude : sky.moonAltitude,
      sky.twilight > 0.4 ? sky.sunAzimuth : sky.moonAzimuth);
    C.Cartesian3.negate(direction, direction);
    this.viewer.scene.light = new C.DirectionalLight({ direction, color: C.Color.fromCssColorString('#d8e3ff'),
      intensity: sky.twilight * 1.5 + sky.moonIntensity * 0.15 + 0.002 });
    if (this.aerial && !this.aerial.isDestroyed()) {
      this.aerial.show = s.surface === 'satellite';
      this.aerial.brightness = 0.045 + sky.moonIntensity * 0.28 + sky.twilight * 0.9;
      this.aerial.saturation = 0.25 + sky.twilight * 0.75;
    }
    if (this.nightImagery && !this.nightImagery.isDestroyed()) {
      this.nightImagery.show = s.cityBrightness > 0;
      this.nightImagery.brightness = 0.75 * s.cityBrightness;
      this.nightImagery.alpha = (1 - sky.twilight) * 0.7 * Math.min(1, s.cityBrightness);
    }
    this.materials.update({ ...sky, cityBrightness: s.cityBrightness, latitude: s.latitude, longitude: s.longitude });
    this.updateStars();
  }

  updateStars() {
    if (!this.catalog.length || !this.sky) return;
    const s = this.state;
    const frame = C.Transforms.eastNorthUpToFixedFrame(this.viewer.camera.positionWC);
    const base = this.viewer.camera.positionWC;
    const moonDisk = this.materials.moonDisk();
    let visible = 0;
    for (let i = 0; i < this.catalog.length; i++) {
      const [ra, dec, magnitude, colorIndex] = this.catalog[i];
      const horizontal = starHorizontal(ra, dec, s.date, s.latitude, s.longitude);
      const point = this.starPoints[i];
      if (horizontal.altitude < -3) { point.show = false; continue; }
      const { limitingMagnitude } = skyBrightness({ ...horizontal, latitude: s.latitude, longitude: s.longitude, sky: this.sky, pollution: s.cityBrightness });
      const visibility = clamp((limitingMagnitude - magnitude + 0.15) / 0.6, 0, 1);
      if (visibility <= 0) { point.show = false; continue; }
      const a = rad(horizontal.altitude), z = rad(horizontal.azimuth);
      const local = new C.Cartesian3(Math.cos(a) * Math.sin(z) * 1e9, Math.cos(a) * Math.cos(z) * 1e9, Math.sin(a) * 1e9);
      const delta = C.Matrix4.multiplyByPointAsVector(frame, local, new C.Cartesian3());
      // Cesium clears environment depth after drawing its Moon. Explicitly
      // prevent ordinary star primitives from appearing through the lunar disk.
      if (moonDisk.show && C.Cartesian3.dot(delta, moonDisk.direction) / 1e9 > moonDisk.cosineRadius) {
        point.show = false;
        continue;
      }
      point.position = C.Cartesian3.add(base, delta, new C.Cartesian3());
      const brightness = clamp(0.15 + (5.5 - magnitude) * 0.11, 0.08, 0.95) * visibility;
      const warm = colorIndex === null ? 0.2 : clamp(colorIndex / 2, 0, 1);
      point.color = new C.Color(brightness, brightness * (0.96 - warm * 0.08), brightness * (1 - warm * 0.25), 1);
      point.pixelSize = magnitude < 0 ? 2.3 : magnitude < 2 ? 1.6 : 1.05;
      point.show = true;
      visible++;
    }
    this.state.visibleStars = visible; // Above-horizon model count, not unoccluded viewport count.
    this.lastSky = performance.now();
    this.viewer.scene.requestRender();
  }

  tick() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    // Ground resolution must keep retrying after a reset, even while the view
    // is deliberately hidden. It also never overlaps an outstanding request.
    const needsGround = this.groundFailure || this.state.groundHeight === null || !this.lastGroundLocation
      || distanceMeters(this.lastGroundLocation, this.state) > 0.25;
    if (this.terrain && !this.bootstrapInFlight && !this.groundRequest && needsGround
      && now - this.lastSample > (this.groundFailure ? 3000 : 1200)) {
      this.lastSample = now;
      this.resolveGround();
    }
    if (!this.state.ready) return;
    const s = this.state;
    const forward = Number(this.keys.has('w')) - Number(this.keys.has('s'));
    const right = Number(this.keys.has('d')) - Number(this.keys.has('a'));
    const rise = Number(this.keys.has('e')) - Number(this.keys.has('q'));
    if ((forward || right || rise) && !this.groundFailure) {
      const speed = s.speed * (this.keys.has('shift') ? 4 : 1);
      if (forward || right) {
        const direction = s.heading + Math.atan2(right, forward) * 180 / Math.PI;
        const next = moveLocation(s, direction, speed * dt);
        // Keep this experience in the ridge / Puget Sound region.
        if (distanceMeters(HOME, next) < 110000) {
          const loadedHeight = this.viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(next.longitude, next.latitude));
          if (Number.isFinite(loadedHeight)) {
            Object.assign(s, next, { groundHeight: loadedHeight });
          } else {
            s.terrainStatus = 'Waiting for local terrain · movement paused';
          }
        }
      }
      if (rise) s.heightFeet = clamp(s.heightFeet + rise * speed * dt / 0.3048, 0.5, 30000);
      this.setCamera();
      if (now - this.lastSky > 1000) this.updateEnvironment();
    }
  }

  bindNavigation() {
    const canvas = this.viewer.canvas;
    canvas.setAttribute('aria-label', 'First-person 3D view. Drag to look; W A S D to move; Q and E to change height.');
    canvas.tabIndex = 0;
    let pointer = null;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      this.state.targetSeattle = false;
      const factor = this.state.lens.horizontalFov / Math.max(1, canvas.clientWidth);
      this.state.heading = (this.state.heading - (event.clientX - pointer.x) * factor + 360) % 360;
      this.state.pitch = clamp(this.state.pitch + (event.clientY - pointer.y) * factor, -89, 89);
      pointer.x = event.clientX; pointer.y = event.clientY;
      this.setCamera();
    });
    const release = () => { pointer = null; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const index = LENSES.indexOf(this.state.lens);
      this.setLens(LENSES[clamp(index + Math.sign(event.deltaY), 0, LENSES.length - 1)].id);
    }, { passive: false });
    window.addEventListener('keydown', event => {
      if (event.target.closest('input, select, textarea, button, dialog')) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(key)) {
        event.preventDefault(); this.keys.add(key);
      }
    });
    window.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => this.keys.clear());
  }
}

export const evaluationToken = () => C.Ion.defaultAccessToken;
