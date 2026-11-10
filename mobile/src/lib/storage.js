import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

const CACHE_PREFIX = 'wimb.c1.'

/** A saved copy younger than maxAgeMs, or undefined. */
export async function readCache(key, maxAgeMs) {
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(CACHE_PREFIX + key))
    return stored && Date.now() - stored.t < maxAgeMs ? stored.d : undefined
  } catch {
    return undefined
  }
}

export async function writeCache(key, data) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), d: data }))
  } catch {
    // A full disk only means no cache.
  }
}

/**
 * State remembered between visits. Storage on phones is asynchronous, so it starts as `initial` and
 * switches to the saved value a moment later.
 *
 * @returns [value, setValue, loaded]
 */
export function useStoredState(key, initial) {
  const [state, setState] = useState({ value: initial, loaded: false })
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!cancelled) setState({ value: raw == null ? initial : JSON.parse(raw), loaded: true })
      })
      .catch(() => !cancelled && setState((s) => ({ ...s, loaded: true })))
    return () => {
      cancelled = true
    }
    // initial is only the first value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const update = (value) => {
    setState({ value, loaded: true })
    AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {})
  }
  return [state.value, update, state.loaded]
}
