import test from 'node:test';
import assert from 'node:assert/strict';
import { Observatory } from '../src/world.js';
import { DataStatus } from '../src/data-status.js';

function controls() {
  return {
    state: { date: new Date('2026-10-22T06:00:00Z'), moonOverride: 1, cityBrightness: 1 },
    renders: 0, changes: 0,
    updateEnvironment() { this.renders++; },
    emit() { this.changes++; },
  };
}

test('changing the selected date restores automatic moonlight before recalculating the sky', () => {
  const control = controls();
  control.updateEnvironment = function () { assert.equal(this.state.moonOverride, null); this.renders++; };
  const date = new Date('2026-11-12T07:00:00Z');
  Observatory.prototype.setTime.call(control, date);
  assert.equal(control.state.date, date);
  assert.equal(control.state.moonOverride, null);
  assert.equal(control.renders, 1);
  assert.equal(control.changes, 1);
});

test('invalid date input does not discard the existing manual override', () => {
  const control = controls();
  Observatory.prototype.setTime.call(control, new Date('invalid'));
  assert.equal(control.state.moonOverride, 1);
  assert.equal(control.renders, 0);
});

test('city light intensity can be switched off or boosted without changing the date or Moon override', () => {
  const control = controls(); const date = control.state.date;
  Observatory.prototype.setCityBrightness.call(control, 0);
  assert.equal(control.state.cityBrightness, 0);
  Observatory.prototype.setCityBrightness.call(control, 3);
  assert.equal(control.state.cityBrightness, 3);
  Observatory.prototype.setCityBrightness.call(control, 20);
  assert.equal(control.state.cityBrightness, 3);
  Observatory.prototype.setCityBrightness.call(control, NaN);
  assert.equal(control.state.cityBrightness, 3);
  assert.equal(control.state.date, date);
  assert.equal(control.state.moonOverride, 1);
});

test('stationary views do not continuously refetch ground data and flash loading status', () => {
  let requests = 0;
  const location = { latitude: 47.8013888889, longitude: -122.9526944444 };
  const control = {
    state: { ...location, ready: true, groundHeight: 969 },
    lastGroundLocation: { ...location }, terrain: {}, bootstrapInFlight: null,
    lastSample: -Infinity, lastFrame: performance.now(), keys: new Set(),
    resolveGround() { requests++; },
  };
  Observatory.prototype.tick.call(control);
  assert.equal(requests, 0);
  control.state.latitude += 0.001;
  control.lastSample = -Infinity;
  Observatory.prototype.tick.call(control);
  assert.equal(requests, 1);
});

test('ground resolution failure prevents a ready status even with an empty tile queue', () => {
  const data = new DataStatus(); data.begin('terrain'); data.connected('terrain'); data.settle('terrain', true);
  const control = {
    data, catalog: [], groundFailure: true, groundRequest: null,
    state: { ready: true, surface: 'satellite', cityBrightness: 1 },
    viewer: { scene: { globe: { tilesLoaded: true } } },
  };
  Observatory.prototype.refreshDataStatus.call(control);
  assert.notEqual(data.snapshot().find(row => row.id === 'terrain').status, 'ready');
});
