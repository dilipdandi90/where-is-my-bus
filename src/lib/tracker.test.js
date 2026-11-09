import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  kmAtOffset,
  lastStopIndex,
  nearestDeparture,
  offsetAtKm,
  updatePosition,
} from './tracker.js'

// A straight north-south route with stops about 11.1 km apart.
const stops = [
  { lat: 18.0, lon: 73.0, km: 0 },
  { lat: 18.1, lon: 73.0, km: 11.1 },
  { lat: 18.2, lon: 73.0, km: 22.2 },
]
const offsets = [0, 1800, 3600]
const MIN = 60_000

test('first fix on the route gives the distance travelled', () => {
  const r = updatePosition(stops, null, { lat: 18.05, lon: 73, accuracy: 20, at: 0 }, 'gps')
  assert.equal(r.onRoute, true)
  assert.ok(Math.abs(r.km - 5.55) < 0.02)
})

test('fix far from the route is off-route and keeps the last position', () => {
  const prev = { km: 5, at: 0 }
  const r = updatePosition(stops, prev, { lat: 19, lon: 74, accuracy: 20, at: MIN }, 'gps')
  assert.equal(r.onRoute, false)
  assert.equal(r.km, 5)
  assert.ok(r.offRouteKm > 50)
})

test('first fix off the route has no position at all', () => {
  const r = updatePosition(stops, null, { lat: 19, lon: 74, accuracy: 20, at: 0 }, 'gps')
  assert.equal(r.km, null)
})

test('coarse cell fix counts as on-route when GPS tolerance would reject it', () => {
  // About 3 km beyond what a road could wander, but within this fix's stated 4 km accuracy.
  const fix = { lat: 18.05, lon: 73.045, accuracy: 4000, at: 0 }
  assert.equal(updatePosition(stops, null, { ...fix, accuracy: 20 }, 'gps').onRoute, false)
  assert.equal(updatePosition(stops, null, fix, 'cell').onRoute, true)
})

test('bus does not jump backwards on noisy fixes', () => {
  const prev = { km: 10, at: 0 }
  const r = updatePosition(stops, prev, { lat: 18.02, lon: 73, accuracy: 20, at: MIN }, 'gps')
  assert.ok(r.km >= 9.85, `moved back to ${r.km}`)
})

test('impossible forward jump is capped by bus speed', () => {
  const prev = { km: 1, at: 0 }
  const r = updatePosition(stops, prev, { lat: 18.19, lon: 73, accuracy: 20, at: MIN }, 'gps')
  // One minute at 100 km/h is 1.67 km, plus the 0.4 km tolerance.
  assert.ok(r.km < 3.1, `jumped to ${r.km}`)
})

test('a precise GPS fix takes over, while a coarse tower fix only nudges the estimate', () => {
  const prev = { km: 5, at: 0 }
  const fix = { lat: 18.0522, lon: 73, accuracy: 15, at: MIN } // About 5.8 km along.
  const gps = updatePosition(stops, prev, fix, 'gps')
  assert.ok(Math.abs(gps.km - 5.8) < 0.05, `GPS at ${gps.km}`)
  const coarse = updatePosition(stops, prev, { ...fix, accuracy: 1500 }, 'cell')
  assert.ok(coarse.km > 5 && coarse.km < gps.km - 0.1, `tower at ${coarse.km}`)
})

test('a stopped bus stays put rather than running ahead on its usual speed', () => {
  let state = { km: 5, at: 0 }
  for (let i = 1; i <= 60; i++) {
    state = updatePosition(stops, state, { lat: 18.045, lon: 73, accuracy: 15, at: i * 5000 }, 'gps')
  }
  assert.ok(Math.abs(state.km - 5) < 0.2, `drifted to ${state.km}`)
  assert.ok(state.filter.speed < 3, `still thinks it's doing ${state.filter.speed} km/h`)
})

test('the bus moves on past a stop rather than freezing there', () => {
  // Fixes every 5 seconds through the stop at 11.1 km, with the estimate sitting on the stop itself.
  let state = { km: 11.1, at: 0 }
  for (let i = 1; i <= 12; i++) {
    const km = 11.1 + (i * 20 * 5) / 3600
    state = updatePosition(stops, state, { lat: 18 + km / 111, lon: 73, accuracy: 15, at: i * 5000 }, 'gps')
  }
  assert.ok(Math.abs(state.km - 11.43) < 0.05, `stuck at ${state.km}`)
})

