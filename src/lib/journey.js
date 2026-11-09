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
 */
export function describeJourney({ stops, trip, nowSec, phoneKm, bus, live, mode }) {
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
