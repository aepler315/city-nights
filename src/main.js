import './style.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Observatory, evaluationToken } from './world.js';
import { HOME, SEATTLE, LENSES, bearingDegrees, distanceMeters, metersToFeet, feetToMeters } from './geo.js';
import { fromZonedInput, toZonedInput } from './sky.js';

const $ = id => document.getElementById(id);
let world;
let toastTimer;
const toast = message => {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
};
const showDialog = id => { world?.keys.clear(); $(id).showModal(); };
const readStorage = (storageName, key) => { try { return window[storageName].getItem(key); } catch { return null; } };
const saveToken = (token, remember) => {
  try {
    localStorage.removeItem('city-nights-ion-token');
    sessionStorage.removeItem('city-nights-ion-token');
    (remember ? localStorage : sessionStorage).setItem('city-nights-ion-token', token);
  } catch { toast('This browser could not remember the token. It will work for the current page.'); }
};

const datasetViews = new Map();
for (const [id, label] of [['terrain','Terrain'], ['buildings','3D buildings'], ['satellite','Satellite imagery'], ['nightLights','Night-light imagery'], ['stars','Star catalog']]) {
  const row = document.createElement('section'); row.className = 'dataset-row'; row.dataset.dataset = id;
  const heading = document.createElement('div'); heading.className = 'dataset-heading';
  const name = document.createElement('span'); name.className = 'dataset-name'; name.textContent = label;
  const badge = document.createElement('span'); badge.className = 'dataset-state';
  heading.append(name, badge);
  const detail = document.createElement('p'); detail.className = 'dataset-detail';
  const metrics = document.createElement('p'); metrics.className = 'dataset-metrics';
  const progress = document.createElement('div'); progress.className = 'dataset-progress'; progress.setAttribute('aria-hidden', 'true');
  const quality = document.createElement('label'); quality.className = 'dataset-quality'; quality.textContent = 'DETAIL BOOST';
  const select = document.createElement('select'); select.id = `quality-${id}`; select.setAttribute('aria-label', `${label} quality boost`);
  for (const factor of [1, 2, 4]) {
    const option = document.createElement('option'); option.value = factor; option.textContent = `${factor}×${factor === 1 ? ' default' : ' boost'}`; select.append(option);
  }
  select.addEventListener('change', () => world?.setQuality(id, Number(select.value)));
  quality.append(select); row.append(heading, detail, metrics, progress, quality);
  $('status-rows').append(row); datasetViews.set(id, { row, badge, detail, metrics, select });
}
const qualityNote = document.createElement('p'); qualityNote.id = 'quality-render-note'; qualityNote.className = 'help-text';
$('status-reset-quality').parentElement.before(qualityNote);

let dataUpdateTimer;
let openedInitialStatus = false;
function scheduleDataUI() {
  if (dataUpdateTimer) return;
  dataUpdateTimer = setTimeout(() => { dataUpdateTimer = undefined; updateDataUI(); }, 180);
}

