// How long saved copies of server answers are shown before they count as too old. A saved copy always
// shows at once while a fresh one loads, so these only matter offline or on a slow connection.
// Shared by the website and the mobile app.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

export const CACHE_MS = {
  /** Searches carry next-bus times and live counts, so they go stale quickly. */
  search: 30 * MINUTE,
  stops: 12 * HOUR,
  /** Bus timetables are re-downloaded by the server daily. */
  timetable: 12 * HOUR,
  /** Metro timetables are built into the server and only change when it's updated. */
  metro: 7 * 24 * HOUR,
}

/** How long to keep a feed's timetables: much longer for a metro. */
export const timetableCacheMs = (feed) => (feed?.mode === 'metro' ? CACHE_MS.metro : CACHE_MS.timetable)

/**
 * Index of the first departure at or after now, or departures.length when none is left. Departures
 * come sorted by start time, so this is a binary search: O(log n) rather than checking each one.
 */
function firstAtOrAfter(departures, nowSec) {
  let lo = 0
  let hi = departures.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (departures[mid].startSec < nowSec) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The next departure at or after now, from departures sorted by start time, or null if none is left today. */
export function nextDepartureSec(departures, nowSec) {
  if (!departures?.length) return null
  return departures[firstAtOrAfter(departures, nowSec)]?.startSec ?? null
}

// Within this of the last departure, it's worth warning that it's the last one.
const LAST_SOON_SEC = 30 * 60

/**
 * Where now falls in a day's departures, so a line can say it's closed and when it opens, or warn
 * about the last one. Times are seconds since midnight.
 *
 * @returns {state, first, last, next, lastSoon}. state is 'none' (nothing today), 'before' (opens
 *          later), 'running' or 'after' (closed for the day).
 */
export function serviceDay(departures, nowSec) {
  if (!departures?.length) return { state: 'none', first: null, last: null, next: null, lastSoon: false }
  const first = departures[0].startSec
  const last = departures[departures.length - 1].startSec
  if (nowSec < first) return { state: 'before', first, last, next: first, lastSoon: false }
  if (nowSec > last) return { state: 'after', first, last, next: null, lastSoon: false }
  return { state: 'running', first, last, next: nextDepartureSec(departures, nowSec), lastSoon: last - nowSec <= LAST_SOON_SEC }
}
