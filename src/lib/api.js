// The Android app isn't served by the backend, so it needs the backend's full address. See the README.
const BASE = import.meta.env.VITE_API_BASE ?? ''

/** A failed request, with a message that's written to be shown to people. */
export class ApiError extends Error {}

function messageFor(status) {
  if (status === 401) return "That key isn't right."
  if (status === 404) return "We couldn't find this. The timetable may have changed, so try searching again."
  if (status === 503) return 'Bus data is still loading. Please try again in a moment.'
  if (status >= 500) return 'Something went wrong on our side. Please try again.'
  return "We couldn't complete that. Please try again."
}

async function request(path, options) {
  let response
  try {
    response = await fetch(`${BASE}/api${path}`, options)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError("We can't connect right now. Check your internet and try again.")
  }
  if (!response.ok) throw new ApiError(messageFor(response.status))
  return response
}

const get = async (path, signal) => (await request(`/feeds${path}`, { signal })).json()

const post = (path, body) =>
  request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const enc = encodeURIComponent

export const api = {
  feeds: (signal) => get('', signal),
  buses: (feed, q, signal) => get(`/${feed}/buses?q=${enc(q)}`, signal),
  stops: (feed, q, signal) => get(`/${feed}/stops?q=${enc(q)}`, signal),
  between: (feed, from, to, signal) => get(`/${feed}/between?from=${enc(from)}&to=${enc(to)}`, signal),
  service: (feed, id, signal) => get(`/${feed}/services/${enc(id)}`, signal),
  trip: (feed, id, signal) => get(`/${feed}/trip?id=${enc(id)}`, signal),
  liveBuses: (feed, id, signal) => get(`/${feed}/services/${enc(id)}/buses`, signal),
  live: (feed, id, signal) => get(`/${feed}/trip/live?id=${enc(id)}`, signal),
  report: (feed, id, body) => post(`/feeds/${feed}/trip/reports?id=${enc(id)}`, body),
  locateCells: async (cells) => (await post('/cells/locate', { cells })).json(),
  usageStatus: async () => (await request('/usage/status')).json(),
  usageEvent: (body) => post('/usage/events', body),
  usageForget: (deviceId) => post('/usage/forget', { deviceId }),
  usageSummary: async (key) => (await request('/usage/summary', { headers: { 'X-Admin-Key': key } })).json(),
  learnCells: (cells, fix) => post('/cells/learn', { cells, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy }),
}
