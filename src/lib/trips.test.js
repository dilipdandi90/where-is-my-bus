import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tripFromService } from './trips.js'

const service = {
  serviceId: 's',
  stops: [{}, {}, {}],
  departures: [
    { tripId: 'a', startSec: 21600, durationSec: 600, pattern: 0 },
    { tripId: 'b', startSec: 22200, durationSec: 700, pattern: 1 },
  ],
  patterns: [
    [0, 300, 600],
    [0, 350, 700],
  ],
}

test('any departure is built from its service without asking the server', () => {
  assert.deepEqual(tripFromService(service, 'b'), { tripId: 'b', serviceId: 's', startSec: 22200, offsets: [0, 350, 700], arrivals: null })
  assert.equal(tripFromService(service, 'tomorrow-only'), null)
  // An older server sends no patterns, so the app asks for the trip as before.
  assert.equal(tripFromService({ ...service, patterns: undefined }, 'a'), null)
})

test('a line with no timetable gets its placeholder trip', () => {
  const untimed = { serviceId: 'p', stops: [{}, {}], departures: [], untimedTripId: 'u' }
  assert.deepEqual(tripFromService(untimed, 'u'), { tripId: 'u', serviceId: 'p', startSec: 0, offsets: [0, 0] })
})

test('a train keeps its arrival times, which differ where it waits', () => {
  const train = { ...service, departures: [{ tripId: 't', startSec: 64200, durationSec: 13200, pattern: 0, arrivalPattern: 0 }], patterns: [[0, 4020, 13200]], arrivalPatterns: [[0, 3900, 13200]] }
  assert.deepEqual(tripFromService(train, 't').arrivals, [0, 3900, 13200])
})
