import { router } from 'expo-router'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useEffect, useRef, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ALARM_DISTANCES_KM, useStopAlarm } from '../lib/alarm.js'
import { api } from '../lib/api.js'
import { useData, useTick } from '../lib/hooks.js'
import { useLiveBuses, useRiderStatus } from '../lib/live.js'
import {
  assignBuses,
  atRouteEnd,
  clockForTrip,
  defaultDeparture,
  describeJourney,
  formatAge,
  formatClock,
  formatDistance,
  formatDuration,
  formatKm,
  isMetro,
  nearestDeparture,
  secondsNow,
  timetableCacheMs,
  wordsFor,
} from '../lib/shared.js'
import { familySharingAvailable, useFamilyShare, useRiderSharing } from '../lib/sharing.js'
import { colors, lineScheme } from '../lib/theme.js'
import { canReadTowers, usePhonePosition } from '../lib/tracking.js'
import { FeedNotice } from './Home.js'
import RouteMap from './RouteMap.js'
import Timeline from './Timeline.js'
import { ErrorMessage, Message, Press, Segmented, ServicePlate } from './ui.js'

const FALLBACK_SPEED_KMH = 20
const KEEP_AWAKE_TAG = 'tracking'

const TRACKING_OPTIONS = [
  {
    id: 'cell',
    label: 'Cell tower',
    detail: 'Saves battery',
    hint: () =>
      canReadTowers()
        ? 'Reads nearby cell towers, with network location as backup. Works where GPS is weak, but is less precise.'
        : "Uses your phone's network location. Reading cell towers directly needs the installed app, not Expo Go.",
  },
  { id: 'gps', label: 'GPS', detail: 'Most accurate', hint: () => "Uses your phone's GPS. Best with a clear view of the sky, and uses more battery." },
]

function usualSpeed(service) {
  const durations = service?.departures.map((d) => d.durationSec).sort((a, b) => a - b)
  const typical = durations?.[Math.floor(durations.length / 2)]
  return typical > 0 ? service.km / (typical / 3600) : FALLBACK_SPEED_KMH
}

