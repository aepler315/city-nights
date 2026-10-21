/**
 * Approximate navigation on a sphere of mean Earth radius, in degrees/meters.
 * Cesium supplies WGS84 globe rendering and terrain/building occlusion; these
 * lightweight navigation estimates do not calculate visibility or refraction.
 * Look-at directions use WGS84 ECEF geometry and the observer's local ENU frame.
 * Lens angles use a rectilinear 36 mm full-frame sensor width, in degrees.
 */
export const HOME = Object.freeze({
  latitude: 47.80138888888889,
  longitude: -122.95269444444445,
});

export const SEATTLE = Object.freeze({ latitude: 47.6062, longitude: -122.3321 });

const EARTH_RADIUS_METERS = 6_371_008.8;
const RADIANS_PER_DEGREE = Math.PI / 180;
const METERS_PER_FOOT = 0.3048;
const radians = (degrees) => degrees * RADIANS_PER_DEGREE;
const degrees = (radiansValue) => radiansValue / RADIANS_PER_DEGREE;
const clampUnit = (value) => Math.max(-1, Math.min(1, value));
const normalizeLongitude = (longitude) => ((longitude + 180) % 360 + 360) % 360 - 180;

/** Initial great-circle heading, clockwise from north in [0, 360). */
export function bearingDegrees(from, to) {
  const startLatitude = radians(from.latitude);
  const endLatitude = radians(to.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const east = Math.sin(deltaLongitude) * Math.cos(endLatitude);
  const north = Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(deltaLongitude);
  return (degrees(Math.atan2(east, north)) + 360) % 360;
}

/**
 * Aim at a WGS84 position using degrees clockwise from north and pitch above
 * the observer's local horizontal. Both positions require ellipsoid height in
 * meters. This includes Earth curvature, but does not test terrain visibility
 * or atmospheric refraction. A vertical target has an arbitrary heading of 0.
 */
export function lookAtAngles(observer, target) {
  const semiMajorAxis = 6_378_137;
  const flattening = 1 / 298.257223563;
  const eccentricitySquared = flattening * (2 - flattening);
  const ecef = (position) => {
    if (!Number.isFinite(position?.latitude) || Math.abs(position.latitude) > 90
      || !Number.isFinite(position?.longitude) || Math.abs(position.longitude) > 180
      || !Number.isFinite(position?.height)) {
      throw new RangeError('Look-at positions require valid latitude, longitude, and finite ellipsoid height.');
    }
    const latitude = radians(position.latitude);
    const longitude = radians(position.longitude);
    const normalRadius = semiMajorAxis / Math.sqrt(1 - eccentricitySquared * Math.sin(latitude) ** 2);
    return [
      (normalRadius + position.height) * Math.cos(latitude) * Math.cos(longitude),
      (normalRadius + position.height) * Math.cos(latitude) * Math.sin(longitude),
      (normalRadius * (1 - eccentricitySquared) + position.height) * Math.sin(latitude),
    ];
  };
  const start = ecef(observer);
  const end = ecef(target);
  const [dx, dy, dz] = end.map((component, index) => component - start[index]);
  if (Math.hypot(dx, dy, dz) < 1e-8) throw new RangeError('Coincident positions have no look-at direction.');
  const latitude = radians(observer.latitude);
  const longitude = radians(observer.longitude);
  const east = -Math.sin(longitude) * dx + Math.cos(longitude) * dy;
  const north = -Math.sin(latitude) * Math.cos(longitude) * dx
    - Math.sin(latitude) * Math.sin(longitude) * dy + Math.cos(latitude) * dz;
  const up = Math.cos(latitude) * Math.cos(longitude) * dx
    + Math.cos(latitude) * Math.sin(longitude) * dy + Math.sin(latitude) * dz;
  const horizontal = Math.hypot(east, north);
  return {
    heading: horizontal < 1e-8 ? 0 : (degrees(Math.atan2(east, north)) + 360) % 360,
    pitch: degrees(Math.atan2(up, horizontal)),
  };
}

/** Great-circle surface distance using the mean spherical Earth approximation. */
export function distanceMeters(from, to) {
  const startLatitude = radians(from.latitude);
  const endLatitude = radians(to.latitude);
  const halfLatitude = radians(to.latitude - from.latitude) / 2;
  const halfLongitude = radians(to.longitude - from.longitude) / 2;
  const haversine = Math.sin(halfLatitude) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(halfLongitude) ** 2;
  const bounded = Math.max(0, Math.min(1, haversine));
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

/**
 * Move along a great circle from a valid latitude/longitude without mutation.
 * Distance is in meters, bearing in degrees; longitudes wrap to [-180, 180).
 */
export function moveLocation(location, headingDegrees, travelMeters) {
  if (travelMeters === 0) return { ...location };
  const latitude = radians(location.latitude);
  const longitude = radians(location.longitude);
  const heading = radians(headingDegrees);
  const arc = travelMeters / EARTH_RADIUS_METERS;
  const destinationLatitude = Math.asin(clampUnit(
    Math.sin(latitude) * Math.cos(arc)
    + Math.cos(latitude) * Math.sin(arc) * Math.cos(heading),
  ));
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(heading) * Math.sin(arc) * Math.cos(latitude),
    Math.cos(arc) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );
  return {
    latitude: degrees(destinationLatitude),
    longitude: normalizeLongitude(degrees(destinationLongitude)),
  };
}

/** Horizontal angular field of view for a full-frame focal length in mm. */
export function horizontalFov(focalLengthMm) {
  if (!Number.isFinite(focalLengthMm) || focalLengthMm <= 0) {
    throw new RangeError('Focal length must be a positive finite number.');
  }
  return degrees(2 * Math.atan(36 / (2 * focalLengthMm)));
}

/** Vertical angle for a fixed horizontal field of view and width/height aspect. */
export function verticalFov(horizontalFovDegrees, aspect) {
  if (!Number.isFinite(horizontalFovDegrees) || horizontalFovDegrees <= 0 || horizontalFovDegrees >= 180
    || !Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('Field of view must be between 0 and 180 degrees and aspect must be positive.');
  }
  return degrees(2 * Math.atan(Math.tan(radians(horizontalFovDegrees) / 2) / aspect));
}

export const feetToMeters = (feet) => feet * METERS_PER_FOOT;
export const metersToFeet = (meters) => meters / METERS_PER_FOOT;

/** Naked eye is an explicit 60 degree view; lens names are full-frame equivalents. */
export const LENSES = Object.freeze([
  Object.freeze({ id: 'naked-eye', label: 'Naked eye', focalLength: null, horizontalFov: 60 }),
  ...[24, 35, 50, 85, 135, 200, 400, 800].map((focalLength) => Object.freeze({
    id: `${focalLength}mm`,
    label: `${focalLength} mm`,
    focalLength,
    horizontalFov: horizontalFov(focalLength),
  })),
]);
