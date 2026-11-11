import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { backupAllowed, MAX_USABLE_ACCURACY_M, TOWER_POLL_MS, towerFix } from './cellFix.js'
import { canReadTowers, locateTowers, readCells } from './cells.js'
import { updatePosition } from './tracker.js'

// Bump the version when the shape of what the server sends changes, so copies saved by an older
// version of the app are never shown in place of the new answer.
const CACHE_PREFIX = 'wimb.c2.'
const OLD_CACHE_PREFIXES = ['wimb.c.']

try {
  Object.keys(localStorage)
    .filter((k) => OLD_CACHE_PREFIXES.some((p) => k.startsWith(p)))
    .forEach((k) => localStorage.removeItem(k))
} catch {
  // Storage may be unavailable, in which case there's nothing old to clear.
}

function readCache(key, maxAgeMs) {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_PREFIX + key))
    return stored && Date.now() - stored.t < maxAgeMs ? stored.d : undefined
  } catch {
    return undefined
  }
}

function writeCache(key, data) {
  const entry = JSON.stringify({ t: Date.now(), d: data })
  try {
    localStorage.setItem(CACHE_PREFIX + key, entry)
  } catch {
    // Storage is full, so start the cache afresh rather than stop caching.
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(CACHE_PREFIX + key, entry)
    } catch {
      // Private browsing can refuse storage entirely, which only means no cache.
    }
  }
}

/**
 * Saves a copy for later, unless a fresh enough one is already saved, so a screen opened next shows at
 * once and works offline. Failures are ignored: the screen loads it normally when opened.
 */
export function prefetchData(key, fetcher, cacheMs) {
  if (readCache(key, cacheMs) !== undefined) return
  fetcher()
    .then((data) => writeCache(key, data))
    .catch(() => {})
}

/**
 * Loads data for a key, returning {data, error, loading, refreshing, retry}. A null key loads nothing.
 * While retrying, the previous data stays available so screens don't blank out.
 *
 * @param options.cacheMs if set, a saved copy younger than this shows at once while a fresh one loads,
 *        and stays on screen if the server can't be reached. Never use it for live positions.
 */
export function useData(key, fetcher, { cacheMs } = {}) {
  const [state, setState] = useState({})
  const [attempt, setAttempt] = useState(0)
  const load = useEffectEvent((signal) => fetcher(signal))
  const retry = () => setAttempt((a) => a + 1)
  const request = key == null ? null : `${key}#${attempt}`
  const cached = useMemo(() => (key != null && cacheMs ? readCache(key, cacheMs) : undefined), [key, cacheMs])

  useEffect(() => {
    if (request == null) return undefined
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => {
        if (cacheMs) writeCache(key, data)
        setState({ key, request, data })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState((s) => ({ key, request, error, data: s.key === key ? s.data : undefined }))
        }
      })
    return () => controller.abort()
    // key and cacheMs always come with request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (request == null) return { loading: false, retry }
  if (state.request === request) {
    // A failed refresh still shows the saved copy, with the error alongside.
    return state.data === undefined && cached !== undefined ? { ...state, data: cached, retry } : { ...state, retry }
  }
  if (state.key === key && state.data !== undefined) return { data: state.data, refreshing: true, retry }
  if (cached !== undefined) return { data: cached, refreshing: true, retry }
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

function useBrowserStorage(storage, storageKey, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = storage.getItem(storageKey)
      return stored == null ? initial : JSON.parse(stored)
    } catch {
      return initial
    }
  })
  const update = (next) => {
    setValue(next)
    try {
      storage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Private browsing can refuse storage. The value still works for this visit.
    }
  }
  return [value, update]
}

/** State that's remembered between visits. */
export const useStoredState = (key, initial) => useBrowserStorage(localStorage, key, initial)

/** State that survives going to another screen and back, until the tab is closed. */
export const useSessionState = (key, initial) => useBrowserStorage(sessionStorage, key, initial)

