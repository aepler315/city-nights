import {
  Body,
  Equator,
  Horizon,
  HorizonFromVector,
  Illumination,
  MoonPhase,
  Observer,
  RotateVector,
  Rotation_EQJ_HOR,
  Vector,
} from 'astronomy-engine';

const RADIANS = Math.PI / 180;
const AU_KM = 149597870.7;
const NATURAL_LUMINANCE = 0.0002;
const TIME_ZONE = 'America/Los_Angeles';
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const degrees = (radians) => radians / RADIANS;
const normalizeAzimuth = (value) => ((value % 360) + 360) % 360;

function validDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError('A valid Date is required.');
  }
}

function validLocation(latitude, longitude) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new RangeError('Latitude must be -90..90 and longitude -180..180 degrees.');
  }
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

/**
 * Date-correct astronomy, plus an explicitly estimated lighting response.
 * Angles are degrees; azimuth is clockwise from north. Elevation is metres
 * above mean sea level. Altitudes include standard atmospheric refraction;
 * geometric altitudes are also exposed for twilight and geometric comparisons.
 * moonPhase is the illuminated fraction (0 new, 1 full), not cycle position.
 * moonIntensity is a 0..1 rendering scale, NOT measured lux. An override changes
 * light only, preserves the dated phase/position, and is zero below the horizon.
 * twilight is 0 at astronomical night, 1 at/above geometric sunrise.
 * Refraction is standard, not weather-derived; eclipses do not dim this model.
 * API reference: https://github.com/cosinekitty/astronomy/tree/master/source/js
 */
export function computeSky({ date, latitude, longitude, elevation = 0, moonOverride = null }) {
  validDate(date);
  validLocation(latitude, longitude);
  if (!Number.isFinite(elevation)) throw new RangeError('Elevation must be finite metres.');
  if (moonOverride !== null && (!Number.isFinite(moonOverride) || moonOverride < 0 || moonOverride > 1)) {
    throw new RangeError('Moonlight override must be null or a number from 0 to 1.');
  }

  const observer = new Observer(latitude, longitude, elevation);
  const sunEquator = Equator(Body.Sun, date, observer, true, true);
  const moonEquator = Equator(Body.Moon, date, observer, true, true);
  const sun = Horizon(date, observer, sunEquator.ra, sunEquator.dec, 'normal');
  const moon = Horizon(date, observer, moonEquator.ra, moonEquator.dec, 'normal');
  const sunGeometric = Horizon(date, observer, sunEquator.ra, sunEquator.dec);
  const moonGeometric = Horizon(date, observer, moonEquator.ra, moonEquator.dec);
  const illumination = Illumination(Body.Moon, date);
  const moonCyclePhase = MoonPhase(date) / 360;
  const phaseFlux = clamp(10 ** (-0.4 * (illumination.mag + 12.74)));
  const automaticIntensity = phaseFlux * Math.max(0, Math.sin(moon.altitude * RADIANS));
  const moonIntensity = moon.altitude > 0 ? (moonOverride ?? automaticIntensity) : 0;
  const moonDistanceKm = moonEquator.dist * AU_KM;
  const deltaAzimuth = (sun.azimuth - moon.azimuth) * RADIANS;
  const moonAltitude = moon.altitude * RADIANS;
  const sunAltitude = sun.altitude * RADIANS;

  return {
    sunAltitude: sun.altitude,
    sunAzimuth: sun.azimuth,
    sunGeometricAltitude: sunGeometric.altitude,
    moonAltitude: moon.altitude,
    moonAzimuth: moon.azimuth,
    moonGeometricAltitude: moonGeometric.altitude,
    moonPhase: illumination.phase_fraction,
    moonCyclePhase,
    moonWaxing: moonCyclePhase < 0.5,
    moonPhaseAngle: illumination.phase_angle,
    moonDistanceKm,
    moonAngularDiameter: degrees(2 * Math.asin(1737.4 / moonDistanceKm)),
    // Direction toward the Sun on the lunar disk, clockwise from local sky up.
    moonBrightLimbAngle: degrees(Math.atan2(
      Math.cos(sunAltitude) * Math.sin(deltaAzimuth),
      Math.sin(sunAltitude) * Math.cos(moonAltitude)
        - Math.cos(sunAltitude) * Math.sin(moonAltitude) * Math.cos(deltaAzimuth),
    )),
    moonIntensity,
    moonOverride,
    twilight: smoothstep(-18, 0, sunGeometric.altitude),
  };
}

