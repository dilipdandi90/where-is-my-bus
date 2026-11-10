import { useEffect, useState } from 'react'
import { Share } from 'react-native'
import { api } from './api.js'
import { config } from './liveConfig.js'
import { SITE_URL } from './config.js'
import { canReadTowers, readCells } from './tracking.js'

// A random ID for this visit only, so one rider's reports count once.
const RIDER_ID = globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** "Help others waiting": anonymously shares how far along the route the bus is, only while on. */
export function useRiderSharing({ feedId, tripId, mode, enabled, fixRef }) {
  useEffect(() => {
    if (!enabled || mode === 'off' || !tripId) return undefined
    const send = () => {
      const fix = fixRef.current
      if (!fix) return
      api.report(feedId, tripId, { riderId: RIDER_ID, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, source: mode }).catch(() => {})
      // A GPS position beside the connected tower is how the tower map grows.
      if (mode === 'gps' && canReadTowers()) readCells().then((cells) => cells.length && api.learnCells(cells, fix)).catch(() => {})
    }
    send()
    const id = setInterval(send, config.shareEveryMs)
    return () => clearInterval(id)
  }, [enabled, mode, tripId, feedId, fixRef])
}

export const familySharingAvailable = SITE_URL !== ''

/**
 * A link the rider sends to family so they can watch the bus on the website. Only the distance along
 * the route is shared, never the exact location, and it stops when the rider stops it or gets off.
 *
 * @returns {share, start, stop, send, busy, error}
 */
export function useFamilyShare({ feedId, tripId, tracking, fixRef, source, destination, words }) {
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // A link is for one departure. Changing departure ends it, so family never watch the wrong bus.
  const active = share && share.tripId === tripId ? share : null

  const stop = async () => {
    const old = share
    setShare(null)
    if (old) await api.endShare(old.token, old.key).catch(() => {})
  }

  const send = async () => {
    setError(null)
    let current = active
    if (!current) {
      setBusy(true)
      try {
        if (share) await stop()
        current = { ...(await api.createShare(feedId, tripId)), tripId }
        setShare(current)
      } catch (e) {
        setError(e.message)
        return
      } finally {
        setBusy(false)
      }
    }
    const url = `${SITE_URL}/#/f/${current.token}`
    await Share.share({ message: `Track my ${words.bus} to ${destination} live: ${url}` }).catch(() => {})
  }

  useEffect(() => {
    if (!active || !tracking) return undefined
    let ended = false
    const post = () => {
      const fix = fixRef.current
      if (!fix || ended) return
      api.sharePosition(active.token, { key: active.key, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, source }).catch((e) => {
        // An expired link can't come back, so stop sending.
        if (e.status === 404) ended = true
      })
    }
    post()
    const id = setInterval(post, config.shareEveryMs)
    return () => clearInterval(id)
  }, [active, tracking, fixRef, source])

  return { share: active, send, stop, busy, error }
}
