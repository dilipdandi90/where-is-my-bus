import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { backupAllowed, MAX_USABLE_ACCURACY_M, TOWER_POLL_MS, towerFix } from './cellFix.js'
import { canReadTowers, locateTowers, readCells } from './cells.js'
import { updatePosition } from './tracker.js'

/**
 * Loads data for a key, returning {data, error, loading, refreshing, retry}. A null key loads nothing.
 * While retrying, the previous data stays available so screens don't blank out.
 */
export function useData(key, fetcher) {
  const [state, setState] = useState({})
  const [attempt, setAttempt] = useState(0)
  const load = useEffectEvent((signal) => fetcher(signal))
  const retry = () => setAttempt((a) => a + 1)
  const request = key == null ? null : `${key}#${attempt}`

  useEffect(() => {
    if (request == null) return undefined
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => setState({ key, request, data }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState((s) => ({ key, request, error, data: s.key === key ? s.data : undefined }))
        }
      })
    return () => controller.abort()
    // key always changes along with request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (request == null) return { loading: false, retry }
  if (state.request === request) return { ...state, retry }
  if (state.key === key && state.data !== undefined) return { data: state.data, refreshing: true, retry }
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