/** One bus or train, live where possible, as on the website. */
export default function BusScreen({ feedId, serviceId, initialTripId }) {
  useTick(15_000)
  const insets = useSafeAreaInsets()
  const scroll = useRef(null)
  const timelineTop = useRef(0)
  const { data: feeds } = useData('feeds', (signal) => api.feeds(signal), { cacheMs: 7 * 24 * 3600 * 1000 })
  const feed = feeds?.find((f) => f.id === feedId)
  const words = wordsFor(feed)
  const metro = isMetro(feed)

  const [onBus, setOnBus] = useState(false)
  const [trackBy, setTrackBy] = useState(null)
  const mode = onBus && trackBy ? trackBy : 'off'
  const [refreshCount, setRefreshCount] = useState(0)
  const [pickedTripId, setPickedTripId] = useState(initialTripId ?? null)
  const [matchedTripId, setMatchedTripId] = useState(null)
  const [view, setView] = useState('stops')
  const [picking, setPicking] = useState(false)
  const [helping, setHelping] = useState(false)

  const { data: service, error: serviceError, retry: retryService } = useData(`svc|${feedId}|${serviceId}`, (signal) => api.service(feedId, serviceId, signal), {
    // A saved copy shows at once while the fresh one loads: kept 12 hours for buses, a week for metro.
    cacheMs: timetableCacheMs(feed),
  })
  const nowSec = secondsNow(service?.timezone ?? 'Asia/Kolkata')
  const timetabled = service?.timetabled !== false
  const scheme = lineScheme(metro ? service?.color : null)

  const { position, method, error: locationError, tooVague, accuracy, fixRef } = usePhonePosition(service?.stops, mode, usualSpeed(service), (km) => {
    const match = nearestDeparture(service.departures, service.km, km, nowSec)
    if (match) setMatchedTripId(match.departure.tripId)
  })

  const { buses, passings, checked: liveChecked } = useLiveBuses(feedId, serviceId, refreshCount, service, Boolean(feed?.hasLiveBuses))
  const waitingForLive = Boolean(feed?.hasLiveBuses) && !liveChecked
  const assigned = service ? assignBuses(buses, service.departures, service.km, nowSec) : new Map()
  const fallback = service ? defaultDeparture(service.departures, nowSec) : null
  const running = service ? buses.filter((b) => !atRouteEnd(b, service.km)) : []
  const autoBus = mode === 'off' && !pickedTripId && running.length > 0 ? running.reduce((a, b) => (b.km > a.km ? b : a)) : null
  const autoBusTrip = autoBus ? nearestDeparture(service.departures, service.km, autoBus.km, nowSec, Infinity)?.departure.tripId : null
  const tripId = pickedTripId ?? (mode !== 'off' ? matchedTripId : null) ?? autoBusTrip ?? fallback?.tripId ?? service?.untimedTripId ?? null
  const { data: trip, error: tripError, retry: retryTrip } = useData(tripId && `trip|${feedId}|${tripId}`, (signal) => api.trip(feedId, tripId, signal), { cacheMs: timetableCacheMs(feed) })

  const live = useRiderStatus(feedId, tripId, refreshCount)
  useRiderSharing({ feedId, tripId, mode, enabled: helping, fixRef })
  const family = useFamilyShare({ feedId, tripId, tracking: mode !== 'off', fixRef, source: mode === 'gps' ? 'gps' : 'cell', destination: service?.to, words })

  const phoneKm = position?.onRoute ? position.km : null
  const bus = autoBus ?? assigned.get(tripId) ?? null
  const journey = service && trip?.tripId === tripId ? describeJourney({ stops: service.stops, trip, nowSec, phoneKm, bus, live, mode, timetabled }) : null
  const stopAlarm = useStopAlarm(service?.stops, journey)

  // Phones pause apps once the screen locks, which would stop tracking and sharing.
  const keepAwake = mode !== 'off' || family.share != null
  useEffect(() => {
    if (!keepAwake) return undefined
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    return () => deactivateKeepAwake(KEEP_AWAKE_TAG)
  }, [keepAwake])

  const refresh = () => {
    retryService()
    retryTrip()
    setRefreshCount((c) => c + 1)
  }

  if (serviceError && !service) {
    return (
      <View style={styles.screen}>
        <TopBar insets={insets} />
        <ErrorMessage title={`We couldn't open this ${words.bus}`} error={serviceError} onRetry={retryService} />
      </View>
    )
  }
  if (!service) {
    return (
      <View style={styles.screen}>
        <TopBar insets={insets} />
        <Message title={`Loading ${words.bus}…`} />
      </View>
    )
  }

  const selectedDeparture = service.departures.find((d) => d.tripId === tripId)

  return (
    <View style={styles.screen}>
      <TopBar insets={insets}>
        {feed && !feed.numbersAreCodes && <ServicePlate metro={metro} service={service} large />}
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle} numberOfLines={1}>{service.to}</Text>
          <Text style={styles.topSub} numberOfLines={1}>
            from {service.from}
            {service.operator ? ` · ${service.operator}` : ''}
            {feed?.numbersAreCodes ? ` · Code ${service.number}` : ''}
          </Text>
        </View>
      </TopBar>

      <View style={styles.tracking}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '600', fontSize: 16, color: colors.ink }}>{`I'm on this ${words.bus}`}</Text>
          <Switch
            value={onBus}
            onValueChange={(next) => {
              setOnBus(next)
              setTrackBy(null)
              // Getting off ends the family link, so it never shows a vehicle the rider has left.
              if (!next) family.stop()
            }}
            trackColor={{ true: scheme.roadDark, false: 'rgba(86,96,121,0.4)' }}
            thumbColor="#fff"
            accessibilityLabel={`I'm on this ${words.bus}`}
          />
        </View>
        {onBus && (
          <View style={{ marginTop: 10 }}>
            {!trackBy && <Text style={[styles.small, { fontSize: 14, marginBottom: 6 }]}>How should we track your {words.bus}?</Text>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {TRACKING_OPTIONS.map((o) => (
                <Press key={o.id} onPress={() => setTrackBy(o.id)} accessibilityRole="radio" accessibilityState={{ checked: trackBy === o.id }} style={[styles.option, trackBy === o.id && { borderColor: scheme.roadDark, backgroundColor: scheme.tint }]}>
                  <Text style={{ fontWeight: '600', color: colors.ink }}>{o.label}</Text>
                  <Text style={styles.small}>{o.detail}</Text>
                </Press>
              ))}
            </View>
          </View>
        )}
      </View>

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        {(!onBus || trackBy) && (
          <Text style={styles.hint}>
            {onBus
              ? TRACKING_OPTIONS.find((o) => o.id === trackBy).hint()
              : `Showing where the ${words.bus} is from ${feed?.hasLiveBuses ? 'its GPS or riders on board' : 'riders on board'} if available, ${timetabled ? "otherwise it's estimated from the timetable" : "otherwise its position isn't known, as this line has no timetable yet"}.`}
          </Text>
        )}

        {stopAlarm.firing && (
          <View style={styles.alarm} accessibilityRole="alert">
            <Text style={{ flex: 1, color: '#fff', fontWeight: '700' }}>{service.stops[stopAlarm.alarm].name} is coming up. Get ready!</Text>
            <Press onPress={stopAlarm.dismiss} style={styles.alarmOk}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>OK</Text>
            </Press>
          </View>
        )}

        <LocationStatus mode={mode} error={locationError} tooVague={tooVague} accuracy={accuracy} position={position} words={words} />
        {timetabled && service.departures.length === 0 && <Message title="No departures listed today">{`This feed doesn't show this ${words.bus} running today.`}</Message>}
        {journey && !waitingForLive && <StatusCard service={service} journey={journey} bus={bus} method={method} accuracy={accuracy} nowSec={nowSec} words={words} />}

        {timetabled && selectedDeparture && (
          <Press onPress={() => setPicking(true)} style={styles.departure}>
            <View style={{ flex: 1 }}>
              <Text style={styles.small}>Departure</Text>
              <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>
                {formatClock(selectedDeparture.startSec)} to {formatClock(selectedDeparture.startSec + selectedDeparture.durationSec)}
              </Text>
            </View>
            <Text style={{ color: scheme.roadDark, fontWeight: '600' }}>Change</Text>
          </Press>
        )}

        {familySharingAvailable && (mode !== 'off' || family.share) && <FamilyShare family={family} words={words} />}
        {mode !== 'off' && (
          <View style={styles.helpRow}>
            <Switch value={helping} onValueChange={setHelping} trackColor={{ true: colors.ink }} accessibilityLabel={`Help others waiting for this ${words.bus}`} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.ink }}>Help others waiting for this {words.bus}</Text>
              <Text style={styles.small}>Anonymously shares how far along the route the {words.bus} is, only while this is on.</Text>
            </View>
          </View>
        )}

        {tripError && !journey && <ErrorMessage title="We couldn't load this departure" error={tripError} onRetry={retryTrip} />}
        {!journey && !tripError && <Message title={`Loading ${words.stops}…`} />}
        {journey && waitingForLive && <Message title={`Looking for live ${words.buses}…`} />}
        {journey && !waitingForLive && (
          <View>
            {stopAlarm.alarm != null && !stopAlarm.firing && <AlarmNote stop={service.stops[stopAlarm.alarm]} stopAlarm={stopAlarm} scheme={scheme} estimated={journey.source === 'timetable'} timetabled={timetabled} words={words} />}
            <View style={{ marginHorizontal: 16, marginTop: 12 }}>
              <Segmented options={[{ value: 'stops', label: words.Stops }, { value: 'map', label: 'Map' }]} value={view} onChange={setView} />
            </View>
            {view === 'map' ? (
              <RouteMap stops={service.stops} journey={journey} scheme={scheme} metro={metro} />
            ) : (
              <View onLayout={(e) => (timelineTop.current = e.nativeEvent.layout.y)}>
                <Timeline
                  stops={service.stops}
                  trip={trip}
                  journey={journey}
                  passedAt={(bus && passings[bus.plate]) || {}}
                  alarmIndex={stopAlarm.alarm}
                  onToggleAlarm={stopAlarm.toggle}
                  scheme={scheme}
                  train={metro}
                  // Glides to the vehicle once, when the screen opens.
                  onBusY={(y) => setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, timelineTop.current + y - 260), animated: true }), 350)}
                />
              </View>
            )}
          </View>
        )}
        {feed && (
          <View style={{ paddingHorizontal: 16 }}>
            <FeedNotice feed={feed} />
          </View>
        )}
      </ScrollView>

      <Press onPress={refresh} accessibilityLabel={`Refresh this ${words.bus}`} style={[styles.refresh, { bottom: 24 + insets.bottom }]}>
        <Text style={{ color: colors.paper, fontSize: 22, fontWeight: '700' }}>↻</Text>
      </Press>

      <Modal visible={picking} animationType="slide" transparent onRequestClose={() => setPicking(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink, marginBottom: 8 }}>Pick a departure</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {service.departures.map((d) => {
                const clock = clockForTrip(nowSec, d.startSec, d.durationSec)
                const status = clock < d.startSec ? '' : clock <= d.startSec + d.durationSec ? 'Running now' : 'Done'
                return (
                  <Press
                    key={d.tripId}
                    onPress={() => {
                      setPickedTripId(d.tripId)
                      setPicking(false)
                    }}
                    style={[styles.sheetRow, d.tripId === tripId && { backgroundColor: scheme.tint }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', color: colors.ink }}>{formatClock(d.startSec)}</Text>
                      <Text style={styles.small}>
                        Arrives {formatClock(d.startSec + d.durationSec)} · {formatDuration(d.durationSec / 60)}
                      </Text>
                    </View>
                    {status ? <Text style={[styles.small, status === 'Running now' && { color: colors.ontime, fontWeight: '600' }]}>{status}</Text> : null}
                  </Press>
                )
              })}
            </ScrollView>
            <Press onPress={() => setPicking(false)} style={[styles.sheetRow, { justifyContent: 'center' }]}>
              <Text style={{ fontWeight: '600', color: colors.inkSoft }}>Close</Text>
            </Press>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function TopBar({ insets, children }) {
  return (
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <Press onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Back to search" style={styles.back}>
        <Text style={{ color: colors.paper, fontSize: 22 }}>←</Text>
      </Press>
      {children}
    </View>
  )
}

function LocationStatus({ mode, error, tooVague, accuracy, position, words }) {
  if (mode === 'off') return null
  let message = null
  if (error === 'denied') message = 'Location is turned off for this app. Allow it in your phone settings to track from your phone.'
  else if (error === 'unavailable' && position?.km == null) message = mode === 'gps' ? "Can't get a GPS fix yet. Try near a window, or switch to Cell tower." : "Can't get a network location yet. Check location is on, or switch to GPS."
  else if (tooVague) message = `This position is only accurate to about ${Math.round(accuracy / 1000)} km, which is too vague to use. Try GPS.`
  else if (position && !position.onRoute) message = `You're about ${formatKm(position.offRouteKm)} from this route, so we're not using your location. Are you on this ${words.bus}?`
  else if (!position && !error) message = 'Finding your location…'
  return message ? <Text style={[styles.hint, { backgroundColor: colors.tint, color: colors.ink, fontSize: 14 }]}>{message}</Text> : null
}

function StatusCard({ service, journey, bus, method, accuracy, nowSec, words }) {
  const { phase, source, last, delaySec, eta, startsInSec } = journey
  const stops = service.stops
  const next = stops[last + 1]
  const nextEta = next ? eta[last + 1] : null
  const nextInMin = nextEta != null ? Math.max(0, Math.round((nextEta - (journey.clock ?? nowSec)) / 60)) : null

  let headline
  let detail = null
  if (phase === 'unknown') {
    headline = 'No timetable published for this line yet'
    detail = `Turn on “I'm on this ${words.bus}” to track it from your phone.`
  } else if (phase === 'not-started') {
    headline = `Departs in ${formatDuration(startsInSec / 60)}`
    detail = `From ${stops[0].name} at ${formatClock(eta[0])}`
  } else if (phase === 'finished') {
    headline = `Reached ${stops[stops.length - 1].name}`
  } else {
    headline = next ? `Next: ${next.name}` : stops[last].name
    detail = next && nextEta != null ? `${nextInMin === 0 ? 'Due now' : `In about ${formatDuration(nextInMin)}`} · ${formatClock(nextEta)}` : null
  }
  const minutes = delaySec != null ? Math.round(delaySec / 60) : null
  const onTime = minutes != null && Math.abs(minutes) < 2
  // Says where a live position comes from. Nothing for a timetable estimate, and never a rider count.
  const sourceText = {
    gps: "Live from your phone's GPS",
    cell: method === 'tower' ? 'Live from nearby cell towers, approximate' : 'Live from network location, approximate',
    bus: `Live from bus GPS · ${bus?.plate} · ${formatAge(bus?.ageSec ?? 0)}`,
    riders: `Live from riders on this ${words.bus}`,
  }[source]

  return (
    <View style={styles.status}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>{headline}</Text>
          {detail ? <Text style={[styles.small, { fontSize: 14, marginTop: 2 }]}>{detail}</Text> : null}
        </View>
        {minutes != null && phase === 'running' && (
          <View style={[styles.delay, { backgroundColor: onTime || minutes < 0 ? colors.ontime : colors.late }]}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{onTime ? 'On time' : minutes > 0 ? `${formatDuration(minutes)} late` : `${formatDuration(-minutes)} early`}</Text>
          </View>
        )}
      </View>
      {sourceText && (
        <Text style={{ marginTop: 8, fontSize: 12, fontWeight: '500', color: colors.ontime }}>
          ● {sourceText}
          {(source === 'gps' || source === 'cell') && accuracy != null ? ` (to about ${accuracy < 1000 ? `${Math.round(accuracy / 10) * 10 || 10} m` : `${(accuracy / 1000).toFixed(1)} km`})` : ''}
        </Text>
      )}
    </View>
  )
}

function AlarmNote({ stop, stopAlarm, scheme, estimated, timetabled, words }) {
  return (
    <View style={[styles.alarmNote, { backgroundColor: scheme.tint }]}>
      <Text style={{ fontSize: 13, color: colors.ink }}>
        Alarm before <Text style={{ fontWeight: '700' }}>{stop.name}</Text>
        {stopAlarm.remainingKm != null ? ` · ${formatDistance(stopAlarm.remainingKm)} to go` : ''}. Keep the app open.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Text style={styles.small}>Ring at</Text>
        {ALARM_DISTANCES_KM.map((km) => {
          const on = km === stopAlarm.alarmKm
          return (
            <Press key={km} onPress={() => stopAlarm.setAlarmKm(km)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.chip, on ? { backgroundColor: scheme.roadDark, borderColor: scheme.roadDark } : null]}>
              <Text style={{ fontWeight: '600', fontSize: 12, color: on ? '#fff' : colors.inkSoft }}>{km < 1 ? `${km * 1000} m` : `${km} km`}</Text>
            </Press>
          )
        })}
      </View>
      {estimated && (
        <Text style={[styles.small, { marginTop: 8 }]}>
          {timetabled ? `This uses the timetable, so it may ring early or late. Turn on “I'm on this ${words.bus}” to ring from where you really are.` : `This line has no timetable, so the alarm can only ring once you turn on “I'm on this ${words.bus}”.`}
        </Text>
      )}
    </View>
  )
}

function FamilyShare({ family, words }) {
  return (
    <View style={styles.helpRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: family.share ? colors.ontime : colors.ink }}>{family.share ? `● Sharing this ${words.bus} with family` : 'Share live location with family'}</Text>
        <Text style={styles.small}>{family.share ? `They see where the ${words.bus} is on the route, not your exact location.` : `Send a link that shows this ${words.bus} moving. No app needed to open it.`}</Text>
        {family.error ? <Text style={[styles.small, { color: colors.late }]}>{family.error}</Text> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Press onPress={family.send} disabled={family.busy} style={styles.smallButton}>
          <Text style={{ color: colors.paper, fontWeight: '600', fontSize: 12 }}>{family.busy ? 'Creating…' : family.share ? 'Send again' : 'Share'}</Text>
        </Press>
        {family.share && (
          <Press onPress={family.stop} style={[styles.smallButton, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }]}>
            <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 12 }}>Stop</Text>
          </Press>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  top: { backgroundColor: colors.header, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingBottom: 10 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: colors.paper, fontWeight: '600', fontSize: 15 },
  topSub: { color: 'rgba(242,245,251,0.7)', fontSize: 12 },
  tracking: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 10, elevation: 3 },
  option: { flex: 1, borderWidth: 2, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  small: { fontSize: 12, color: colors.inkSoft },
  hint: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 8, fontSize: 12, color: colors.inkSoft, borderBottomWidth: 1, borderBottomColor: colors.line },
  alarm: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.late, paddingHorizontal: 16, paddingVertical: 12 },
  alarmOk: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  status: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  delay: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  departure: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 4, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14 },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  smallButton: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center' },
  alarmNote: { marginHorizontal: 16, marginTop: 10, borderRadius: 12, padding: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  refresh: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,31,61,0.4)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
})