let starRotationCache;

/** J2000 right ascension in hours and declination in degrees -> local sky.
 * Precession/nutation and standard refraction are applied. Catalog proper
 * motion is not applied here. Rotation is shared across stars for one observer.
 */
export function starHorizontal(raHours, decDegrees, date, latitude, longitude) {
  validDate(date);
  validLocation(latitude, longitude);
  if (!Number.isFinite(raHours) || !Number.isFinite(decDegrees) || Math.abs(decDegrees) > 90) {
    throw new RangeError('Star coordinates must be finite, with declination -90..90 degrees.');
  }
  const timestamp = date.getTime();
  if (!starRotationCache || starRotationCache.timestamp !== timestamp
    || starRotationCache.latitude !== latitude || starRotationCache.longitude !== longitude) {
    starRotationCache = {
      timestamp,
      latitude,
      longitude,
      rotation: Rotation_EQJ_HOR(date, new Observer(latitude, longitude, 0)),
    };
  }
  const ra = raHours * 15 * RADIANS;
  const dec = decDegrees * RADIANS;
  const vector = new Vector(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), date);
  const horizontal = HorizonFromVector(RotateVector(starRotationCache.rotation, vector), 'normal');
  return { altitude: horizontal.lat, azimuth: horizontal.lon };
}

// Relative source weights are illustrative, not measured emission inventories.
const CITIES = [
  { latitude: 47.6062, longitude: -122.3321, strength: 1.0 }, // Seattle
  { latitude: 47.2529, longitude: -122.4443, strength: 0.55 }, // Tacoma
  { latitude: 47.9790, longitude: -122.2021, strength: 0.4 }, // Everett
  { latitude: 47.5673, longitude: -122.6326, strength: 0.3 }, // Bremerton
  { latitude: 48.1170, longitude: -122.7604, strength: 0.1 }, // Port Townsend
  { latitude: 48.4284, longitude: -123.3656, strength: 0.2 }, // Victoria
];
let sourceCache;

function pollutionSources(latitude, longitude) {
  if (sourceCache?.latitude === latitude && sourceCache.longitude === longitude) return sourceCache.sources;
  const lat = latitude * RADIANS;
  const sources = CITIES.map((city) => {
    const cityLat = city.latitude * RADIANS;
    const deltaLon = (city.longitude - longitude) * RADIANS;
    const deltaLat = cityLat - lat;
    const haversine = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat) * Math.cos(cityLat) * Math.sin(deltaLon / 2) ** 2;
    const distanceKm = 12742 * Math.asin(Math.sqrt(clamp(haversine)));
    const bearing = normalizeAzimuth(degrees(Math.atan2(
      Math.sin(deltaLon) * Math.cos(cityLat),
      Math.cos(lat) * Math.sin(cityLat) - Math.sin(lat) * Math.cos(cityLat) * Math.cos(deltaLon),
    )));
    return { bearing, strength: city.strength / (1 + (distanceKm / 55) ** 2) };
  });
  sourceCache = { latitude, longitude, sources };
  return sources;
}

/**
 * Estimated directional sky brightness, NOT a site photometric prediction.
 * pollution is a nonnegative multiplier (0 removes artificial light only).
 * Returns limitingMagnitude for a typical dark-adapted naked-eye observer,
 * glow 0..1 (artificial + lunar glow), and estimated luminance in cd/m².
 * Regional glow uses distance-weighted, broad city lobes. Moon washout depends
 * on its effective intensity and angular separation. Twilight is an estimated
 * exponential background. Clear-air stellar extinction remains even though
 * terrestrial rendering has unlimited visibility. No weather/terrain shielding
 * of scattering is modeled. Do not present these values as measured SQM data.
 * The low-light threshold uses Crumey eq. 53 with F=2; above 0.01 cd/m² a
 * continuous Weber-like extension avoids extrapolating that night formula.
 * https://arxiv.org/html/1405.4209v1 (sections 2 and 3.1)
 */
