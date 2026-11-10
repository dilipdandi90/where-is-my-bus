import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { AT_STOP_KM, formatClock, formatDistance, formatKm, nextStopInfo } from '../lib/shared.js'
import { colors } from '../lib/theme.js'
import { BellIcon, BusIcon, PlatformChip, Press, TrainIcon } from './ui.js'

// Up to this far behind schedule still counts as on time, as on the website.
const LATE_FROM_SEC = 120
// Middle of the dot column: the 80 px time column plus half the 32 px dot column.
const RAIL_X = 96
const MOVE_MS = 1200

/** How far down the list the vehicle is: between the dots it's travelling between, in proportion. */
function busOffset({ stops, centers, km, last, phase }) {
  if (phase === 'finished') return centers[centers.length - 1]
  if (phase !== 'running' || last < 0) return centers[0]
  if (last >= stops.length - 1) return centers[last]
  const span = stops[last + 1].km - stops[last].km
  const along = span > 0 ? Math.min(1, Math.max(0, (km - stops[last].km) / span)) : 0
  return centers[last] + along * (centers[last + 1] - centers[last])
}

/**
 * The route from top to bottom with the vehicle between the stops it's travelling between, as on the
 * website. Each stop shows its scheduled time and, when live, the actual or expected time: green when
 * on time or early, red when late.
 *
 * @param onBusY called with the vehicle's position in the list, so the screen can scroll to it
 */
