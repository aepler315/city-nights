import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeSky,
  starHorizontal,
  skyBrightness,
  toZonedInput,
  fromZonedInput,
} from '../src/sky.js';

const site = { latitude: 47.801388889, longitude: -122.952694444, elevation: 300 };

test('summer midday Sun uses degrees clockwise from north at the Quilcene site', () => {
  const sky = computeSky({ ...site, date: new Date('2026-06-21T20:00:00Z') });
  assert.ok(sky.sunAltitude > 60 && sky.sunAltitude < 67);
  assert.ok(sky.sunAzimuth > 160 && sky.sunAzimuth < 200);
  assert.equal(sky.twilight, 1);
});

test('Moon illumination follows known full and new moon dates', () => {
  const full = computeSky({ ...site, date: new Date('2024-01-26T08:00:00Z') });
  const eclipseNew = computeSky({ ...site, date: new Date('2024-04-08T18:21:00Z') });
  assert.ok(full.moonPhase > 0.98);
  assert.ok(eclipseNew.moonPhase < 0.002);
  assert.ok(full.moonAltitude > 0);
  assert.ok(full.moonIntensity > eclipseNew.moonIntensity);
  assert.ok(full.moonAngularDiameter > 0.45 && full.moonAngularDiameter < 0.6);
});

test('moonlight override changes brightness while preserving dated geometry and phase', () => {
  const date = new Date('2024-01-26T08:00:00Z');
  const dark = computeSky({ ...site, date, moonOverride: 0 });
  const bright = computeSky({ ...site, date, moonOverride: 1 });
  assert.equal(dark.moonAltitude, bright.moonAltitude);
  assert.equal(dark.moonAzimuth, bright.moonAzimuth);
  assert.equal(dark.moonPhase, bright.moonPhase);
  assert.equal(dark.moonIntensity, 0);
  assert.equal(bright.moonIntensity, 1);
  const direction = { ...site, altitude: 35, azimuth: 130, pollution: 1 };
  const darkSky = skyBrightness({ ...direction, sky: dark });
  const brightSky = skyBrightness({ ...direction, sky: bright });
  assert.ok(brightSky.limitingMagnitude < darkSky.limitingMagnitude);
  assert.ok(brightSky.glow > darkSky.glow);
});

test('a Moon below the horizon contributes no direct override moonlight', () => {
  const sky = computeSky({ ...site, date: new Date('2024-01-26T20:00:00Z'), moonOverride: 1 });
  assert.ok(sky.moonAltitude < 0);
  assert.equal(sky.moonIntensity, 0);
});

test('J2000 celestial north pole stays near observer latitude across time', () => {
  for (const hour of [0, 6, 12, 18]) {
    const date = new Date(`2000-01-01T${String(hour).padStart(2, '0')}:00:00Z`);
    const pole = starHorizontal(0, 90, date, site.latitude, site.longitude);
    assert.ok(Math.abs(pole.altitude - site.latitude) < 0.1);
    assert.ok(pole.azimuth < 0.1 || pole.azimuth > 359.9);
  }
});

test('the same catalog star moves with time and observer longitude', () => {
  const date = new Date('2026-10-21T06:00:00Z');
  const a = starHorizontal(6, 0, date, site.latitude, site.longitude);
  const later = starHorizontal(6, 0, new Date('2026-10-21T12:00:00Z'), site.latitude, site.longitude);
  const elsewhere = starHorizontal(6, 0, date, site.latitude, site.longitude + 90);
  assert.ok(Math.abs(a.altitude - later.altitude) > 10);
  assert.ok(Math.abs(a.altitude - elsewhere.altitude) > 10);
  assert.ok(a.azimuth >= 0 && a.azimuth < 360);
});

const darkNight = {
  sunAltitude: -25,
  sunGeometricAltitude: -25,
  sunAzimuth: 0,
  moonAltitude: -30,
  moonAzimuth: 200,
  moonIntensity: 0,
  twilight: 0,
};

test('regional pollution washes out stars most strongly toward Seattle near the horizon', () => {
  const view = { ...site, altitude: 8, sky: darkNight, pollution: 1 };
  const seattle = skyBrightness({ ...view, azimuth: 116 });
  const west = skyBrightness({ ...view, azimuth: 270 });
  const unpolluted = skyBrightness({ ...view, azimuth: 116, pollution: 0 });
  assert.ok(seattle.glow > west.glow);
  assert.ok(seattle.limitingMagnitude < west.limitingMagnitude);
  assert.ok(seattle.limitingMagnitude < unpolluted.limitingMagnitude);
  assert.equal(unpolluted.glow, 0);
});

