import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignBuses, atRouteEnd, defaultDeparture, departureWithBus, describeJourney, nextStopInfo, pointAtKm } from './journey.js'
import { clockForTrip, formatClock, formatDistance, formatDuration } from './time.js'

const stops = [
  { km: 0, lat: 18, lon: 73 },
  { km: 10, lat: 18.09, lon: 73 },
  { km: 20, lat: 18.18, lon: 73 },
]
const trip = { startSec: 36000, offsets: [0, 1800, 3600] } // 10:00 to 11:00
const base = { stops, trip, live: null, mode: 'off', phoneKm: null }

test('without any live source, position is a timetable estimate with no delay figure', () => {
  const j = describeJourney({ ...base, nowSec: 36000 + 900 })
  assert.equal(j.source, 'timetable')
  assert.equal(j.km, 5)
  assert.equal(j.delaySec, null)
  assert.equal(j.phase, 'running')
})

test('timetable shows not started and finished', () => {
  assert.equal(describeJourney({ ...base, nowSec: 35000 }).phase, 'not-started')
  assert.equal(describeJourney({ ...base, nowSec: 40000 }).phase, 'finished')
})

test('phone position gives a delay and pushes later stops back', () => {
  // At 10:40 the bus is at km 10, where the timetable says 10:30: 10 minutes late.
  const j = describeJourney({ ...base, mode: 'gps', phoneKm: 10, nowSec: 36000 + 2400 })
  assert.equal(j.source, 'gps')
  assert.equal(j.delaySec, 600)
  assert.equal(j.last, 1)
  assert.equal(j.eta[2], 36000 + 3600 + 600)
})

test('times run forward down the route for a bus running early or late', () => {
  for (const nowSec of [36000 + 600, 36000 + 2400]) {
    const { eta } = describeJourney({ ...base, mode: 'gps', phoneKm: 10, nowSec })
    assert.ok(eta[0] <= eta[1] && eta[1] <= eta[2], `out of order at ${nowSec}: ${eta}`)
    assert.ok(eta[1] <= nowSec, 'a stop behind the bus is not in the future')
    assert.ok(eta[2] >= nowSec, 'a stop ahead of the bus is not in the past')
  }
})

test('riders are used when the phone has no position, and the phone beats riders', () => {
  const live = { riders: 3, km: 10 }
  const fromRiders = describeJourney({ ...base, live, nowSec: 36000 + 1800 })
  assert.equal(fromRiders.source, 'riders')
  assert.equal(fromRiders.delaySec, 0)
  const fromPhone = describeJourney({ ...base, live, mode: 'cell', phoneKm: 5, nowSec: 36000 + 1800 })
  assert.equal(fromPhone.source, 'cell')
  assert.equal(fromPhone.km, 5)
})

test('GPS on the bus beats riders and the timetable, but the phone beats it', () => {
  const bus = { plate: 'MH12SX5185', km: 10, ageSec: 60 }
  const live = { riders: 3, km: 5 }
  const j = describeJourney({ ...base, bus, live, nowSec: 36000 + 2400 })
  assert.equal(j.source, 'bus')
  assert.equal(j.km, 10)
  assert.equal(j.delaySec, 600)
  assert.equal(describeJourney({ ...base, bus, mode: 'gps', phoneKm: 2, nowSec: 36000 + 2400 }).source, 'gps')
})

test('a live bus outside its trip window gets times from its position and the published travel times', () => {
  const bus = { plate: 'X', km: 10, ageSec: 60 }
  // 11:50, well past this 10:00–11:00 trip, as with a night bus and a daytime-only feed.
  const j = describeJourney({ ...base, bus, nowSec: 42600 })
  assert.equal(j.source, 'bus')
  assert.equal(j.km, 10)
  assert.equal(j.delaySec, null, 'no late or early figure without a matching trip')
  assert.equal(j.offSchedule, true)
  // The timetable takes 30 minutes between each pair of stops.
  assert.equal(j.eta[2], 42600 + 1800, 'stop ahead: now plus the travel time')
  assert.equal(j.eta[1], 42600, 'the stop it is at: now')
  assert.equal(j.eta[0], 42600 - 1800, 'stop behind: worked back from the travel time')
  assert.equal(j.passedApprox, true)
})

