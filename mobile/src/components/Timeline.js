import { Fragment, useEffect, useRef, useState } from 'react'
import { Animated, Easing, LayoutAnimation, StyleSheet, Text, View } from 'react-native'
import { AT_STOP_KM, formatClock, formatDistance, formatDuration, formatKm, journeyDay, nextStopInfo } from '../lib/shared.js'
import { colors } from '../lib/theme.js'
import { BellIcon, BusIcon, PlatformChip, Press, TrainIcon } from './ui.js'

// Up to this far behind schedule still counts as on time, as on the website.
const LATE_FROM_SEC = 120
// Middle of the dot column: the 80 px time column plus half the 32 px dot column.
const RAIL_X = 96
const MOVE_MS = 1200
// A grey band behind the time and name (not the line) marks stations the train doesn't stop at.
const PASSING_BG = 'rgba(223,229,240,0.7)'

// Opening or closing the stations between two stops slides the rows below and fades the stations in or out.
const slide = () => LayoutAnimation.configureNext(LayoutAnimation.create(280, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))

/**
 * How far down the list the vehicle is: between the two dots either side of it (stops, and stations
 * passed without stopping when shown), in proportion to how far along it really is.
 *
 * @param points every dot shown, top to bottom, as {km, y}
 */
function busOffset({ points, km, last, phase }) {
  if (phase === 'finished') return points[points.length - 1].y
  if (phase !== 'running' || last < 0) return points[0].y
  let i = 0
  while (i + 1 < points.length && points[i + 1].km <= km) i++
  if (i >= points.length - 1) return points[i].y
  const span = points[i + 1].km - points[i].km
  const along = span > 0 ? Math.min(1, Math.max(0, (km - points[i].km) / span)) : 0
  return points[i].y + along * (points[i + 1].y - points[i].y)
}

/** Stations passed without stopping, grouped by the stop they come after. */
function passingByStop(passing) {
  const out = {}
  for (const p of passing ?? []) (out[p.after] ??= []).push(p)
  return out
}

/**
 * When a train goes through a station it doesn't stop at: between leaving the stop before and
 * reaching the next one, in proportion to the distance, as the timetable gives no time for it.
 */
function passingSec(trip, after, p, stops) {
  const leaves = trip.startSec + trip.offsets[after]
  const arrives = trip.startSec + (trip.arrivals?.[after + 1] ?? trip.offsets[after + 1])
  const span = stops[after + 1].km - stops[after].km
  return leaves + (span > 0 ? (p.km - stops[after].km) / span : 0) * (arrives - leaves)
}

/** With a live or last-seen position, the passing time plus the delay expected at the next stop. */
function expectedAt(at, after, trip, journey) {
  if (journey.source === 'timetable' || journey.eta?.[after + 1] == null) return null
  return at + journey.eta[after + 1] - (trip.startSec + (trip.arrivals?.[after + 1] ?? trip.offsets[after + 1]))
}

/**
 * The route from top to bottom with the vehicle between the stops it's travelling between, as on the
 * website. Each stop shows its scheduled time and, when live, the actual or expected time: green when
 * on time or early, red when late.
 *
 * @param onBusY called with the vehicle's position in the list, so the screen can scroll to it
 */
