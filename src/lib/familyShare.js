import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useSessionState } from './hooks.js'

const SEND_EVERY_MS = 15_000
// Links must open in the public website. Set VITE_PUBLIC_URL when the site is served from somewhere
// else (a preview, say). See the README.
const PUBLIC_BASE = import.meta.env.VITE_PUBLIC_URL ?? `${window.location.origin}${window.location.pathname}`

export const shareUrl = (token) => `${PUBLIC_BASE.replace(/#.*$/, '')}#/f/${token}`

/**
 * A link the rider sends to family so they can watch the bus, made only when the rider asks. While it's
 * on, the phone's position along the route is sent every few seconds. Kept for the visit, so going to
 * another screen and back doesn't break a link someone already has.
 *
 * @returns {share, start, stop, busy, error}. share is {token, key, tripId} or null.
 */
export function useFamilyShare({ feedId, tripId, tracking, fixRef, source }) {
  const [share, setShare] = useSessionState(`wimb.share.${feedId}`, null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // A link is for one departure. Changing departure ends it, so family never watch the wrong bus.
  const active = share && share.tripId === tripId ? share : null

  const stop = async () => {
    const old = share
    setShare(null)
    if (old) await api.endShare(old.token, old.key).catch(() => {})
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      if (share) await stop()
      const created = await api.createShare(feedId, tripId)
      const next = { ...created, tripId }
      setShare(next)
      return next
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!active || !tracking) return undefined
    let ended = false
    const send = () => {
      const fix = fixRef.current
      if (!fix || ended) return
      api
        .sharePosition(active.token, { key: active.key, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, source })
        .catch((e) => {
          // An expired link can't come back, so stop sending. Other failures are a weak signal moment.
          if (/find this|expired|ended/i.test(e.message)) ended = true
        })
    }
    send()
    const id = setInterval(send, SEND_EVERY_MS)
    return () => clearInterval(id)
  }, [active, tracking, fixRef, source])

  return { share: active, start, stop, busy, error }
}
