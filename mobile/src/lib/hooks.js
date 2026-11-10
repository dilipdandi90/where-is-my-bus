import { useEffect, useEffectEvent, useState } from 'react'
import { readCache, writeCache } from './storage.js'

/**
 * Loads data for a key, returning {data, error, loading, refreshing, retry}. A null key loads nothing.
 * With cacheMs, a saved copy shows at once while a fresh one loads, and stays if the server can't be
 * reached. Never cache live positions.
 */
export function useData(key, fetcher, { cacheMs } = {}) {
  const [state, setState] = useState({})
  const [attempt, setAttempt] = useState(0)
  const [cached, setCached] = useState({ key: null, data: undefined })
  const load = useEffectEvent((signal) => fetcher(signal))
  const request = key == null ? null : `${key}#${attempt}`

  useEffect(() => {
    if (key == null || !cacheMs) return undefined
    let cancelled = false
    readCache(key, cacheMs).then((data) => !cancelled && setCached({ key, data }))
    return () => {
      cancelled = true
    }
  }, [key, cacheMs])

  useEffect(() => {
    if (request == null) return undefined
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => {
        if (cacheMs) writeCache(key, data)
        setState({ key, request, data })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState((s) => ({ key, request, error, data: s.key === key ? s.data : undefined }))
      })
    return () => controller.abort()
    // key and cacheMs always come with request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  const retry = () => setAttempt((a) => a + 1)
  const saved = cached.key === key ? cached.data : undefined
  if (request == null) return { loading: false, retry }
  if (state.request === request) return state.data === undefined && saved !== undefined ? { ...state, data: saved, retry } : { ...state, retry }
  if (state.key === key && state.data !== undefined) return { data: state.data, refreshing: true, retry }
  if (saved !== undefined) return { data: saved, refreshing: true, retry }
  return { loading: true, retry }
}

/** Re-renders on an interval, for anything derived from the clock. */
export function useTick(ms) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

export function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** Calls fn now and then every ms while mounted and while `active`, restarting when deps change. */
export function usePolling(fn, ms, active, deps) {
  const run = useEffectEvent(fn)
  useEffect(() => {
    if (!active) return undefined
    run()
    const id = setInterval(run, ms)
    return () => clearInterval(id)
    // The caller's deps decide when polling restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ms, ...deps])
}