test('city brightness from zero to three progressively hides faint stars while retaining dated moonlight', () => {
  const date = fromZonedInput('2024-01-26T00:00');
  const sky = Object.freeze(computeSky({ ...site, date }));
  assert.ok(sky.moonAltitude > 0);
  assert.ok(sky.moonIntensity > 0);
  const direction = { ...site, altitude: 8, azimuth: 116, sky };
  const levels = [0, 0.5, 1, 3].map((pollution) => skyBrightness({ ...direction, pollution }));

  assert.equal(levels[0].pollutionGlow, 0);
  assert.ok(levels[0].moonGlow > 0);
  for (let index = 1; index < levels.length; index++) {
    assert.ok(levels[index].limitingMagnitude < levels[index - 1].limitingMagnitude);
    assert.ok(levels[index].luminance > levels[index - 1].luminance);
    assert.ok(levels[index].pollutionGlow > levels[index - 1].pollutionGlow);
    assert.equal(levels[index].moonGlow, levels[0].moonGlow);
  }
});

test('selected Pacific night and day dates drive Sun, automatic Moon illumination, and star visibility together', () => {
  const night = computeSky({ ...site, date: fromZonedInput('2024-01-26T00:00') });
  const day = computeSky({ ...site, date: fromZonedInput('2024-01-26T12:00') });
  assert.ok(night.sunGeometricAltitude < -18);
  assert.ok(night.moonAltitude > 0);
  assert.ok(night.moonPhase > 0.98);
  assert.ok(night.moonIntensity > 0);
  assert.ok(day.sunGeometricAltitude > 0);
  assert.ok(day.moonAltitude < 0);
  assert.equal(day.moonIntensity, 0);

  const direction = { ...site, altitude: 35, azimuth: 130, pollution: 1 };
  const nightVisibility = skyBrightness({ ...direction, sky: night });
  const dayVisibility = skyBrightness({ ...direction, sky: day });
  assert.ok(nightVisibility.limitingMagnitude > 3);
  assert.ok(dayVisibility.limitingMagnitude < 0);
  assert.ok(dayVisibility.luminance > nightVisibility.luminance);
});

test('daylight suppresses catalog stars while an unpolluted night retains typical naked-eye stars', () => {
  const view = { ...site, altitude: 75, azimuth: 180, pollution: 0 };
  const night = skyBrightness({ ...view, sky: darkNight });
  const day = computeSky({ ...site, date: new Date('2026-06-21T20:00:00Z') });
  const daylight = skyBrightness({ ...view, sky: day });
  assert.ok(night.limitingMagnitude > 5.5 && night.limitingMagnitude < 6.7);
  assert.ok(daylight.limitingMagnitude < -1.5);
  assert.ok(Number.isFinite(daylight.glow));
});

test('Los Angeles local input uses PST and PDT independently of the host timezone', () => {
  assert.equal(toZonedInput(new Date('2026-01-15T06:15:00Z')), '2026-01-14T22:15');
  assert.equal(toZonedInput(new Date('2026-07-05T05:15:00Z')), '2026-07-04T22:15');
  assert.equal(fromZonedInput('2026-01-14T22:15').toISOString(), '2026-01-15T06:15:00.000Z');
  assert.equal(fromZonedInput('2026-07-04T22:15').toISOString(), '2026-07-05T05:15:00.000Z');
});

test('local time rejects the spring DST gap and resolves the repeated autumn hour to its earlier occurrence', () => {
  assert.throws(() => fromZonedInput('2026-03-08T02:30'), /nonexistent|does not exist/i);
  assert.equal(fromZonedInput('2026-03-08T03:30').toISOString(), '2026-03-08T10:30:00.000Z');
  assert.equal(fromZonedInput('2026-11-01T01:30').toISOString(), '2026-11-01T08:30:00.000Z');
});

test('invalid calendar values and invalid astronomy inputs fail explicitly', () => {
  assert.throws(() => fromZonedInput('2026-02-29T22:00'), RangeError);
  assert.throws(() => fromZonedInput('2026-07-04T24:00'), RangeError);
  assert.throws(() => fromZonedInput('not-a-date'), RangeError);
  assert.throws(() => toZonedInput(new Date('invalid')), RangeError);
  assert.throws(() => computeSky({ ...site, date: new Date('invalid') }), RangeError);
  assert.throws(() => computeSky({ ...site, latitude: 95, date: new Date() }), RangeError);
  assert.throws(() => computeSky({ ...site, date: new Date(), moonOverride: 2 }), RangeError);
});
