import { API_BASE } from './config.js'

/** A failed request, with a message written to be shown to people. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function messageFor(status) {
  if (status === 404) return "We couldn't find this. The timetable may have changed, so try searching again."
  if (status === 410) return 'This is no longer in the timetable.'
  if (status === 503) return 'Bus data is still loading. Please try again in a moment.'
  if (status >= 500) return 'Something went wrong on our side. Please try again.'
  return "We couldn't complete that. Please try again."
}

async function request(path, options) {
  let response
  try {
    response = await fetch(`${API_BASE}/api${path}`, options)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError("We can't connect right now. Check your internet and try again.")
  }
  if (!response.ok) throw new ApiError(messageFor(response.status), response.status)
  return response
}

const get = async (path, signal) => (await request(path, { signal })).json()
const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const enc = encodeURIComponent

export const api = {
  feeds: (signal) => get('/feeds', signal),
  buses: (feed, q, signal) => get(`/feeds/${feed}/buses?q=${enc(q)}`, signal),
  stops: (feed, q, signal) => get(`/feeds/${feed}/stops?q=${enc(q)}`, signal),
  between: (feed, from, to, signal) => get(`/feeds/${feed}/between?from=${enc(from)}&to=${enc(to)}`, signal),
  service: (feed, id, signal) => get(`/feeds/${feed}/services/${enc(id)}`, signal),
  trip: (feed, id, signal) => get(`/feeds/${feed}/trip?id=${enc(id)}`, signal),
  liveBuses: (feed, id, signal) => get(`/feeds/${feed}/services/${enc(id)}/buses`, signal),
  live: (feed, id, signal) => get(`/feeds/${feed}/trip/live?id=${enc(id)}`, signal),
  report: (feed, id, body) => post(`/feeds/${feed}/trip/reports?id=${enc(id)}`, body),
  locateCells: async (cells) => (await post('/cells/locate', { cells })).json(),
  learnCells: (cells, fix) => post('/cells/learn', { cells, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy }),
  createShare: async (feed, tripId) => (await post('/shares', { feed, tripId })).json(),
  sharePosition: (token, body) => post(`/shares/${enc(token)}/position`, body),
  endShare: (token, key) => post(`/shares/${enc(token)}/end`, { key }),
}
