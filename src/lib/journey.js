import { kmAtOffset, lastStopIndex, nearestDeparture, offsetAtKm } from './tracker.js'
import { clockForTrip } from './time.js'

// How far a live bus can sit outside its trip's window and still count as running that trip. Beyond
// this (e.g. a night bus with no matching trip in a daytime-only feed) its real position is shown
// but arrival times are left blank, since the timetable has none and we never invent them.
const SCHEDULE_SLACK_SEC = 45 * 60

/**
 * Works out what to show for a trip right now. The rider's own phone comes first, then GPS on the bus,
 * then other riders, then the timetable. Timetable positions are only estimates, so have no delay figure.
 *
 * @param phoneKm the phone's km along the route if it's on the route, otherwise null
 * @param bus the live bus believed to be running this trip, or null
 * @param live the latest rider status from the server, or null
 * @param timetabled false for a line with no published timetable. Then only a live position places the
 *        train, there are no times, and without one the phase is 'unknown'.
 */
export function describeJourney({ stops, trip, nowSec, phoneKm, bus, live, mode, timetabled = true }) {
  const { offsets, startSec } = trip
  const duration = offsets[offsets.length - 1]
  const clock = clockForTrip(nowSec, startSec, duration)
  const elapsed = clock - startSec

  let source = 'timetable'
  let km = null
  if (phoneKm != null) {
    source = mode
    km = phoneKm
  } else if (bus) {
    source = 'bus'
    km = bus.km
  } else if (live?.riders > 0 && live.km != null) {
    source = 'riders'
    km = live.km
  }

  if (!timetabled) {
    const noTimes = stops.map(() => null)
    if (source === 'timetable') return { phase: 'unknown', source, km: 0, last: -1, delaySec: null, eta: noTimes, untimed: true }
    const last = lastStopIndex(stops, km)
    return { phase: last === stops.length - 1 ? 'finished' : 'running', source, km, last, delaySec: null, eta: noTimes, untimed: true }
  }

  if (source === 'timetable') {
    if (elapsed < 0) return { phase: 'not-started', source, km: 0, last: -1, delaySec: null, startsInSec: -elapsed, eta: stops.map((_, i) => startSec + offsets[i]) }
    if (elapsed > duration) return { phase: 'finished', source, km: stops[stops.length - 1].km, last: stops.length - 1, delaySec: null, eta: stops.map((_, i) => startSec + offsets[i]) }
    km = kmAtOffset(stops, offsets, elapsed)
  }

  const last = lastStopIndex(stops, km)
  const arrived = last === stops.length - 1
  const phase = arrived ? 'finished' : 'running'
  const isLive = source !== 'timetable'

  // A live bus can run when its trip's schedule is long over (night, with a daytime-only feed). Its
  // position is real, and so are the timetable's travel times between stops on this route, so stops
  // ahead get now plus the travel time from where the bus is, and stops behind get now minus it.
  // The ones behind are approximate (passedApprox), as nothing recorded when the bus passed them.
  if (isLive && (elapsed < -SCHEDULE_SLACK_SEC || elapsed > duration + SCHEDULE_SLACK_SEC)) {
    const here = offsetAtKm(stops, offsets, km)
    const eta = stops.map((_, i) => clock + (offsets[i] - here))
    return { phase, source, km, last, delaySec: null, eta, offSchedule: true, passedApprox: true, clock }
  }

  const delaySec = isLive ? elapsed - offsetAtKm(stops, offsets, km) : null
  // The same delay applies either side of the bus, so times always run forward down the route.
  // The clock caps both: stops behind can't be in the future, and stops ahead can't be in the past.
  const eta = stops.map((_, i) => {
    const scheduled = startSec + offsets[i]
    if (delaySec == null) return scheduled
    const expected = scheduled + delaySec
    return i > last ? Math.max(clock, expected) : Math.min(clock, expected)
  })

  return { phase, source, km, last, delaySec, eta, clock }
}

const ROUTE_END_KM = 0.3

/** Whether a bus has reached the end of the route. */
export function atRouteEnd(bus, totalKm) {
  return totalKm - bus.km <= ROUTE_END_KM
}

/** Which departure to open when nobody has chosen: the latest started that has a running bus, else the soonest. */
export function departureWithBus(departures, assigned, nowSec) {
  const withBus = departures.filter((d) => assigned.has(d.tripId))
  return withBus.findLast((d) => d.startSec <= nowSec) ?? withBus[0] ?? null
}

/**
 * Live positions say which route a bus is on but not which departure, so each bus is matched to the
 * departure the timetable puts nearest it right now. If two match one departure, the closer one wins.
 * Buses at the end of the route have finished, and are usually just parked, so they aren't matched.
 *
 * @returns a map from trip ID to its bus
 */
export function assignBuses(buses, departures, totalKm, nowSec) {
  const best = new Map()
  for (const bus of buses.filter((b) => !atRouteEnd(b, totalKm))) {
    const match = nearestDeparture(departures, totalKm, bus.km, nowSec)
    if (match) {
      const current = best.get(match.departure.tripId)
      if (!current || match.diff < current.diff) best.set(match.departure.tripId, { bus, diff: match.diff })
    }
  }
  return new Map([...best].map(([tripId, { bus }]) => [tripId, bus]))
}

/** Departure to show first: the latest one under way now, otherwise the next one, otherwise the last. */
export function defaultDeparture(departures, nowSec) {
  let running = null
  let next = null
  for (const d of departures) {
    const clock = clockForTrip(nowSec, d.startSec, d.durationSec)
    if (d.startSec <= clock && clock <= d.startSec + d.durationSec) running = d
    if (next == null && d.startSec > nowSec) next = d
  }
  return running ?? next ?? departures[departures.length - 1] ?? null
}

// Within this of a stop, the bus counts as at it.
export const AT_STOP_KM = 0.05

/**
 * What to say beside the bus: how far it is to the next stop and that stop's name, or the stop it's
 * standing at. distanceKm is null when the bus is at a stop or past the last one.
 */
export function nextStopInfo(stops, km, last) {
  const here = stops[Math.max(0, last)]
  if (last >= 0 && km - here.km < AT_STOP_KM) return { index: Math.max(0, last), name: here.name, distanceKm: null }
  const next = stops[last + 1]
  if (!next) return { index: last, name: here.name, distanceKm: null }
  return { index: last + 1, name: next.name, distanceKm: Math.max(0, next.km - km) }
}

/** The map position km along the route, on the straight line between the stops either side. */
export function pointAtKm(stops, km) {
  if (km <= stops[0].km) return [stops[0].lat, stops[0].lon]
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (km <= b.km) {
      const t = b.km > a.km ? (km - a.km) / (b.km - a.km) : 0
      return [a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon)]
    }
  }
  const end = stops[stops.length - 1]
  return [end.lat, end.lon]
}
