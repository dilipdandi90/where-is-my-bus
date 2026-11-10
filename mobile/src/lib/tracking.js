import * as Location from 'expo-location'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import CellTowers from '../../modules/cell-towers'
import { api } from './api.js'
import { backupAllowed, MAX_USABLE_ACCURACY_M, TOWER_POLL_MS, towerFix, updatePosition } from './shared.js'

/**
 * Whether this build can read cell towers: the installed app on Android can; Expo Go and iPhones
 * can't, and use network location instead.
 */
export const canReadTowers = () => CellTowers != null

// Earlier answers, so towers already seen on this journey still work if the network drops.
const answers = new Map()

async function locateTowers(cells) {
  const key = cells.map((c) => `${c.mcc}-${c.mnc}-${c.lac}-${c.cid}`).sort().join('|')
  try {
    const answer = await api.locateCells(cells)
    if (answer.found) answers.set(key, answer)
    return answer
  } catch {
    return answers.get(key) ?? { found: false }
  }
}

export const readCells = () => CellTowers?.getCells() ?? Promise.resolve([])

/**
 * Follows the phone along a route while mode is 'gps' or 'cell', as on the website.
 *
 * 'gps' uses the satellite fix. 'cell' reads nearby towers where the app can, with the phone's
 * low-accuracy network location as backup.
 *
 * @param speedKmh the route's usual speed, which steadies noisy positions
 * @param onFirstOnRoute called once per mode with the km of the first fix on the route
 * @returns {position, method, error, tooVague, accuracy, fixRef}
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
    let watch = null
    fixRef.current = null

    const accept = (fix, method) => {
      const hadPosition = position?.km != null
      position = updatePosition(allStops(), position, fix, mode, usualSpeed())
      fixRef.current = position.onRoute ? fix : null
      if (!hadPosition && position.km != null) notifyFirst(position.km)
      setState({ mode, position, method, accuracy: fix.accuracy })
    }

    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (cancelled) return
      if (status !== 'granted') {
        setState({ mode, error: 'denied' })
        return
      }
      watch = await Location.watchPositionAsync(
        {
          accuracy: mode === 'gps' ? Location.Accuracy.BestForNavigation : Location.Accuracy.Low,
          timeInterval: mode === 'gps' ? 3_000 : 15_000,
          distanceInterval: mode === 'gps' ? 5 : 50,
        },
        ({ coords, timestamp }) => {
          if (mode === 'cell' && !backupAllowed(lastTowerAt, Date.now())) return
          if (coords.accuracy != null && coords.accuracy > MAX_USABLE_ACCURACY_M) {
            setState({ mode, position, tooVague: true, accuracy: coords.accuracy })
            return
          }
          accept({ lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy ?? 50, at: timestamp }, mode === 'gps' ? 'gps' : 'network')
        },
        () => {
          if (mode === 'cell' && !backupAllowed(lastTowerAt, Date.now())) return
          setState((s) => ({ ...(s.mode === mode ? s : {}), mode, error: 'unavailable' }))
        },
      )
      if (cancelled) watch.remove()
      if (mode === 'cell' && canReadTowers()) pollTowers()
    }

    const pollTowers = async () => {
      let fix = null
      try {
        const cells = await readCells()
        if (cells.length > 0) fix = towerFix(await locateTowers(cells), Date.now())
      } catch {
        // No cell radio, or permission was taken away. The backup carries on regardless.
      }
      if (cancelled) return
      if (fix) {
        lastTowerAt = fix.at
        accept(fix, 'tower')
      }
      timer = setTimeout(pollTowers, TOWER_POLL_MS)
    }

    start().catch(() => !cancelled && setState({ mode, error: 'unavailable' }))
    return () => {
      cancelled = true
      clearTimeout(timer)
      watch?.remove()
    }
  }, [tracking, mode])

  const current = tracking && state.mode === mode ? state : {}
  return { ...current, fixRef }
}
