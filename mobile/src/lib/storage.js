import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

const CACHE_PREFIX = 'wimb.c1.'
// Saved answers kept in memory as well as on disk. Disk reads are asynchronous, which shows a loading
// screen for a moment; memory reads are instant, so a screen opened again draws at once.
const MEMORY_LIMIT = 300

// An LRU cache: a Map remembers insertion order, so re-inserting on every use keeps the least recently
// used entry first, and that's the one dropped when full. Each step is O(1).
const memory = new Map()

function remember(key, entry) {
  memory.delete(key)
  memory.set(key, entry)
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value)
}

const fresh = (entry, maxAgeMs) => (entry && Date.now() - entry.t < maxAgeMs ? entry.d : undefined)

/** A saved copy younger than maxAgeMs from memory, without waiting for the disk, or undefined. */
export function readMemory(key, maxAgeMs) {
  const entry = memory.get(key)
  if (entry) remember(key, entry)
  return fresh(entry, maxAgeMs)
}

/** A saved copy younger than maxAgeMs, from memory or else the disk, or undefined. */
export async function readCache(key, maxAgeMs) {
  const inMemory = readMemory(key, maxAgeMs)
  if (inMemory !== undefined) return inMemory
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(CACHE_PREFIX + key))
    if (stored) remember(key, stored)
    return fresh(stored, maxAgeMs)
  } catch {
    return undefined
  }
}

export async function writeCache(key, data) {
  const entry = { t: Date.now(), d: data }
  remember(key, entry)
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // A full disk only means no cache.
  }
}

/**
 * Loads every saved answer into memory in one batch read, so the first screens draw from memory. Run
 * at launch, while the intro plays. Newest last, so the LRU keeps the most recent if there are more.
 */
export async function loadCacheIntoMemory() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CACHE_PREFIX))
    const entries = []
    for (const [key, raw] of await AsyncStorage.multiGet(keys)) {
      try {
        const entry = JSON.parse(raw)
        if (entry?.t) entries.push([key.slice(CACHE_PREFIX.length), entry])
      } catch {
        // A damaged entry is skipped, and replaced next time it's loaded.
      }
    }
    entries.sort((a, b) => a[1].t - b[1].t).forEach(([key, entry]) => !memory.has(key) && remember(key, entry))
  } catch {
    // No storage means screens load from the network as before.
  }
}

/**
 * Saves a copy for later, unless a fresh enough one is already saved, so a screen opened next shows at
 * once and works offline. Failures are ignored: the screen loads it normally when opened.
 */
export async function prefetchData(key, fetcher, maxAgeMs) {
  if ((await readCache(key, maxAgeMs)) !== undefined) return
  try {
    await writeCache(key, await fetcher())
  } catch {
    // Offline or the server is waking up. Nothing is lost.
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
