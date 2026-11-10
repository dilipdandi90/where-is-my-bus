import { useEffect, useRef, useState } from 'react'
import { useStoredState } from './hooks.js'

// How far before the stop to ring. City stops are close together; state buses on the highway cover
// a kilometre in under a minute, so longer distances give time to wake up and gather bags.
export const ALARM_DISTANCES_KM = [0.5, 1, 2, 5]
const DEFAULT_ALARM_KM = 1
// Rings again every few seconds until dismissed, for a while, so a sleeping rider wakes up.
const RING_EVERY_MS = 6_000
const RING_FOR_MS = 3 * 60_000

/**
 * Rings and vibrates when the bus comes within a chosen distance of a chosen stop, until dismissed.
 * Sound needs a tap to allow it, which choosing the stop provides.
 *
 * @returns {alarm, alarmKm, setAlarmKm, firing, toggle, dismiss, remainingKm}
 */
export function useStopAlarm(stops, journey) {
  const [alarm, setAlarm] = useState(null)
  const [storedKm, setAlarmKm] = useStoredState('wimb.alarmKm', DEFAULT_ALARM_KM)
  const alarmKm = ALARM_DISTANCES_KM.includes(storedKm) ? storedKm : DEFAULT_ALARM_KM
  const audio = useRef(null)

  const toggle = (index) => {
    setAlarm(alarm === index ? null : index)
    if (!audio.current) {
      const Context = window.AudioContext ?? window.webkitAudioContext
      if (Context) audio.current = new Context()
    }
    audio.current?.resume()
  }

  // Unknown where the train is (a line with no timetable, nobody tracking): nothing to count down from.
  const placed = journey != null && journey.phase !== 'unknown'
  const remainingKm = alarm != null && placed ? Math.max(0, stops[alarm].km - journey.km) : null
  const firing =
    alarm != null &&
    placed &&
    journey.phase !== 'not-started' &&
    (alarm <= journey.last || remainingKm <= alarmKm)

  useEffect(() => {
    if (!firing) return undefined
    const ring = () => {
      navigator.vibrate?.([400, 200, 400, 200, 400])
      if (audio.current) beep(audio.current)
    }
    ring()
    const startedAt = Date.now()
    const id = setInterval(() => (Date.now() - startedAt < RING_FOR_MS ? ring() : clearInterval(id)), RING_EVERY_MS)
    return () => {
      clearInterval(id)
      navigator.vibrate?.(0)
    }
  }, [firing])

  return { alarm, alarmKm, setAlarmKm, firing, toggle, dismiss: () => setAlarm(null), remainingKm }
}

function beep(context) {
  ;[0, 0.45, 0.9].forEach((delay) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 880
    gain.gain.value = 0.3
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(context.currentTime + delay)
    oscillator.stop(context.currentTime + delay + 0.3)
  })
}