test('a live bus between stops off the timetable uses the remaining part of the travel time', () => {
  // Halfway between km 10 and km 20, so 15 of the 30 minutes are left.
  const j = describeJourney({ ...base, bus: { plate: 'X', km: 15, ageSec: 60 }, nowSec: 42600 })
  assert.equal(j.eta[2], 42600 + 900)
})

test('a live bus within its trip window reports a real delay', () => {
  const j = describeJourney({ ...base, bus: { plate: 'X', km: 10, ageSec: 60 }, nowSec: 36000 + 2400 })
  assert.equal(j.delaySec, 600)
  assert.ok(!j.offSchedule)
})

test('each live bus is matched to the departure the timetable puts nearest it', () => {
  const departures = [
    { tripId: 'nine', startSec: 9 * 3600, durationSec: 3600 },
    { tripId: 'ten', startSec: 10 * 3600, durationSec: 3600 },
  ]
  const now = 10 * 3600 + 35 * 60
  const late = { plate: 'A', km: 5 } // 15 minutes into the route at 10:35, so 20 late on the 10:00.
  const onTime = { plate: 'B', km: 10 } // Exactly where the 10:00 should be, around 10:30.
  const assigned = assignBuses([late, onTime], departures, 20, now)
  assert.equal(assigned.get('ten').plate, 'B', 'the closer bus keeps the departure')
  assert.equal(assigned.size, 1)
})

test('a bus parked at the end of the route is not matched to a departure', () => {
  const departures = [{ tripId: 'ten', startSec: 10 * 3600, durationSec: 3600 }]
  assert.equal(atRouteEnd({ km: 19.9 }, 20), true)
  assert.equal(atRouteEnd({ km: 15 }, 20), false)
  assert.equal(assignBuses([{ plate: 'A', km: 19.95 }], departures, 20, 10 * 3600 + 59 * 60).size, 0)
})

test('with nothing chosen, the latest started departure with a running bus opens', () => {
  const departures = [
    { tripId: 'nine', startSec: 9 * 3600, durationSec: 3600 },
    { tripId: 'ten', startSec: 10 * 3600, durationSec: 3600 },
    { tripId: 'noon', startSec: 12 * 3600, durationSec: 3600 },
  ]
  const assigned = new Map([['nine', {}], ['ten', {}], ['noon', {}]])
  assert.equal(departureWithBus(departures, assigned, 10.5 * 3600).tripId, 'ten')
  assert.equal(departureWithBus(departures, new Map([['noon', {}]]), 10.5 * 3600).tripId, 'noon')
  assert.equal(departureWithBus(departures, new Map(), 10.5 * 3600), null)
})

test('a bus nowhere near any departure is not matched to one', () => {
  const departures = [{ tripId: 'nine', startSec: 9 * 3600, durationSec: 3600 }]
  assert.equal(assignBuses([{ plate: 'A', km: 10 }], departures, 20, 20 * 3600).size, 0)
})

test('expected arrival is never in the past for a bus running early or stopped', () => {
  const j = describeJourney({ ...base, mode: 'gps', phoneKm: 2, nowSec: 36000 + 3550 })
  assert.ok(j.eta[2] >= 36000 + 3550)
})

test('reaching the last stop finishes the journey', () => {
  assert.equal(describeJourney({ ...base, mode: 'gps', phoneKm: 20, nowSec: 39000 }).phase, 'finished')
})

