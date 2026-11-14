import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CACHE_MS, nextDepartureSec, serviceDay, timetableCacheMs } from './cache.js'

test('metro timetables are kept far longer than bus ones', () => {
  assert.equal(timetableCacheMs({ mode: 'metro' }), CACHE_MS.metro)
  assert.equal(timetableCacheMs({ mode: 'bus' }), CACHE_MS.timetable)
  assert.equal(timetableCacheMs(undefined), CACHE_MS.timetable)
  assert.ok(CACHE_MS.metro > CACHE_MS.timetable)
})

test('the next train comes from the saved timetable, so old copies stay right', () => {
  const deps = [{ startSec: 21600 }, { startSec: 22200 }, { startSec: 22800 }]
  assert.equal(nextDepartureSec(deps, 21000), 21600)
  assert.equal(nextDepartureSec(deps, 22200), 22200)
  assert.equal(nextDepartureSec(deps, 22201), 22800)
  assert.equal(nextDepartureSec(deps, 23000), null)
  assert.equal(nextDepartureSec(undefined, 0), null)
})

test('the binary search agrees with a plain scan everywhere', () => {
  const deps = Array.from({ length: 97 }, (_, i) => ({ startSec: 21600 + i * 600 }))
  for (let now = 21000; now < 21600 + 98 * 600; now += 137) {
    assert.equal(nextDepartureSec(deps, now), deps.find((d) => d.startSec >= now)?.startSec ?? null)
  }
})

test('a line says whether it is open, closed, or near its last train', () => {
  const deps = [{ startSec: 6 * 3600 }, { startSec: 12 * 3600 }, { startSec: 22 * 3600 }]
  assert.deepEqual(serviceDay(deps, 5 * 3600), { state: 'before', first: 21600, last: 79200, next: 21600, lastSoon: false })
  assert.equal(serviceDay(deps, 13 * 3600).state, 'running')
  assert.equal(serviceDay(deps, 13 * 3600).next, 79200)
  assert.equal(serviceDay(deps, 13 * 3600).lastSoon, false)
  assert.equal(serviceDay(deps, 21.75 * 3600).lastSoon, true)
  assert.equal(serviceDay(deps, 23 * 3600).state, 'after')
  assert.equal(serviceDay([], 0).state, 'none')
})
