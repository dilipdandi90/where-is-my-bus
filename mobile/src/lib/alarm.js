import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useEffect, useState } from 'react'
import { Vibration } from 'react-native'
import tone from '../../assets/alarm.wav'
import { useStoredState } from './storage.js'

// The same choices as the website: city stops are close together, while state buses on the highway
// cover a kilometre in under a minute.
export const ALARM_DISTANCES_KM = [0.5, 1, 2, 5]
const DEFAULT_ALARM_KM = 1
const VIBRATION = [0, 400, 200, 400, 200, 400, 1500]
const KEEP_AWAKE_TAG = 'stop-alarm'

/**
 * Rings (sound and vibration, repeating) when the vehicle comes within the chosen distance of the
 * chosen stop, until dismissed. Keeps the screen on while set, as phones pause apps once it locks.
 *
 * @returns {alarm, alarmKm, setAlarmKm, firing, toggle, dismiss, remainingKm}
 */
export function useStopAlarm(stops, journey) {
  const [alarm, setAlarm] = useState(null)
  const [storedKm, setAlarmKm] = useStoredState('wimb.alarmKm', DEFAULT_ALARM_KM)
  const alarmKm = ALARM_DISTANCES_KM.includes(storedKm) ? storedKm : DEFAULT_ALARM_KM

  const placed = journey != null && journey.phase !== 'unknown'
  const remainingKm = alarm != null && placed ? Math.max(0, stops[alarm].km - journey.km) : null
  const firing = alarm != null && placed && journey.phase !== 'not-started' && (alarm <= journey.last || remainingKm <= alarmKm)

  useEffect(() => {
    if (alarm == null) return undefined
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    return () => deactivateKeepAwake(KEEP_AWAKE_TAG)
  }, [alarm])

  useEffect(() => {
    if (!firing) return undefined
    // Rings even with the phone on silent, which is the point of a wake-up alarm.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
    // Made only while ringing, and released after, so nothing holds the audio otherwise.
    const player = createAudioPlayer(tone)
    player.loop = true
    player.play()
    Vibration.vibrate(VIBRATION, true)
    return () => {
      player.pause()
      player.release()
      Vibration.cancel()
    }
  }, [firing])

  return {
    alarm,
    alarmKm,
    setAlarmKm,
    firing,
    remainingKm,
    toggle: (index) => setAlarm(alarm === index ? null : index),
    dismiss: () => setAlarm(null),
  }
}
