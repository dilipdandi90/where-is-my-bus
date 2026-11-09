import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backupAllowed, towerFix } from './cellFix.js'

test('known towers become a position', () => {
  const fix = towerFix({ found: true, lat: 18.5, lon: 73.85, accuracy: 900 }, 1000)
  assert.deepEqual(fix, { lat: 18.5, lon: 73.85, accuracy: 900, at: 1000 })
})

test('unknown towers give no position, so the backup takes over', () => {
  assert.equal(towerFix({ found: false }, 1000), null)
  assert.equal(towerFix(null, 1000), null)
})

test('a rural tower too vague to place the bus gives no position', () => {
  assert.equal(towerFix({ found: true, lat: 18.5, lon: 73.85, accuracy: 20000 }, 1000), null)
})

test('backup waits while towers are working and takes over when they stop', () => {
  assert.equal(backupAllowed(null, 5000), true)
  assert.equal(backupAllowed(1000, 11000), false)
  assert.equal(backupAllowed(1000, 60000), true)
})
