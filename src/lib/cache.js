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

/** The next departure at or after now, from departures sorted by start time, or null if none is left today. */
export function nextDepartureSec(departures, nowSec) {
  return departures?.find((d) => d.startSec >= nowSec)?.startSec ?? null
}