/**
 * Follows the phone's location along a route while the mode is 'gps' or 'cell'.
 *
 * 'gps' asks for the satellite fix. 'cell' first reads nearby towers and looks them up, which only
 * the Android app can do. Its backup is the browser's low-accuracy location, which phones work out
 * from cell towers and Wi-Fi themselves. Browsers only ever have the backup.
 *
 * @param speedKmh the bus's usual speed, which steadies noisy positions
 * @param onFirstOnRoute called once per mode with the km of the first fix on the route
 * @returns {position, method, error, tooVague, fixRef}. method is 'gps', 'tower' or 'network'.
 *          fixRef holds the latest usable raw fix.
 */
export function usePhonePosition(stops, mode, speedKmh, onFirstOnRoute) {
  const tracking = stops != null && (mode === 'gps' || mode === 'cell')
  const [state, setState] = useState({ mode: null })
  const fixRef = useRef(null)
  const notifyFirst = useEffectEvent((km) => onFirstOnRoute(km))
  const allStops = useEffectEvent(() => stops)
  const usualSpeed = useEffectEvent(() => speedKmh)

  useEffect(() => {
    if (!tracking) return undefined
    let position = null
    let lastTowerAt = null
    let cancelled = false
    let timer = null
    let watchId = null
    fixRef.current = null

    const accept = (fix, method) => {
      const hadPosition = position?.km != null
      position = updatePosition(allStops(), position, fix, mode, usualSpeed())
      fixRef.current = position.onRoute ? fix : null
      if (!hadPosition && position.km != null) notifyFirst(position.km)
      setState({ mode, position, method, accuracy: fix.accuracy })
    }

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        ({ coords, timestamp }) => {
          if (mode === 'cell' && !backupAllowed(lastTowerAt, Date.now())) return
          if (coords.accuracy > MAX_USABLE_ACCURACY_M) {
            setState({ mode, position, tooVague: true, accuracy: coords.accuracy })
            return
          }
          accept(
            { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy, at: timestamp },
            mode === 'gps' ? 'gps' : 'network',
          )
        },
        (error) => {
          // A problem with the backup doesn't matter while towers are giving positions.
          if (mode === 'cell' && !backupAllowed(lastTowerAt, Date.now())) return
          const kind = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'
          // A timeout between fixes shouldn't wipe out a position that's still good.
          setState((s) => ({ ...(s.mode === mode ? s : {}), mode, error: kind }))
        },
        {
          enableHighAccuracy: mode === 'gps',
          maximumAge: mode === 'gps' ? 5_000 : 30_000,
          timeout: mode === 'gps' ? 30_000 : 60_000,
        },
      )
    } else if (mode === 'gps' || !canReadTowers()) {
      queueMicrotask(() => setState({ mode, error: 'unsupported' }))
    }

    const pollTowers = async () => {
      let fix = null
      try {
        const cells = await readCells()
        if (cells.length > 0) fix = towerFix(await locateTowers(cells), Date.now())
      } catch {
        // No permission or no cell radio. The backup carries on regardless.
      }
      if (cancelled) return
      if (fix) {
        lastTowerAt = fix.at
        accept(fix, 'tower')
      }
      timer = setTimeout(pollTowers, TOWER_POLL_MS)
    }
    if (mode === 'cell' && canReadTowers()) pollTowers()

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [tracking, mode])

  const current = tracking && state.mode === mode ? state : {}
  return { ...current, fixRef }
}

/** Keeps the screen on while tracking, because browsers stop location updates once it locks. */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined
    let lock = null
    let cancelled = false
    const acquire = async () => {
      try {
        const granted = await navigator.wakeLock.request('screen')
        if (cancelled) granted.release()
        else lock = granted
      } catch {
        // Refused on low battery, for example. Tracking still works until the screen locks.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release()
    }
  }, [active])
}
