import { useRef, useState } from 'react'
import { api } from './api.js'
import { config } from './liveConfig.js'
import { usePolling } from './hooks.js'
import { secondsNow } from './shared.js'

/**
 * Real buses on a route from their GPS devices, while the screen shows it, as on the website. Also
 * notes when each bus is seen passing a stop, which gives real passing times.
 *
 * @returns {buses, passings, checked}
 */
export function useLiveBuses(feedId, serviceId, refreshCount, service, enabled) {
  const [buses, setBuses] = useState([])
  const [checked, setChecked] = useState(false)
  const [passings, setPassings] = useState({})
  const lastKm = useRef({})

  const notePassings = (fresh) => {
    if (!service) return
    const now = secondsNow(service.timezone)
    const seenAtMs = Date.now()
    const seen = {}
    const restarted = []
    for (const b of fresh) {
      const prev = lastKm.current[b.plate]
      lastKm.current[b.plate] = { km: b.km, at: seenAtMs }
      if (prev == null) continue
      // Further than a bus could go since the last sighting means the position jumped.
      const possibleKm = (config.maxBusKmh * (seenAtMs - prev.at)) / 3_600_000 + config.jumpAllowanceKm
      if (b.km < prev.km - config.restartKm) restarted.push(b.plate)
      else if (b.km > prev.km && b.km - prev.km <= possibleKm) {
        service.stops.forEach((s, i) => {
          if (s.km > prev.km && s.km <= b.km) (seen[b.plate] ??= {})[i] = now
        })
      }
    }
    if (restarted.length === 0 && Object.keys(seen).length === 0) return
    setPassings((old) => {
      const next = { ...old }
      restarted.forEach((plate) => delete next[plate])
      Object.entries(seen).forEach(([plate, stops]) => (next[plate] = { ...stops, ...next[plate] }))
      return next
    })
  }

  usePolling(
    async () => {
      try {
        const fresh = await api.liveBuses(feedId, serviceId)
        setBuses(fresh)
        notePassings(fresh)
      } catch {
        setBuses([])
      }
      setChecked(true)
    },
    config.pollMs,
    enabled,
    [feedId, serviceId, refreshCount],
  )
  return { buses, passings, checked: checked || !enabled }
}

/** Rider positions on a trip, from people on board who chose to share. */
export function useRiderStatus(feedId, tripId, refreshCount) {
  const [live, setLive] = useState(null)
  usePolling(
    async () => {
      try {
        setLive(await api.live(feedId, tripId))
      } catch {
        setLive(null)
      }
    },
    config.pollMs,
    Boolean(tripId),
    [feedId, tripId, refreshCount],
  )
  return live
}
