// Turns noisy phone positions into progress along a bus route. It runs in the browser, so tracking
// on the bus carries on if the network drops.

const EARTH_KM = 6371
const DEG = Math.PI / 180

// Roads wander from the straight line between stops, more so across long gaps between towns.
const ROAD_WANDER_PER_KM = 0.15
const MIN_TOLERANCE_KM = { gps: 0.4, cell: 1.0 }
// Buses don't reverse along a route, so apparent backward movement is treated as position noise.
const BACKWARD_ALLOWANCE_KM = { gps: 0.15, cell: 0.3 }
const MAX_BUS_KMH = 100
// Even a perfect-looking fix is only trusted this far, in km. Towers are never that precise.
const MIN_FIX_ERROR_KM = { gps: 0.02, cell: 0.3 }
const DEFAULT_SPEED_KMH = 20
// How unsure the starting speed is. Timetables can be well off, so readings soon take over from it.
const STARTING_SPEED_VARIANCE = 25 ** 2
// How quickly a bus's speed is expected to change, in km²/h³. Chosen by simulating noisy journeys:
// higher values chase tower noise, and precise GPS fixes correct real speed changes regardless.
const SPEED_CHANGE_RATE = 500
// How much a bus can differ from the prediction with each fix, in km². Without this the filter grows
// overconfident and ignores even a precise GPS fix after a sudden change.
const POSITION_WANDER_VARIANCE = 0.1 ** 2

export function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * DEG
  const dLon = (bLon - aLon) * DEG
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h))
}

// Every gap between stops that the position could belong to, with the distance travelled there.
function candidates(stops, lat, lon, toleranceKm) {
  const cos = Math.cos(lat * DEG)
  const found = []
  let closestOutsideKm = Infinity
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    const ax = (a.lon - lon) * cos
    const ay = a.lat - lat
    const dx = (b.lon - lon) * cos - ax
    const dy = b.lat - lat - ay
    const len = dx * dx + dy * dy
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len))
    const offKm = Math.hypot(ax + t * dx, ay + t * dy) * DEG * EARTH_KM
    const outsideKm = Math.max(0, offKm - ROAD_WANDER_PER_KM * (b.km - a.km))
    closestOutsideKm = Math.min(closestOutsideKm, outsideKm)
    if (outsideKm <= toleranceKm) {
      found.push({ km: a.km + t * (b.km - a.km), offKm })
    }
  }
  return { found, closestOutsideKm }
}

/**
 * Updates the tracked position from a new fix. This is a Kalman filter along the route, tracking
 * both distance and speed. It predicts where the bus should be, then corrects both according to how
 * much each can be trusted: a precise GPS fix takes over almost entirely, while a coarse tower position
 * only nudges the estimate, which steadies it as the phone hands over from tower to tower.
 *
 * Speed is learned from the fixes themselves, so a stopped bus or a wrong timetable can't throw it off.
 *
 * @param prev the previous result, or null when tracking starts
 * @param fix {lat, lon, accuracy (metres), at (ms)}
 * @param source 'gps' or 'cell'
 * @param startSpeedKmh the bus's usual speed along this route, used until fixes show its real speed
 * @returns {km, at, filter, onRoute, offRouteKm}. km holds its last value while off the route.
 */
