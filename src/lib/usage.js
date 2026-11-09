import { api } from './api.js'

// Nothing leaves the phone until someone taps Allow, and turning it off deletes what was sent.

const CHOICE_KEY = 'wimb.usage'
const DEVICE_KEY = 'wimb.device'
const AREA_SENT_KEY = 'wimb.usage.areaDay'

const read = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private browsing can refuse storage, which only means being asked again next time.
  }
}

/** 'all', 'usage', 'none', or null when they haven't been asked yet. */
export const usageChoice = () => read(CHOICE_KEY)

function deviceId() {
  let id = read(DEVICE_KEY)
  if (!id && globalThis.crypto?.randomUUID) {
    id = crypto.randomUUID()
    write(DEVICE_KEY, id)
  }
  return id
}

/** Records something a person did, if they've agreed. Failures never affect the app. */
export function track(event, details = {}) {
  const choice = usageChoice()
  if (choice !== 'all' && choice !== 'usage') return
  const id = deviceId()
  if (id) api.usageEvent({ deviceId: id, event, ...details }).catch(() => {})
}

/** Sends the approximate area at most once a day, rounded here as well as on the server. */
export function shareArea() {
  const today = new Date().toISOString().slice(0, 10)
  if (usageChoice() !== 'all' || read(AREA_SENT_KEY) === today || !navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      write(AREA_SENT_KEY, today)
      track('area', { lat: Math.round(coords.latitude * 10) / 10, lon: Math.round(coords.longitude * 10) / 10 })
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 3_600_000, timeout: 20_000 },
  )
}

export function setUsageChoice(choice) {
  write(CHOICE_KEY, choice)
  if (choice === 'all') shareArea()
  if (choice === 'none') {
    const id = read(DEVICE_KEY)
    if (id) api.usageForget(id).catch(() => {})
    write(DEVICE_KEY, null)
    write(AREA_SENT_KEY, null)
  }
}

/** Forgets the choice so they're asked again. */
export const askAgain = () => write(CHOICE_KEY, null)