test('default departure prefers one under way, then the next', () => {
  const deps = [
    { tripId: 'a', startSec: 3600, durationSec: 1800 },
    { tripId: 'b', startSec: 7200, durationSec: 1800 },
    { tripId: 'c', startSec: 7500, durationSec: 1800 },
  ]
  assert.equal(defaultDeparture(deps, 7600).tripId, 'c')
  assert.equal(defaultDeparture(deps, 5000).tripId, 'a')
  assert.equal(defaultDeparture(deps, 6000).tripId, 'b')
  assert.equal(defaultDeparture(deps, 80000).tripId, 'c')
  assert.equal(defaultDeparture([], 100), null)
})

test('trip running past midnight is still under way in the early hours', () => {
  assert.equal(clockForTrip(600, 85000, 3000), 87000)
  assert.equal(clockForTrip(50000, 85000, 3000), 50000)
  const deps = [{ tripId: 'night', startSec: 85000, durationSec: 3000 }]
  assert.equal(defaultDeparture(deps, 600).tripId, 'night')
})

test('formats times for people', () => {
  assert.equal(formatClock(0), '00:00')
  assert.equal(formatClock(52200), '14:30')
  assert.equal(formatClock(90000), '01:00')
  assert.equal(formatDuration(45), '45 min')
  assert.equal(formatDuration(120), '2 h')
  assert.equal(formatDuration(135), '2 h 15 min')
})

test('distance to the next stop counts down in metres for the last kilometre', () => {
  assert.equal(formatDistance(0.4567), '460 m')
  assert.equal(formatDistance(0.999), '1.0 km')
  assert.equal(formatDistance(3.24), '3.2 km')
  assert.equal(formatDistance(21.4), '21 km')
  assert.equal(formatDistance(-0.01), '0 m')
})

const line = [
  { name: 'A', km: 0, lat: 18, lon: 73 },
  { name: 'B', km: 2, lat: 18.02, lon: 73 },
  { name: 'C', km: 5, lat: 18.02, lon: 73.03 },
]

test('the label names the next stop and the distance to it, or the stop the bus is at', () => {
  assert.deepEqual(nextStopInfo(line, 1.2, 0), { index: 1, name: 'B', distanceKm: 0.8 })
  assert.deepEqual(nextStopInfo(line, 2.02, 1), { index: 1, name: 'B', distanceKm: null })
  assert.deepEqual(nextStopInfo(line, 5, 2), { index: 2, name: 'C', distanceKm: null })
})

test('the bus is drawn on the line between the stops either side of it', () => {
  const near = ([a, b], [c, d]) => assert.ok(Math.abs(a - c) < 1e-9 && Math.abs(b - d) < 1e-9)
  near(pointAtKm(line, 1), [18.01, 73])
  assert.deepEqual(pointAtKm(line, -1), [18, 73])
  assert.deepEqual(pointAtKm(line, 9), [18.02, 73.03])
  const [lat, lon] = pointAtKm(line, 3.5)
  assert.ok(Math.abs(lat - 18.02) < 1e-9 && Math.abs(lon - 73.015) < 1e-9)
})

test('a line with no timetable is only placed by a live position, and never given times', () => {
  const stops = [{ km: 0 }, { km: 2 }, { km: 5 }]
  const trip = { startSec: 0, offsets: [0, 0, 0] }
  const unknown = describeJourney({ stops, trip, nowSec: 36000, phoneKm: null, bus: null, live: null, mode: 'off', timetabled: false })
  assert.equal(unknown.phase, 'unknown')
  assert.deepEqual(unknown.eta, [null, null, null])
  const tracked = describeJourney({ stops, trip, nowSec: 36000, phoneKm: 3, bus: null, live: null, mode: 'gps', timetabled: false })
  assert.equal(tracked.phase, 'running')
  assert.equal(tracked.last, 1)
  assert.equal(tracked.source, 'gps')
  assert.equal(tracked.delaySec, null)
  assert.deepEqual(tracked.eta, [null, null, null])
})