export function updatePosition(stops, prev, fix, source, startSpeedKmh = DEFAULT_SPEED_KMH) {
  const toleranceKm = Math.max(MIN_TOLERANCE_KM[source], fix.accuracy / 1000)
  const { found, closestOutsideKm } = candidates(stops, fix.lat, fix.lon, toleranceKm)

  if (found.length === 0) {
    return { km: prev?.km ?? null, at: prev?.at ?? null, filter: prev?.filter, onRoute: false, offRouteKm: closestOutsideKm }
  }

  const fixVariance = Math.max(MIN_FIX_ERROR_KM[source], fix.accuracy / 1000) ** 2
  const startFilter = { speed: startSpeedKmh, kmVariance: fixVariance, covariance: 0, speedVariance: STARTING_SPEED_VARIANCE }

  if (prev?.km == null) {
    const best = found.reduce((x, y) => (y.offKm < x.offKm ? y : x))
    return { km: best.km, at: fix.at, filter: startFilter, onRoute: true, offRouteKm: 0 }
  }

  const filter = prev.filter ?? startFilter
  const hours = Math.max(0, fix.at - prev.at) / 3_600_000
  const totalKm = stops[stops.length - 1].km
  const predicted = Math.min(totalKm, prev.km + filter.speed * hours)

  // Routes can double back past the same road, so staying near the prediction picks the right pass.
  // Distance from the line matters too: just past a stop, the gap behind still offers its far end,
  // which is close to the prediction but away from the fix. Choosing that would freeze the bus there.
  const score = (c) => Math.abs(c.km - predicted) + 2 * c.offKm
  const best = found.reduce((x, y) => (score(y) < score(x) ? y : x))
  const furthest = prev.km + MAX_BUS_KMH * hours + toleranceKm
  const surprise = Math.min(furthest, best.km) - predicted

  const kmVariance = filter.kmVariance + 2 * filter.covariance * hours + filter.speedVariance * hours ** 2 + POSITION_WANDER_VARIANCE
  const covariance = filter.covariance + filter.speedVariance * hours
  const speedVariance = filter.speedVariance + SPEED_CHANGE_RATE * hours
  const kmGain = kmVariance / (kmVariance + fixVariance)
  const speedGain = covariance / (kmVariance + fixVariance)

  // Applied to the result rather than the fix, so noise in both directions evens out.
  const floor = prev.km - BACKWARD_ALLOWANCE_KM[source]
  return {
    km: Math.max(floor, Math.min(totalKm, predicted + kmGain * surprise)),
    at: fix.at,
    filter: {
      speed: Math.max(0, Math.min(MAX_BUS_KMH, filter.speed + speedGain * surprise)),
      kmVariance: (1 - kmGain) * kmVariance,
      covariance: (1 - kmGain) * covariance,
      speedVariance: speedVariance - speedGain * covariance,
    },
    onRoute: true,
    offRouteKm: 0,
  }
}

/** Seconds after departure at which the timetable has the bus at a distance along the route. */
export function offsetAtKm(stops, offsets, km) {
  if (km <= stops[0].km) return offsets[0]
  for (let i = 0; i + 1 < stops.length; i++) {
    if (km <= stops[i + 1].km) {
      const span = stops[i + 1].km - stops[i].km
      const t = span === 0 ? 0 : (km - stops[i].km) / span
      return offsets[i] + t * (offsets[i + 1] - offsets[i])
    }
  }
  return offsets[offsets.length - 1]
}

/** Distance along the route at which the timetable has the bus, a number of seconds after departure. */
export function kmAtOffset(stops, offsets, sec) {
  if (sec <= offsets[0]) return stops[0].km
  for (let i = 0; i + 1 < offsets.length; i++) {
    if (sec <= offsets[i + 1]) {
      const span = offsets[i + 1] - offsets[i]
      const t = span === 0 ? 0 : (sec - offsets[i]) / span
      return stops[i].km + t * (stops[i + 1].km - stops[i].km)
    }
  }
  return stops[stops.length - 1].km
}

/** Seconds between the clock and when a departure should be at this distance along the route. */
export function scheduleDifference(departure, totalKm, km, nowSec) {
  const expected = departure.startSec + departure.durationSec * (totalKm === 0 ? 0 : km / totalKm)
  return Math.abs(nowSec - expected)
}

/**
 * Finds which departure a bus or rider is probably on: the one the timetable has nearest that
 * position right now. Uses each departure's total duration, so it's approximate but needs no downloads.
 *
 * @param maxDiffSec how far from the timetable still counts as a match
 * @returns {departure, diff}, or null if no departure is close enough
 */
export function nearestDeparture(departures, totalKm, km, nowSec, maxDiffSec = 3600) {
  let best = null
  let bestDiff = maxDiffSec
  for (const d of departures) {
    const diff = scheduleDifference(d, totalKm, km, nowSec)
    if (diff < bestDiff) {
      best = d
      bestDiff = diff
    }
  }
  return best && { departure: best, diff: bestDiff }
}

/** Index of the last stop the bus has reached at this distance. */
export function lastStopIndex(stops, km) {
  let index = 0
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].km <= km + 0.02) index = i
  }
  return index
}