function updateDataUI() {
  if (!world) return;
  const summary = world.data.summary();
  const entries = world.data.snapshot();
  const labels = { waiting: 'Waiting', connecting: 'Connecting', loading: 'Loading', refining: 'Refining', ready: 'Ready', unavailable: 'Unavailable', partial: 'Partial data' };
  const title = summary.status === 'loading'
    ? `Loading / refining ${summary.busy} dataset${summary.busy === 1 ? '' : 's'}`
    : summary.status === 'partial' ? 'View has partial or unavailable data' : 'Current view is ready';
  const connecting = entries.filter(entry => entry.status === 'connecting').length;
  const queue = connecting && !summary.pending && !world.sceneQueued
    ? `Connecting ${connecting} source${connecting === 1 ? '' : 's'} · tiles follow after connection`
    : `${summary.pending} tile requests · ${summary.processing} processing · ${world.sceneQueued} shared view tiles queued`;
  $('stream-status-button').dataset.state = summary.status === 'partial' ? 'unavailable' : summary.status;
  $('stream-status-title').textContent = title;
  $('stream-status-detail').textContent = summary.status === 'loading'
    ? `${queue}${summary.hasErrors ? ' · some data unavailable' : ''}`
    : summary.hasErrors ? 'Open to see source warnings and quality controls.' : 'Open dataset status and detail boosts.';
  $('status-summary').textContent = `${title}. ${summary.status === 'loading' ? queue + '. ' : ''}${summary.hasErrors ? 'Unavailable sources are listed below; the view may be incomplete.' : 'Detail settles for the current viewpoint and selected quality.'}`;
  for (const entry of entries) {
    const view = datasetViews.get(entry.id);
    view.row.dataset.state = entry.status === 'partial' ? 'unavailable' : entry.status === 'connecting' || entry.status === 'waiting' ? 'loading' : entry.status;
    view.badge.textContent = labels[entry.status];
    const boost = world.state.quality[entry.id];
    const qualityDescription = boost === 1 ? '' : entry.id === 'stars'
      ? ` ${boost}× render boost; catalog and visibility threshold unchanged.`
      : ` ${boost}× detail boost; finer available source tiles plus interpolated rendering.`;
    view.detail.textContent = entry.detail + qualityDescription;
    const counts = entry.id === 'stars' ? `${world.catalog.length.toLocaleString()} catalog stars`
      : `${entry.loaded.toLocaleString()} tiles processed · ${entry.pending} pending${entry.processing ? ` · ${entry.processing} processing` : ''}`;
    view.metrics.textContent = `${counts}${entry.failed ? ` · ${entry.failed} failed request${entry.failed === 1 ? '' : 's'}` : ''}`;
    if (document.activeElement !== view.select) view.select.value = boost;
  }
  const settings = world.qualitySettings;
  qualityNote.textContent = `View rendering: ${settings.renderWidth.toLocaleString()} × ${settings.renderHeight.toLocaleString()} pixels · ${settings.pixelMultiplier.toFixed(1)}× pixel sampling.${settings.renderLimited ? ' Render boost is limited to a safe framebuffer size.' : ''} Terrain and image detail share refinement; pixel sampling applies to the whole view.`;
  if (!openedInitialStatus && !document.querySelector('dialog[open]')) {
    openedInitialStatus = true;
    $('status-dialog').show();
  }
}

for (const lens of LENSES) {
  const button = document.createElement('button');
  button.textContent = lens.label;
  button.dataset.lens = lens.id;
  button.setAttribute('aria-pressed', String(lens.id === 'naked-eye'));
  button.addEventListener('click', () => world?.setLens(lens.id));
  $('lenses').append(button);
}

