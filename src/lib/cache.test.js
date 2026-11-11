import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CACHE_MS, nextDepartureSec, timetableCacheMs } from './cache.js'

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