/** @param showDays label stops reached a day or two into the journey ("Day 2"), for long trains */
/** @param passing stations a train goes through without stopping, shown when its stop is tapped */
export default function Timeline({ stops, trip, journey, passedAt = {}, alarmIndex, onToggleAlarm, scheme, train, onBusY, showDays = false, passing }) {
  const { last, phase, source, km } = journey
  // Where each dot sits: stops by index, passed stations by "p<stop>:<km>".
  const [rows, setRows] = useState({})
  // Stops whose stations passed without stopping are shown, by index.
  const [open, setOpen] = useState(() => new Set())
  const byStop = passingByStop(passing)
  const passingCount = passing?.length ?? 0
  const allOpen = passingCount > 0 && Object.keys(byStop).every((i) => open.has(Number(i)))
  const toggle = (i) => {
    slide()
    setOpen((old) => {
      const next = new Set(old)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  const measured = stops.every((_, i) => rows[i] != null) && stops.length > 1
  const points = []
  if (measured) {
    stops.forEach((stop, i) => {
      points.push({ km: stop.km, y: rows[i] })
      if (open.has(i)) for (const p of byStop[i] ?? []) if (rows[`p${i}:${p.km}`] != null) points.push({ km: p.km, y: rows[`p${i}:${p.km}`] })
    })
    points.sort((a, b) => a.y - b.y)
  }
  const place = (key) => (e) => {
    const { y, height } = e.nativeEvent.layout
    const center = y + height / 2
    setRows((r) => (r[key] === center ? r : { ...r, [key]: center }))
  }
  const busY = measured ? busOffset({ points, km, last, phase }) : 0
  const firstY = measured ? points[0].y : 0
  const lastY = measured ? points[points.length - 1].y : 0

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
  // Grey for any estimate: the timetable, or a delay carried forward from where it was last seen.
  const estimated = source === 'timetable' || source === 'lastSeen'

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
      {/* Waits at the first stop before it leaves; a train also keeps its icon at the destination once it has arrived. */}
      {measured && (phase === 'running' || phase === 'not-started' || (showDays && phase === 'finished')) && (
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
                {/* Trains often run late, so a timetable position is labelled as one. */}
                {showDays && source === 'timetable' ? <Text style={{ color: colors.inkSoft }}> · as per timetable</Text> : null}
                {source === 'lastSeen' ? <Text style={{ color: colors.inkSoft }}> · estimated</Text> : null}
              </Text>
            </View>
          )}
          {phase === 'not-started' && journey.startsInSec != null && (
            <View style={styles.label}>
              <Text style={styles.labelText} numberOfLines={1}>
                <Text style={{ color: colors.inkSoft }}>Departs in </Text>
                <Text style={{ fontWeight: '800' }}>{formatDuration(journey.startsInSec / 60)}</Text>
                {journey.delaySec >= LATE_FROM_SEC ? <Text style={{ color: colors.late, fontWeight: '600' }}> · {delayText(journey.delaySec)}</Text> : null}
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {passingCount > 0 && (
        <View style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 4 }}>
          <Press
            onPress={() => {
              slide()
              setOpen(allOpen ? new Set() : new Set(Object.keys(byStop).map(Number)))
            }}
            accessibilityRole="button"
            style={styles.allButton}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.inkSoft }}>
              {allOpen ? 'Show stops only' : `Show all ${passingCount + stops.length} stations`}
            </Text>
          </Press>
        </View>
      )}
      {stops.map((stop, i) => {
        const passed = i <= last
        const atStop = phase === 'running' && i === last && km - stop.km < AT_STOP_KM
        const times = stopTimes({ i, passed, trip, journey, passedAt })
        const day = showDays ? journeyDay(trip, i) : 0
        const newDay = showDays && day > 0 && (i === 0 || journeyDay(trip, i - 1) !== day)
        const through = byStop[i] ?? []
        const isOpen = open.has(i)
        const isLast = i === stops.length - 1
        // Trains, as in the railway timetable: arrival on the left (departure at the first station),
        // departure on the right (none at the last).
        const timed = trip && !journey.offSchedule && !journey.untimed
        const arrives = showDays && timed ? trip.startSec + (i === 0 ? trip.offsets[0] : (trip.arrivals?.[i] ?? trip.offsets[i])) : null
        const leaves = showDays && timed && !isLast ? trip.startSec + trip.offsets[i] : null
        return (
          <Fragment key={`${stop.id}-${i}`}>
          <View style={styles.row} onLayout={place(i)}>
            <View style={styles.timeCol}>
              {newDay && <Text style={{ fontSize: 11, fontWeight: '800', color: scheme.roadDark }}>Day {day + 1}</Text>}
              {(arrives ?? times.scheduled) != null && <Text style={styles.scheduled}>{formatClock(arrives ?? times.scheduled)}</Text>}
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
              <Press
                style={{ flex: 1 }}
                disabled={!through.length}
                onPress={() => toggle(i)}
                accessibilityRole={through.length ? 'button' : undefined}
                accessibilityState={through.length ? { expanded: isOpen } : undefined}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={[styles.name, passed && !atStop && { color: colors.inkSoft }, (atStop || i === 0 || i === stops.length - 1) && { fontWeight: atStop ? '800' : '600' }]}>
                    {stop.name}
                  </Text>
                  <PlatformChip platform={stop.platform} />
                </View>
                <Text style={styles.km}>
                  {formatKm(stop.km)}
                  {showDays && stopStatus({ passed, atStop, isLast: i === stops.length - 1, phase }) && (
                    <Text style={{ color: colors.ink, fontWeight: '600' }}> · {stopStatus({ passed, atStop, isLast: i === stops.length - 1, phase })}</Text>
                  )}
                  {times.delay != null && <Text style={{ color: tone(times.delay), fontWeight: '600' }}> · {delayText(times.delay)}</Text>}
                </Text>
              </Press>
              {leaves != null && <Text style={styles.scheduled}>{formatClock(leaves)}</Text>}
              {passed ? (
                // Keeps the bell's place, so departure times stay in line once a station is passed.
                showDays && <View style={styles.bell} />
              ) : (
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
          {isOpen &&
            through.map((p) => {
              const gone = phase === 'finished' || (phase === 'running' && km >= p.km)
              const at = journey.offSchedule || journey.untimed ? null : passingSec(trip, i, p, stops)
              const expected = at != null ? expectedAt(at, i, trip, journey) : null
              return (
                <View key={`p${i}:${p.km}`} style={styles.row} onLayout={place(`p${i}:${p.km}`)}>
                  <View style={[styles.timeCol, { paddingVertical: 11, backgroundColor: PASSING_BG }]}>
                    {at != null && <Text style={{ fontSize: 11, color: colors.inkSoft }}>~{formatClock(at)}</Text>}
                    {expected != null && <Text style={{ fontSize: 11, fontWeight: '700', color: tone(expected - at) }}>{formatClock(expected)}</Text>}
                  </View>
                  <View style={styles.dotCol}>
                    <View style={[styles.smallDot, gone ? { backgroundColor: scheme.road } : { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.inkSoft }]} />
                  </View>
                  <View style={[styles.nameCol, { paddingVertical: 11, backgroundColor: PASSING_BG }]}>
                    <Text style={{ fontSize: 13, color: gone ? colors.inkSoft : colors.ink }} numberOfLines={1}>
                      {p.name}
                      <Text style={{ color: colors.inkSoft }}> · {formatKm(p.km)}</Text>
                    </Text>
                  </View>
                </View>
              )
            })}
          </Fragment>
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

/** Where the train is in relation to a station: departed, at the station, or arrived at the end. */
function stopStatus({ passed, atStop, isLast, phase }) {
  if (atStop) return 'At station'
  if (isLast) return phase === 'finished' ? 'Arrived' : null
  return passed ? 'Departed' : null
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
  timeCol: { width: 80, paddingVertical: 10, paddingRight: 8, alignItems: 'flex-end', justifyContent: 'center' },
  scheduled: { fontSize: 12, color: colors.inkSoft },
  actual: { marginTop: 2, fontSize: 13, fontWeight: '800' },
  dotCol: { width: 32, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, zIndex: 5 },
  smallDot: { width: 8, height: 8, borderRadius: 4, zIndex: 5 },
  allButton: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  nameCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 8, paddingRight: 8 },
  name: { fontSize: 14, color: colors.ink },
  km: { fontSize: 12, color: colors.inkSoft },
  bell: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