export default function Timeline({ stops, trip, journey, passedAt = {}, alarmIndex, onToggleAlarm, scheme, train, onBusY }) {
  const { last, phase, source, km } = journey
  const [rows, setRows] = useState({})
  const centers = stops.map((_, i) => rows[i])
  const measured = centers.every((c) => c != null) && stops.length > 1
  const busY = measured ? busOffset({ stops, centers, km, last, phase }) : 0
  const firstY = measured ? centers[0] : 0
  const lastY = measured ? centers[centers.length - 1] : 0

  // Created once; Animated moves it outside React rendering.
  const [animatedY] = useState(() => new Animated.Value(0))
  const placed = useRef(false)
  useEffect(() => {
    if (!measured) return
    if (!placed.current) {
      // Draws down from the first stop when the screen opens.
      animatedY.setValue(firstY)
      placed.current = true
    }
    Animated.timing(animatedY, { toValue: busY, duration: MOVE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
  }, [measured, busY, firstY, animatedY])

  const reported = useRef(false)
  useEffect(() => {
    if (measured && phase === 'running' && !reported.current) {
      reported.current = true
      onBusY?.(busY)
    }
  }, [measured, phase, busY, onBusY])

  const nextStop = phase === 'running' ? nextStopInfo(stops, km, last) : null
  const estimated = source === 'timetable'

  return (
    <View style={{ paddingBottom: 16 }}>
      {measured && (
        <>
          <View style={[styles.rail, { top: firstY, height: lastY - firstY }]} />
          <Animated.View
            style={[styles.rail, { top: firstY, backgroundColor: scheme.road, height: Animated.subtract(animatedY, firstY) }]}
          />
        </>
      )}
      {measured && phase === 'running' && (
        <Animated.View style={[styles.marker, { transform: [{ translateY: Animated.subtract(animatedY, 15) }] }]} pointerEvents="none">
          <View style={[styles.pin, { backgroundColor: estimated ? colors.inkSoft : colors.ink, borderColor: scheme.road }]}>
            {train ? <TrainIcon size={16} color={colors.paper} /> : <BusIcon size={16} color={colors.paper} />}
          </View>
          {nextStop && (
            <View style={styles.label}>
              <Text style={styles.labelText} numberOfLines={1}>
                {nextStop.distanceKm != null ? (
                  <>
                    <Text style={{ fontWeight: '800' }}>{formatDistance(nextStop.distanceKm)}</Text>
                    <Text style={{ color: colors.inkSoft }}> to </Text>
                  </>
                ) : (
                  <Text style={{ color: colors.inkSoft }}>At </Text>
                )}
                <Text style={{ fontWeight: '700' }}>{nextStop.name}</Text>
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {stops.map((stop, i) => {
        const passed = i <= last
        const atStop = phase === 'running' && i === last && km - stop.km < AT_STOP_KM
        const times = stopTimes({ i, passed, trip, journey, passedAt })
        return (
          <View
            key={`${stop.id}-${i}`}
            style={styles.row}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout
              const center = y + height / 2
              setRows((r) => (r[i] === center ? r : { ...r, [i]: center }))
            }}
          >
            <View style={styles.timeCol}>
              {times.scheduled != null && <Text style={styles.scheduled}>{formatClock(times.scheduled)}</Text>}
              {times.actual != null ? (
                <Text style={[styles.actual, { color: tone(times.delay) }]}>{formatClock(times.actual)}</Text>
              ) : times.scheduled == null && !journey.untimed ? (
                <Text style={styles.scheduled}>—</Text>
              ) : null}
            </View>
            <View style={styles.dotCol}>
              <View style={[styles.dot, passed ? { backgroundColor: scheme.road, borderColor: scheme.roadDark } : { backgroundColor: colors.card, borderColor: colors.inkSoft }]} />
            </View>
            <View style={styles.nameCol}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={[styles.name, passed && !atStop && { color: colors.inkSoft }, (atStop || i === 0 || i === stops.length - 1) && { fontWeight: atStop ? '800' : '600' }]}>
                    {stop.name}
                  </Text>
                  <PlatformChip platform={stop.platform} />
                </View>
                <Text style={styles.km}>
                  {formatKm(stop.km)}
                  {times.delay != null && <Text style={{ color: tone(times.delay), fontWeight: '600' }}> · {delayText(times.delay)}</Text>}
                </Text>
              </View>
              {!passed && (
                <Press
                  onPress={() => onToggleAlarm(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${alarmIndex === i ? 'Cancel alert for' : 'Alert me before'} ${stop.name}`}
                  style={[styles.bell, alarmIndex === i && { backgroundColor: scheme.roadDark }]}
                >
                  <BellIcon size={20} color={alarmIndex === i ? '#fff' : 'rgba(86,96,121,0.6)'} />
                </Press>
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** The scheduled time and the actual or expected one, as on the website's timeline. */
function stopTimes({ i, passed, trip, journey, passedAt }) {
  const live = journey.source !== 'timetable'
  const scheduled = journey.offSchedule || journey.untimed ? null : trip.startSec + trip.offsets[i]
  if (!live) return { scheduled, actual: null, delay: null }
  const recorded = passed ? passedAt[i] : null
  const actual = recorded ?? journey.eta[i]
  return { scheduled, actual, delay: scheduled != null && actual != null ? actual - scheduled : null }
}

const tone = (delay) => (delay == null ? colors.ink : delay >= LATE_FROM_SEC ? colors.late : colors.ontime)

function delayText(delay) {
  const minutes = Math.round(Math.abs(delay) / 60)
  if (delay >= LATE_FROM_SEC) return `${minutes} min late`
  if (delay <= -LATE_FROM_SEC) return `${minutes} min early`
  return 'On time'
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', left: RAIL_X - 3, width: 6, borderRadius: 3, backgroundColor: colors.line },
  marker: { position: 'absolute', left: RAIL_X - 15, top: 0, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pin: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  label: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 230, elevation: 3 },
  labelText: { fontSize: 12, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  timeCol: { width: 80, paddingVertical: 10, paddingRight: 8, alignItems: 'flex-end' },
  scheduled: { fontSize: 12, color: colors.inkSoft },
  actual: { marginTop: 2, fontSize: 13, fontWeight: '800' },
  dotCol: { width: 32, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, zIndex: 5 },
  nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 8, paddingRight: 8 },
  name: { fontSize: 14, color: colors.ink },
  km: { fontSize: 12, color: colors.inkSoft },
  bell: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