test('a precise GPS fix wins out after the bus has run far from where it was expected', () => {
  let state = { km: 2, at: 0 }
  for (let i = 1; i <= 20; i++) {
    state = updatePosition(stops, state, { lat: 18 + 10 / 111, lon: 73, accuracy: 15, at: i * 5000 }, 'gps')
  }
  assert.ok(Math.abs(state.km - 10) < 0.1, `at ${state.km}`)
})

// Follows a simulated hour at 20 km/h with a five-minute stop, returning the typical error in km.
function simulate({ source, noiseKm, accuracy, stepSec, usualSpeed }) {
  // Steady random numbers, so this gives the same result every run.
  let seed = 42
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const gauss = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())
  let state = null
  let truth = 0.5
  let tracked = 0
  let raw = 0
  let count = 0
  for (let t = 0; t < 3600; t += stepSec) {
    if (t < 1200 || t > 1500) truth += (20 * stepSec) / 3600
    const reading = truth + noiseKm * gauss()
    state = updatePosition(stops, state, { lat: 18 + reading / 111, lon: 73, accuracy, at: t * 1000 }, source, usualSpeed)
    tracked += (state.km - truth) ** 2
    raw += (reading - truth) ** 2
    count++
  }
  return { tracked: Math.sqrt(tracked / count), raw: Math.sqrt(raw / count) }
}

test('tracking on towers is clearly more accurate than trusting each reading', () => {
  const { tracked, raw } = simulate({ source: 'cell', noiseKm: 0.8, accuracy: 1000, stepSec: 10, usualSpeed: 20 })
  assert.ok(tracked < raw * 0.6, `${tracked} vs ${raw}`)
})

test('a wrong timetable speed does not spoil tracking', () => {
  // BEST's timetable implies 34 km/h, far faster than real traffic.
  for (const usualSpeed of [8, 12, 30, 34, 50]) {
    const { tracked, raw } = simulate({ source: 'cell', noiseKm: 0.8, accuracy: 1000, stepSec: 10, usualSpeed })
    assert.ok(tracked < raw * 0.7, `expected speed ${usualSpeed}: ${tracked} vs ${raw}`)
  }
})

test('GPS tracking stays within tens of metres', () => {
  const { tracked } = simulate({ source: 'gps', noiseKm: 0.015, accuracy: 15, stepSec: 5, usualSpeed: 20 })
  assert.ok(tracked < 0.05, `${tracked}`)
})

test('on a route that doubles back, the pass nearest the last position wins', () => {
  const loop = [
    { lat: 18.0, lon: 73.0, km: 0 },
    { lat: 18.1, lon: 73.0, km: 11.1 },
    { lat: 18.0, lon: 73.0, km: 22.2 },
  ]
  const fix = { lat: 18.05, lon: 73, accuracy: 20, at: 15 * MIN }
  const out = updatePosition(loop, { km: 5, at: 0 }, fix, 'gps')
  assert.ok(out.km < 7)
  const back = updatePosition(loop, { km: 16, at: 0 }, fix, 'gps')
  assert.ok(back.km > 15)
})

test('timetable converts between time and distance', () => {
  assert.equal(offsetAtKm(stops, offsets, 11.1), 1800)
  assert.equal(offsetAtKm(stops, offsets, 16.65), 2700)
  assert.equal(offsetAtKm(stops, offsets, 999), 3600)
  assert.equal(kmAtOffset(stops, offsets, 900), 5.55)
  assert.equal(kmAtOffset(stops, offsets, 99999), 22.2)
})

test('rider is matched to the departure the timetable puts nearest them', () => {
  const departures = [
    { tripId: 'a', startSec: 8 * 3600, durationSec: 3600 },
    { tripId: 'b', startSec: 9 * 3600, durationSec: 3600 },
  ]
  // Halfway along at 09:35, so the 09:00 bus, a few minutes late.
  assert.equal(nearestDeparture(departures, 22.2, 11.1, 9 * 3600 + 35 * 60).departure.tripId, 'b')
  // Nothing runs within an hour of 20:00.
  assert.equal(nearestDeparture(departures, 22.2, 11.1, 20 * 3600), null)
})

test('last stop reached', () => {
  assert.equal(lastStopIndex(stops, 0), 0)
  assert.equal(lastStopIndex(stops, 11.1), 1)
  assert.equal(lastStopIndex(stops, 15), 1)
  assert.equal(lastStopIndex(stops, 22.2), 2)
})
