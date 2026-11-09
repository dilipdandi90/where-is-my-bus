const DAY_SEC = 86400

/** Seconds since midnight now, in a feed's own timezone. */
export function secondsNow(timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const value = (type) => Number(parts.find((p) => p.type === type).value)
  return value('hour') * 3600 + value('minute') * 60 + value('second')
}

/** The clock reading to compare with a trip: after midnight, a trip from last night needs 24h added. */
export function clockForTrip(nowSec, startSec, durationSec) {
  return startSec + durationSec > DAY_SEC && nowSec < startSec + durationSec - DAY_SEC ? nowSec + DAY_SEC : nowSec
}

/** Formats seconds since midnight as 24-hour time, such as 52200 as 14:30. */
export function formatClock(sec) {
  const wrapped = ((Math.round(sec / 60) * 60) % DAY_SEC + DAY_SEC) % DAY_SEC
  const h = Math.floor(wrapped / 3600)
  const m = Math.floor((wrapped % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatDuration(minutes) {
  const total = Math.round(minutes)
  if (total < 60) return `${total} min`
  const m = total % 60
  return m === 0 ? `${Math.floor(total / 60)} h` : `${Math.floor(total / 60)} h ${m} min`
}

/** How long ago something happened, such as "2 min ago". */
export function formatAge(seconds) {
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  return `${minutes} min ago`
}

export function formatKm(km) {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