function updateUI(s) {
  $('home').disabled = !s.ready;
  $('heading').innerHTML = `${Math.round(s.heading).toString().padStart(3, '0')}<span>°</span>`;
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  $('compass-direction').textContent = directions[Math.round(s.heading / 22.5) % 16];
  const homeDistance = distanceMeters(HOME, s);
  $('location-name').innerHTML = `${homeDistance < 100 ? 'Quilcene Ridge' : 'Exploring Puget Sound'}<span>Washington</span>`;
  $('coordinates').textContent = `${Math.abs(s.latitude).toFixed(5)}°${s.latitude >= 0 ? 'N' : 'S'}   ${Math.abs(s.longitude).toFixed(5)}°${s.longitude < 0 ? 'W' : 'E'}`;
  $('distance').innerHTML = `${(distanceMeters(s, SEATTLE) / 1609.344).toFixed(1)} <small>mi</small>`;
  $('eye-height').innerHTML = `${s.heightFeet < 100 ? Number(s.heightFeet.toFixed(1)) : Math.round(s.heightFeet).toLocaleString()} <small>ft</small>`;
  $('elevation').innerHTML = `${s.groundHeight === null ? '—' : Math.round(metersToFeet(s.groundHeight)).toLocaleString()} <small>ft</small>`;
  if (document.activeElement !== $('height')) $('height').value = Number(s.heightFeet.toFixed(1));
  if (document.activeElement !== $('height-range')) $('height-range').value = 1000 * Math.log(s.heightFeet / 0.5) / Math.log(60000);
  $('height-meters').textContent = `${feetToMeters(s.heightFeet).toFixed(2)} m`;
  $('fov-readout').textContent = `${s.lens.horizontalFov.toFixed(1)}° horizontal field of view`;
  const framingMagnification = Math.tan(Math.PI / 6) / Math.tan(s.lens.horizontalFov * Math.PI / 360);
  $('lens-description').textContent = s.lens.focalLength === null
    ? 'An unmagnified, 60° window onto the world.'
    : `${s.lens.focalLength} mm full-frame · ${framingMagnification.toFixed(1)}× relative framing · naked-eye sensitivity.`;
  document.querySelectorAll('[data-lens]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lens === s.lens.id)));
  if (document.activeElement !== $('date-time')) $('date-time').value = toZonedInput(s.date);
  $('time-zone').textContent = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).formatToParts(s.date).find(p => p.type === 'timeZoneName').value;
  const sky = world.sky;
  if (sky) {
    $('moon-phase').textContent = `${Math.round(sky.moonPhase * 100)}%`;
    $('moon-altitude').textContent = `${sky.moonAltitude.toFixed(1)}°`;
    const value = s.moonOverride === null ? Math.round(sky.moonIntensity * 100) : Math.round(s.moonOverride * 100);
    if (document.activeElement !== $('moonlight')) $('moonlight').value = value;
    $('moon-value').textContent = `${value}%`;
    $('moon-auto').classList.toggle('active', s.moonOverride === null);
    $('moon-auto').setAttribute('aria-pressed', String(s.moonOverride === null));
    $('moon-description').textContent = sky.moonAltitude <= 0
      ? `${s.moonOverride === null ? 'Automatic' : 'Manual override'} · Moon below horizon; no direct moonlight`
      : s.moonOverride === null ? 'Date-based illumination · move slider to override' : 'Manual illumination override · dated phase and position retained';
    $('night-status').textContent = sky.sunGeometricAltitude <= -18 ? 'DARK NIGHT' : sky.sunGeometricAltitude < 0 ? 'TWILIGHT' : 'DAYLIGHT';
    $('date-sky-description').textContent = s.moonOverride === null
      ? 'Linked to this date: Moon phase, moonlight, and stars. Adjusting the slider creates a manual override.'
      : 'Manual moonlight override is active. Changing the date or selecting Auto reconnects illumination to the sky.';
  }
  if (document.activeElement !== $('city-brightness')) $('city-brightness').value = Math.round(s.cityBrightness * 100);
  $('city-value').textContent = `${Math.round(s.cityBrightness * 100)}%`;
  $('city-description').textContent = s.cityBrightness === 0 ? 'City lights and artificial skyglow are off; natural moonlight remains.' : 'Scales city lights and skyglow. Brighter cities hide more faint stars.';
  $('stars-readout').textContent = `${(s.visibleStars || 0).toLocaleString()} stars pass the brightness model, before terrain occlusion · date, Moon, and city brightness linked.`;
  $('satellite').setAttribute('aria-pressed', String(s.surface === 'satellite'));
  $('relief').setAttribute('aria-pressed', String(s.surface === 'relief'));
  $('terrain-status').textContent = s.terrainStatus;
  $('building-status').textContent = s.buildingsStatus;
  $('imagery-status').textContent = s.imageryStatus;
  $('connection-dot').classList.toggle('connected', s.ready);
  $('connection-label').textContent = s.ready
    ? s.source === 'evaluation' ? 'Evaluation data · connect your token' : 'Cesium ion connected'
    : 'Connect geographic data';
  $('data-status').textContent = s.ready ? `${s.terrainStatus} · ${s.buildingsStatus}` : s.terrainStatus;
  $('loading-card').hidden = s.ready;
  if (s.ready) $('app').classList.add('world-ready');
  scheduleDataUI();
}

