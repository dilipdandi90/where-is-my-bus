// Decides between tower positions and the network-location backup in Cell tower mode.

// Locations vaguer than this say nothing useful about where a bus is on its route.
export const MAX_USABLE_ACCURACY_M = 5000
export const TOWER_POLL_MS = 10_000
// Long enough to ride out a slow lookup or two without flipping to the backup and back.
const TOWER_FRESH_MS = 45_000

/** Converts the server's answer about nearby towers to a position, or null if it isn't usable. */
export function towerFix(result, now) {
  if (!result?.found || result.accuracy > MAX_USABLE_ACCURACY_M) return null
  return { lat: result.lat, lon: result.lon, accuracy: result.accuracy, at: now }
}

/** Network location is only used when towers haven't given a position recently. */
export function backupAllowed(lastTowerAt, now) {
  return lastTowerAt == null || now - lastTowerAt > TOWER_FRESH_MS
}