export function skyBrightness({ altitude, azimuth, latitude, longitude, sky, pollution = 1 }) {
  validLocation(latitude, longitude);
  if (!Number.isFinite(altitude) || Math.abs(altitude) > 90 || !Number.isFinite(azimuth)
    || !Number.isFinite(pollution) || pollution < 0) {
    throw new RangeError('Sky direction must be valid degrees and pollution must be nonnegative.');
  }
  const alt = Math.max(0, altitude);
  let directionalGlow = 0;
  for (const source of pollutionSources(latitude, longitude)) {
    const delta = ((azimuth - source.bearing + 540) % 360) - 180;
    directionalGlow += source.strength * Math.exp(-0.5 * (delta / 27) ** 2);
  }
  const artificial = NATURAL_LUMINANCE * pollution
    * (0.12 + 32 * directionalGlow * Math.exp(-alt / 16));
  const cosSeparation = Math.sin(altitude * RADIANS) * Math.sin(sky.moonAltitude * RADIANS)
    + Math.cos(altitude * RADIANS) * Math.cos(sky.moonAltitude * RADIANS)
      * Math.cos((azimuth - sky.moonAzimuth) * RADIANS);
  const separation = degrees(Math.acos(clamp(cosSeparation, -1, 1)));
  const lunar = sky.moonAltitude > 0
    ? 0.0035 * sky.moonIntensity * (0.25 + 2 * Math.exp(-separation / 25))
      * (1 + 1.2 * (1 - Math.sin(alt * RADIANS)))
    : 0;
  const sunAltitude = sky.sunGeometricAltitude ?? sky.sunAltitude;
  const twilightLuminance = sunAltitude <= -18 ? 0
    : sunAltitude < 0 ? 0.00001 * 10 ** ((sunAltitude + 18) / 3)
      : 10 * (1 + 20 * Math.sin(Math.min(90, sunAltitude) * RADIANS));
  const luminance = NATURAL_LUMINANCE + artificial + lunar + twilightLuminance;
  const nightLuminance = Math.min(luminance, 0.01);
  const threshold = 2 * (6.505e-4 * nightLuminance ** 0.25 - 8.461e-4 * Math.sqrt(nightLuminance)) ** 2
    * Math.max(1, luminance / 0.01);
  const airMass = 1 / (Math.sin(alt * RADIANS) + 0.50572 * (alt + 6.07995) ** -1.6364);
  const extinction = 0.12 * Math.max(0, airMass - 1);
  return {
    limitingMagnitude: clamp(-2.5 * Math.log10(threshold / 2.54e-6) - extinction, -10, 6.5),
    glow: (artificial + lunar) / (artificial + lunar + 0.003),
    pollutionGlow: artificial / (artificial + 0.003),
    moonGlow: lunar / (lunar + 0.003),
    luminance,
  };
}

const zonedFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function zonedParts(date) {
  return Object.fromEntries(zonedFormatter.formatToParts(date)
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
}

/** Format a UTC instant for datetime-local in America/Los_Angeles (PST/PDT). */
export function toZonedInput(date) {
  validDate(date);
  const parts = zonedParts(date);
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function utcFromParts(year, month, day, hour, minute, second = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date;
}

/**
 * Parse minute-precision Los Angeles local time without depending on host TZ.
 * Spring DST gaps throw RangeError. Repeated autumn times resolve to the
 * earlier occurrence (PDT). A datetime-local string cannot encode which fold.
 */
export function fromZonedInput(input) {
  const match = typeof input === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) throw new RangeError('Expected local time YYYY-MM-DDTHH:mm.');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const naive = utcFromParts(year, month, day, hour, minute);
  if (year < 1 || naive.getUTCFullYear() !== year || naive.getUTCMonth() !== month - 1
    || naive.getUTCDate() !== day || naive.getUTCHours() !== hour || naive.getUTCMinutes() !== minute) {
    throw new RangeError('Invalid calendar date or local time.');
  }
  const offsets = new Set();
  // Sampling both sides discovers both valid offsets at a DST transition.
  for (const delta of [-36, 0, 36]) {
    const instant = new Date(naive.getTime() + delta * 3600000);
    const parts = zonedParts(instant);
    const localAsUtc = utcFromParts(+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute, +parts.second);
    offsets.add(localAsUtc.getTime() - instant.getTime());
  }
  const candidates = [...offsets].map((offset) => new Date(naive.getTime() - offset))
    .filter((candidate) => toZonedInput(candidate) === input).sort((a, b) => a - b);
  if (!candidates.length) throw new RangeError('This local time does not exist because of a daylight-saving transition.');
  return candidates[0];
}