try {
  world = new Observatory($('world'));
  world.addEventListener('change', event => updateUI(event.detail));
  world.addEventListener('datachange', scheduleDataUI);
  world.addEventListener('notice', event => toast(event.detail.message));
  const showError = message => {
    $('loading-card').hidden = false;
    $('loading-card').classList.add('connection-needed');
    $('loading-card').querySelector('h1').textContent = 'Your window to the ridge.';
    $('loading-message').textContent = message;
    $('loading-connect').hidden = false;
  };
  world.addEventListener('connection-error', event => showError(event.detail.message));
  world.addEventListener('error', event => showError(event.detail.message));
  updateUI(world.state);
  const configured = import.meta.env.VITE_CESIUM_ION_TOKEN
    || readStorage('sessionStorage', 'city-nights-ion-token')
    || readStorage('localStorage', 'city-nights-ion-token');
  const defaultToken = evaluationToken();
  world.connect(configured || defaultToken, configured ? 'personal' : 'evaluation');

  $('connect-form').addEventListener('submit', event => {
    event.preventDefault();
    const token = $('ion-token').value.trim();
    if (!token) { $('ion-token').focus(); toast('Paste your public Cesium ion token first.'); return; }
    saveToken(token, $('remember-token').checked);
    $('ion-token').value = '';
    $('connection-dialog').close();
    $('loading-card').classList.remove('connection-needed');
    $('loading-card').querySelector('h1').textContent = 'Finding the ridge.';
    $('loading-message').textContent = 'Connecting your terrain and building data.';
    $('loading-connect').hidden = true;
    world.connect(token, 'personal');
  });
  $('evaluation').addEventListener('click', () => {
    try { localStorage.removeItem('city-nights-ion-token'); sessionStorage.removeItem('city-nights-ion-token'); } catch { /* Storage may be disabled. */ }
    $('connection-dialog').close();
    $('loading-card').classList.remove('connection-needed');
    $('loading-message').textContent = 'Retrying Cesium evaluation access.';
    $('loading-connect').hidden = true;
    world.connect(defaultToken, 'evaluation');
  });
  $('home').addEventListener('click', () => world.reset());
  $('face-seattle').addEventListener('click', () => world.faceSeattle());
  $('eye-level').addEventListener('click', () => world.setHeight(6));
  $('height').addEventListener('change', event => {
    world.setHeight(Number(event.target.value)); updateUI(world.state);
  });
  $('height-range').addEventListener('input', event => world.setHeight(0.5 * 60000 ** (Number(event.target.value) / 1000)));
  $('speed').addEventListener('change', event => { world.state.speed = Number(event.target.value); });
  $('moonlight').addEventListener('input', event => world.setMoon(Number(event.target.value) / 100));
  $('moon-auto').addEventListener('click', () => world.setMoon(null));
  $('city-brightness').addEventListener('input', event => world.setCityBrightness(Number(event.target.value) / 100));
  $('city-reset').addEventListener('click', () => world.setCityBrightness(1));
  $('date-time').addEventListener('change', event => {
    try {
      const date = fromZonedInput(event.target.value);
      if (date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 2100) throw new Error('Choose a date from 1900 through 2100.');
      $('time-error').hidden = true;
      world.setTime(date);
    } catch {
      $('time-error').textContent = 'Choose a valid Pacific date and time. The spring daylight-saving gap does not exist.';
      $('time-error').hidden = false;
    }
  });
  $('earlier').addEventListener('click', () => world.setTime(new Date(world.state.date.getTime() - 3600000)));
  $('later').addEventListener('click', () => world.setTime(new Date(world.state.date.getTime() + 3600000)));
  $('tonight').addEventListener('click', () => {
    const today = toZonedInput(new Date()).slice(0, 10);
    world.setTime(fromZonedInput(`${today}T23:00`));
  });
  $('satellite').addEventListener('click', () => world.setSurface('satellite'));
  $('relief').addEventListener('click', () => world.setSurface('relief'));
} catch (error) {
  $('loading-card').classList.add('connection-needed');
  $('loading-card').querySelector('h1').textContent = 'A 3D-capable browser is needed.';
  $('loading-message').textContent = 'Enable WebGL and hardware acceleration in Chrome, Edge, or Firefox, then reload this page.';
  console.error('Unable to initialize observatory:', error);
}

$('data-button').addEventListener('click', () => { updateDataUI(); if (!$('status-dialog').open) $('status-dialog').show(); });
$('stream-status-button').addEventListener('click', () => { updateDataUI(); if (!$('status-dialog').open) $('status-dialog').show(); });
$('status-connection').addEventListener('click', () => { $('status-dialog').close(); showDialog('connection-dialog'); });
$('status-reset-quality').addEventListener('click', () => world?.resetQuality());
$('status-retry').addEventListener('click', () => {
  if (!world) return;
  world.keys.clear();
  toast('Retrying geographic data at your current viewpoint.');
  world.connect(evaluationToken(), world.state.source);
});
$('loading-connect').addEventListener('click', () => showDialog('connection-dialog'));
$('info').addEventListener('click', () => showDialog('about-dialog'));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
const setControls = open => {
  $('controls').classList.toggle('closed', !open);
  $('toggle-controls').setAttribute('aria-expanded', String(open));
  $('app').classList.toggle('controls-closed', !open);
};
$('toggle-controls').addEventListener('click', () => setControls($('controls').classList.contains('closed')));
$('close-controls').addEventListener('click', () => setControls(false));
if (window.innerWidth < 960) setControls(false);
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('Fullscreen is unavailable in this browser window.'); }
});
document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
