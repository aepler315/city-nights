import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME,
  SEATTLE,
  LENSES,
  bearingDegrees,
  distanceMeters,
  moveLocation,
  horizontalFov,
  verticalFov,
  feetToMeters,
  metersToFeet,
  lookAtAngles,
} from '../src/geo.js';

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

test('Seattle is approximately 51 km east-southeast of the ridge', () => {
  close(bearingDegrees(HOME, SEATTLE), 115, 1);
  close(distanceMeters(HOME, SEATTLE), 51_000, 1_000);
});

test('great-circle distance is symmetric and zero for a stationary observer', () => {
  close(distanceMeters(HOME, SEATTLE), distanceMeters(SEATTLE, HOME));
  assert.equal(distanceMeters(HOME, HOME), 0);
});

test('cardinal bearings are measured clockwise from north', () => {
  const origin = { latitude: 0, longitude: 0 };
  assert.equal(bearingDegrees(origin, { latitude: 1, longitude: 0 }), 0);
  assert.equal(bearingDegrees(origin, { latitude: 0, longitude: 1 }), 90);
  assert.equal(bearingDegrees(origin, { latitude: -1, longitude: 0 }), 180);
  assert.equal(bearingDegrees(origin, { latitude: 0, longitude: -1 }), 270);
});

test('movement reaches the destination using its initial great-circle bearing', () => {
  const destination = moveLocation(HOME, bearingDegrees(HOME, SEATTLE), distanceMeters(HOME, SEATTLE));
  close(destination.latitude, SEATTLE.latitude);
  close(destination.longitude, SEATTLE.longitude);
});

test('zero movement preserves coordinates without mutating the input', () => {
  const origin = { latitude: 47.8, longitude: 179.9 };
  assert.deepEqual(moveLocation(origin, 90, 0), origin);
  assert.deepEqual(origin, { latitude: 47.8, longitude: 179.9 });
});

test('eastward movement crosses the date line without jumping latitude', () => {
  const destination = moveLocation({ latitude: 0, longitude: 179.9 }, 90, 30_000);
  close(destination.latitude, 0);
  close(destination.longitude, -179.830204, 0.000001);
});

test('movement remains finite when crossing a pole', () => {
  const destination = moveLocation({ latitude: 89.9, longitude: 20 }, 0, 30_000);
  close(destination.latitude, 89.830204, 0.000001);
  close(destination.longitude, -160);
});

test('a 50 mm lens uses the angular width of a 36 mm full-frame sensor', () => {
  close(horizontalFov(50), 39.597752709049864);
});

test('resizing changes vertical field of view while preserving horizontal framing', () => {
  const horizontal = horizontalFov(50);
  close(verticalFov(horizontal, 1), horizontal);
  close(verticalFov(horizontal, 16 / 9), 22.895192527371208);
  close(verticalFov(horizontal, 9 / 16), 65.23848614238565);
  close(horizontalFov(50), horizontal);
});

test('lens presets include the 60 degree eye view and progressively narrower lenses', () => {
  assert.equal(LENSES[0].id, 'naked-eye');
  assert.equal(LENSES[0].horizontalFov, 60);
  assert.deepEqual(LENSES.slice(1).map((lens) => lens.focalLength), [24, 35, 50, 85, 135, 200, 400, 800]);
  assert.ok(LENSES.at(-1).horizontalFov < 3);
  assert.ok(LENSES.slice(1).every((lens, index, lenses) => index === 0 || lens.horizontalFov < lenses[index - 1].horizontalFov));
});

test('six feet is exactly 1.8288 meters with a reversible unit conversion', () => {
  close(feetToMeters(6), 1.8288, 1e-12);
  close(metersToFeet(1.8288), 6, 1e-12);
});

test('optical functions reject unusable lenses and viewport dimensions', () => {
  for (const focalLength of [0, -1, NaN, Infinity]) {
    assert.throws(() => horizontalFov(focalLength), RangeError);
  }
  assert.throws(() => verticalFov(60, 0), RangeError);
  assert.throws(() => verticalFov(180, 1), RangeError);
});

test('look-at pitch includes half a degree of Earth curvature across one equatorial degree', () => {
  const aim = lookAtAngles(
    { latitude: 0, longitude: 0, height: 0 },
    { latitude: 0, longitude: 1, height: 0 },
  );
  close(aim.heading, 90);
  close(aim.pitch, -0.5);
});

test('a target directly above the observer has a vertical look-at pitch', () => {
  const aim = lookAtAngles(
    { ...HOME, height: 970 },
    { ...HOME, height: 1070 },
  );
  close(aim.pitch, 90);
});

test('Seattle framing from the ridge points down through the curved Earth geometry', () => {
  const aim = lookAtAngles(
    { ...HOME, height: 969 + feetToMeters(6) },
    { ...SEATTLE, height: 200 },
  );
  close(aim.heading, 115, 1);
  close(aim.pitch, -1.1, 0.1);
});

test('look-at rejects invalid coordinates, missing heights, and coincident points', () => {
  const origin = { latitude: 0, longitude: 0, height: 0 };
  assert.throws(() => lookAtAngles({ ...origin, latitude: 91 }, origin), RangeError);
  assert.throws(() => lookAtAngles(origin, { ...origin, longitude: NaN }), RangeError);
  assert.throws(() => lookAtAngles(origin, { latitude: 1, longitude: 1 }), RangeError);
  assert.throws(() => lookAtAngles(origin, origin), RangeError);
});
