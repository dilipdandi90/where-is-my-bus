import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { canReadTowers, readCells } from '../lib/cells.js'
import { track } from '../lib/usage.js'
import { useStopAlarm } from '../lib/alarm.js'
import { useFamilyShare } from '../lib/familyShare.js'
import { useData, usePhonePosition, useTick, useWakeLock } from '../lib/hooks.js'
import { assignBuses, atRouteEnd, defaultDeparture, describeJourney } from '../lib/journey.js'
import { formatAge, formatClock, formatDuration, formatKm, secondsNow } from '../lib/time.js'
import { nearestDeparture } from '../lib/tracker.js'
import { isMetro, lineColours, wordsFor } from '../lib/words.js'
import DeparturePicker from './DeparturePicker.jsx'
import FeedNotice from './FeedNotice.jsx'
import LiveBuses from './LiveBuses.jsx'
import { FamilyShareControl } from './FamilyShare.jsx'
import JourneyView from './JourneyView.jsx'
import { AlarmBanner, AlarmNote } from './StopAlarm.jsx'
import { ErrorMessage, Message, ReloadIcon, ServicePlate } from './ui.jsx'

const LIVE_POLL_MS = 15_000
// A live bus moving back along the route by more than this has started a new run, not wobbled.
const RESTART_KM = 1
// Fastest a city or state bus plausibly travels, plus slack for GPS wobble, when checking that a
// change in position since the last sighting is real movement and not a jump.
const MAX_BUS_KMH = 80
const JUMP_ALLOWANCE_KM = 0.5
const SHARE_EVERY_MS = 15_000
// A random ID for this visit only, so one rider's reports count once.
const RIDER_ID = globalThis.crypto?.randomUUID?.() ?? null

/** What the page uses when the rider isn't tracking from their own phone. */
function notOnBusHint(feed, words, timetabled) {
  const sources = feed?.hasLiveBuses ? 'its GPS or riders on board' : 'riders on board'
  const otherwise = timetabled ? "otherwise it's estimated from the timetable" : "otherwise its position isn't known, as this line has no timetable yet"
  return `Showing where the ${words.bus} is from ${sources} if available, ${otherwise}.`
}

const TRACKING_OPTIONS = [
  {
    id: 'cell',
    label: 'Cell tower',
    detail: 'Saves battery',
    hint: canReadTowers()
      ? 'Reads nearby cell towers, with network location as backup. Works where GPS is weak, but is less precise.'
      : "Uses your phone's network location. Reading cell towers directly needs the Android app.",
  },
  { id: 'gps', label: 'GPS', detail: 'Most accurate', hint: "Uses your phone's GPS. Best with a clear view of the sky, and uses more battery." },
]
const FALLBACK_SPEED_KMH = 20
// Timetables change at most daily, so a saved copy shows instantly and the fresh one replaces it.
const CACHE_TIMETABLE_MS = 12 * 3600 * 1000

/** @param initialTripId the departure the rider tapped, if they tapped one, shown instead of the default. */
export default function BusScreen({ feedId, feed, serviceId, initialTripId = null }) {
  useTick(15_000)
  // Always starts off, so opening a bus never uses location until the rider chooses to.
  const [onBus, setOnBus] = useState(false)
  const [trackBy, setTrackBy] = useState(null)
  const mode = onBus && trackBy ? trackBy : 'off'
  const [refreshCount, setRefreshCount] = useState(0)
  const [pickedTripId, setPickedTripId] = useState(initialTripId)
  const [matchedTripId, setMatchedTripId] = useState(null)

  const { data: service, error: serviceError, retry: retryService, refreshing: serviceRefreshing } = useData(`svc|${feedId}|${serviceId}`, (signal) => api.service(feedId, serviceId, signal), { cacheMs: CACHE_TIMETABLE_MS })

  const openedNumber = service?.number
  useEffect(() => {
    if (openedNumber) track('open_bus', { feed: feedId, bus: openedNumber })
  }, [feedId, openedNumber])

  const nowSec = secondsNow(service?.timezone ?? 'Asia/Kolkata')
  const words = wordsFor(feed)
  const metro = isMetro(feed)
  // A line with no published timetable still has stations and can be tracked live, but has no departures.
  const timetabled = service?.timetabled !== false

  // When a rider starts tracking, work out which departure they're on, unless they've picked one.
  const { position, method, error: locationError, tooVague, accuracy, fixRef } = usePhonePosition(service?.stops, mode, usualSpeed(service), (km) => {
    const match = nearestDeparture(service.departures, service.km, km, nowSec)
    if (match) setMatchedTripId(match.departure.tripId)
  })

  const { buses, passings, checked: liveChecked } = useLiveBuses(feedId, serviceId, refreshCount, service)
  // Where buses report GPS, wait for the first answer before drawing the journey. Otherwise the
  // timetable's version shows for a moment and the line visibly jumps once the real bus arrives.
  const waitingForLive = Boolean(feed?.hasLiveBuses) && !liveChecked
  const [followedPlate, setFollowedPlate] = useState(null)
  const assigned = service ? assignBuses(buses, service.departures, service.km, nowSec) : new Map()

  const fallback = service ? defaultDeparture(service.departures, nowSec) : null
  // Bus GPS comes first whenever a live bus is on the route, day or night — unless the rider picked a
  // departure, is following a particular bus, or is tracking from their own phone (GPS or cell tower).
  const running = service ? buses.filter((b) => !atRouteEnd(b, service.km)) : []
  const autoBus = mode === 'off' && !pickedTripId && !followedPlate && running.length > 0 ? running.reduce((a, b) => (b.km > a.km ? b : a)) : null
  const autoBusTrip = autoBus ? nearestDeparture(service.departures, service.km, autoBus.km, nowSec, Infinity)?.departure.tripId : null
  const tripId = pickedTripId ?? (mode !== 'off' ? matchedTripId : null) ?? autoBusTrip ?? fallback?.tripId ?? service?.untimedTripId ?? null
  const { data: trip, error: tripError, retry: retryTrip, refreshing: tripRefreshing } = useData(tripId && `trip|${feedId}|${tripId}`, (signal) => api.trip(feedId, tripId, signal), { cacheMs: CACHE_TIMETABLE_MS })

  const live = useLivePolling(feedId, tripId, mode, refreshCount)
  const [sharing, setSharing] = useState(false)
  useSharing({ feedId, tripId, mode, enabled: sharing, fixRef })

  const phoneKm = position?.onRoute ? position.km : null
  const followed = buses.find((b) => b.plate === followedPlate)
  const bus = followed ?? autoBus ?? assigned.get(tripId) ?? null
  const journey =
    service && trip?.tripId === tripId
      ? describeJourney({ stops: service.stops, trip, nowSec, phoneKm, bus, live, mode, timetabled })
      : null

  const stopAlarm = useStopAlarm(service?.stops, journey)
  const { alarm, firing } = stopAlarm
  const family = useFamilyShare({ feedId, tripId, tracking: mode !== 'off', fixRef, source: mode === 'gps' ? 'gps' : 'cell' })
  // Browsers pause pages once the screen locks, which would stop tracking, the alarm and sharing.
  useWakeLock(mode !== 'off' || alarm != null || family.share != null)

  const refresh = () => {
    retryService()
    retryTrip()
    setRefreshCount((c) => c + 1)
  }

  if (serviceError && !service) {
    return (
      <>
        <TopBar />
        <ErrorMessage title={`We couldn't open this ${words.bus}`} error={serviceError} onRetry={retryService} />
      </>
    )
  }
  if (!service) {
    return (
      <>
        <TopBar />
        <Message title={`Loading ${words.bus}…`} />
      </>
    )
  }

  return (
    // Metro screens take the line's colour (purple, aqua or pink) in place of the usual orange.
    <div style={metro ? lineColours(service.color) : undefined}>
      <div className="sticky top-0 z-30 shadow-md">
        <TopBar>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {feed && !feed.numbersAreCodes && <ServicePlate metro={metro} service={service} large />}
            <div className="min-w-0 text-sm leading-tight">
              <div className="truncate font-semibold">{service.to}</div>
              <div className="truncate text-xs text-paper/70">
                from {service.from}
                {service.operator && ` · ${service.operator}`}
                {feed?.numbersAreCodes && ` · Code ${service.number}`}
              </div>
            </div>
          </div>
        </TopBar>
        <TrackingControls
          words={words}
          onBus={onBus}
          trackBy={trackBy}
          onChangeOnBus={(next) => {
            setOnBus(next)
            // Getting off ends the family link, so it never shows a bus the rider has left.
            if (!next) family.stop()
            // Asked again each time, because the better choice depends on the phone's signal now.
            setTrackBy(null)
          }}
          onChangeTrackBy={(choice) => {
            setTrackBy(choice)
            track('tracking', { feed: feedId, text: choice })
          }}
        />
      </div>

      {(!onBus || trackBy) && (
        <p className="border-b border-line bg-card px-4 py-2 text-xs text-ink-soft">
          {onBus ? TRACKING_OPTIONS.find((o) => o.id === trackBy).hint : notOnBusHint(feed, words, timetabled)}
        </p>
      )}

      {timetabled && service.departures.length === 0 ? (
        <Message title="No departures listed today">{`This feed doesn't show this ${words.bus} running today.`}</Message>
      ) : (
        // The bottom padding keeps the last stop and its alert bell clear of the refresh button.
        <main className="pb-48">
          {firing && <AlarmBanner stop={service.stops[alarm]} onDismiss={stopAlarm.dismiss} />}

          <LocationStatus mode={mode} error={locationError} tooVague={tooVague} accuracy={accuracy} position={position} words={words} />
          {journey && !waitingForLive && <StatusCard service={service} journey={journey} bus={bus} method={method} accuracy={accuracy} nowSec={nowSec} words={words} />}

          {/* Community timetables often stop well before the real last bus, so don't imply service has ended. */}
          {journey && !bus && journey.source === 'timetable' && journey.phase === 'finished' && (
            <p className="border-b border-line bg-tint px-4 py-2.5 text-sm text-ink">
              {buses.length > 0
                ? `Today's timetable has ended, but ${buses.length} live ${buses.length === 1 ? 'bus is' : 'buses are'} running now — see the list below.`
                : feed && !feed.official
                  ? `This is the last trip in our timetable. The data can be incomplete, so real ${words.buses} may run later than shown.`
                  : null}
            </p>
          )}

          {timetabled && (
          <DeparturePicker
            departures={service.departures}
            selectedId={tripId}
            nowSec={nowSec}
            liveBus={journey?.offSchedule && bus ? bus : null}
            onSelect={(id) => {
              setPickedTripId(id)
              setFollowedPlate(null)
            }}
          />
          )}
          <LiveBuses
            buses={buses}
            stops={service.stops}
            followedPlate={bus?.plate}
            onFollow={(b) => {
              setFollowedPlate(b.plate)
              const match = nearestDeparture(service.departures, service.km, b.km, nowSec, Infinity)
              if (match) setPickedTripId(match.departure.tripId)
            }}
          />

          {(mode !== 'off' || family.share) && <FamilyShareControl family={family} destination={service.to} words={words} />}

          {mode !== 'off' && (
            <label className="flex items-start gap-3 border-b border-line px-4 py-3 text-sm">
              <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} className="mt-0.5 size-5 accent-ink" />
              <span>
                <span className="font-semibold">Help others waiting for this {words.bus}</span>
                <span className="block text-xs text-ink-soft">
                  {canReadTowers()
                    ? `Anonymously shares how far along the route the ${words.bus} is, and helps map cell towers, only while this is on. Nothing is tied to you.`
                    : `Anonymously shares how far along the route the ${words.bus} is, only while this is on. Your exact location isn't stored.`}
                </span>
              </span>
            </label>
          )}

          {tripError && !journey && <ErrorMessage title="We couldn't load this departure" error={tripError} onRetry={retryTrip} />}
          {!journey && !tripError && <Message title={`Loading ${words.stops}…`} />}
          {journey && waitingForLive && <Message title="Looking for live buses…" />}
          {journey && !waitingForLive && (
            <div className="pt-1">
              {alarm != null && !firing && (
                <AlarmNote
                  stop={service.stops[alarm]}
                  alarmKm={stopAlarm.alarmKm}
                  onChangeKm={stopAlarm.setAlarmKm}
                  remainingKm={stopAlarm.remainingKm}
                  estimated={journey.source === 'timetable'}
                  estimateHint={
                    timetabled
                      ? `This uses the timetable, so it may ring early or late. Turn on “I'm on this ${words.bus}” to ring from where you really are.`
                      : `This line has no timetable, so the alarm can only ring once you turn on “I'm on this ${words.bus}”.`
                  }
                />
              )}
              <JourneyView
                stopsLabel={words.Stops}
                lineColor={metro ? service.color : null}
                stops={service.stops}
                trip={trip}
                journey={journey}
                passedAt={(bus && passings[bus.plate]) || {}}
                alarmIndex={alarm}
                onToggleAlarm={stopAlarm.toggle}
              />
            </div>
          )}

          {feed && (
            <footer className="border-t border-line px-4 py-3">
              <FeedNotice feed={feed} />
            </footer>
          )}
        </main>
      )}

      <RefreshButton words={words} onClick={refresh} refreshing={serviceRefreshing || tripRefreshing} />
    </div>
  )
}

function usualSpeed(service) {
  const durations = service?.departures.map((d) => d.durationSec).sort((a, b) => a - b)
  const typical = durations?.[Math.floor(durations.length / 2)]
  return typical > 0 ? service.km / (typical / 3600) : FALLBACK_SPEED_KMH
}

function TopBar({ children }) {
  return (
    <header className="app-header flex items-center gap-2 px-2 py-2.5 text-paper">
      <a href="#/" aria-label="Back to search" className="flex size-10 shrink-0 items-center justify-center rounded-full text-xl">
        ←
      </a>
      {children}
    </header>
  )
}

/** Floats at the bottom right of the app's column, which is centred on wide screens. */
function RefreshButton({ words, onClick, refreshing }) {
  return (
    <button
      onClick={onClick}
      disabled={refreshing}
      aria-label={`Refresh this ${words.bus}`}
      title="Refresh"
      className="fixed right-[max(1.25rem,calc((100vw-36rem)/2+1.25rem))] bottom-[calc(2.5rem+env(safe-area-inset-bottom))] z-20 flex size-14 items-center justify-center rounded-full bg-ink text-paper shadow-lg"
    >
      <ReloadIcon className={`size-6 ${refreshing ? 'animate-spin' : ''}`} />
    </button>
  )
}

/** "Are you on this bus?", then how to track it. Location is only used once both are answered. */
function TrackingControls({ words, onBus, trackBy, onChangeOnBus, onChangeTrackBy }) {
  return (
    <div className="bg-card px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span id="on-bus-label" className="font-semibold">
          I'm on this {words.bus}
        </span>
        <button
          role="switch"
          aria-checked={onBus}
          aria-labelledby="on-bus-label"
          onClick={() => onChangeOnBus(!onBus)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${onBus ? 'bg-road-dark' : 'bg-ink-soft/40'}`}
        >
          <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${onBus ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {onBus && (
        <div className="mt-2.5">
          {!trackBy && <p className="mb-1.5 text-sm text-ink-soft">How should we track your {words.bus}?</p>}
          <div role="radiogroup" aria-label={`How to track your ${words.bus}`} className="grid grid-cols-2 gap-2">
            {TRACKING_OPTIONS.map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={o.id === trackBy}
                onClick={() => onChangeTrackBy(o.id)}
                className={`rounded-xl border-2 px-3 py-2 text-left ${o.id === trackBy ? 'border-road-dark bg-tint' : 'border-line'}`}
              >
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-ink-soft">{o.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Explains why the phone's location isn't being used, when it isn't. */
function LocationStatus({ mode, error, tooVague, accuracy, position, words }) {
  if (mode === 'off') return null

  let message = null
  if (error === 'denied') {
    message = 'Location is blocked for this site. Allow it in your browser settings to track from your phone.'
  } else if (error === 'unsupported') {
    message = "This browser can't share location."
  } else if (error === 'unavailable' && position?.km == null) {
    message =
      mode === 'gps'
        ? "Can't get a GPS fix yet. Try near a window, or switch to Cell tower."
        : "Can't get a network location yet. Check location is on, or switch to GPS."
  } else if (tooVague) {
    message = `This position is only accurate to about ${Math.round(accuracy / 1000)} km, which is too vague to use. Try GPS.`
  } else if (position && !position.onRoute) {
    message = `You're about ${formatKm(position.offRouteKm)} from this route, so we're not using your location. Are you on this ${words.bus}?`
  } else if (!position && !error) {
    message = 'Finding your location…'
  }
  return message && <p className="border-b border-line bg-tint px-4 py-2.5 text-sm">{message}</p>
}

function StatusCard({ service, journey, bus, method, accuracy, nowSec, words }) {
  const { phase, source, last, delaySec, eta, startsInSec } = journey
  const stops = service.stops
  const next = stops[last + 1]
  const nextEta = next ? eta[last + 1] : null
  const nextInMin = nextEta != null ? Math.max(0, Math.round((nextEta - (journey.clock ?? nowSec)) / 60)) : null

  let headline
  let detail
  if (phase === 'unknown') {
    headline = 'No timetable published for this line yet'
    detail = `Turn on “I'm on this ${words.bus}” to track it from your phone.`
  } else if (phase === 'not-started') {
    headline = `Departs in ${formatDuration(startsInSec / 60)}`
    detail = `From ${stops[0].name} at ${formatClock(eta[0])}`
  } else if (phase === 'finished') {
    headline = `Reached ${stops[stops.length - 1].name}`
    detail = source === 'timetable' ? 'According to the timetable' : null
  } else {
    headline = next ? `Next: ${next.name}` : stops[last].name
    // Without a matching scheduled trip there's no arrival time to give, so just the stop is shown.
    detail = next && nextEta != null ? `${nextInMin === 0 ? 'Due now' : `In about ${formatDuration(nextInMin)}`} · ${formatClock(nextEta)}` : null
  }

  return (
    <section className="border-b border-line bg-card px-4 py-3.5" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Keyed on the text, so each new "Next:" stop fades in as the bus moves on. */}
          <h2 key={headline} className="fade-in text-lg leading-tight font-bold">
            {headline}
          </h2>
          {detail && <p className="mt-0.5 text-sm text-ink-soft">{detail}</p>}
        </div>
        {delaySec != null && phase === 'running' && <DelayChip sec={delaySec} />}
      </div>
      <SourceBadge source={source} bus={bus} method={method} accuracy={accuracy} words={words} />
      {journey.offSchedule && (
        <p className="mt-1 text-xs text-ink-soft">Times use the {words.bus}'s live position and this route's usual travel times.</p>
      )}
    </section>
  )
}

function DelayChip({ sec }) {
  const min = Math.round(sec / 60)
  const onTime = Math.abs(min) < 2
  const text = onTime ? 'On time' : min > 0 ? `${formatDuration(min)} late` : `${formatDuration(-min)} early`
  return (
    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold text-white ${onTime || min < 0 ? 'bg-ontime' : 'bg-late'}`}>
      {text}
    </span>
  )
}

function formatAccuracy(metres) {
  return metres < 1000 ? `${Math.round(metres / 10) * 10 || 10} m` : `${(metres / 1000).toFixed(1)} km`
}

/**
 * Says where a live position comes from. Nothing shows for a timetable estimate, and riders' positions
 * never say how many people are sharing.
 */
function SourceBadge({ source, bus, method, accuracy, words }) {
  if (source === 'timetable') return null
  const text = {
    gps: "Live from your phone's GPS",
    cell:
      method === 'tower'
        ? 'Live from nearby cell towers, approximate'
        : canReadTowers()
          ? "Live from network location, as these towers aren't mapped yet"
          : 'Live from network location, approximate',
    bus: `Live from bus GPS · ${bus?.plate} · ${formatAge(bus?.ageSec ?? 0)}`,
    riders: `Live from riders on this ${words.bus}`,
  }[source]
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
      <span className="live-dot size-2 shrink-0 rounded-full bg-ontime" />
      <span className="text-ontime">
        {text}
        {(source === 'gps' || source === 'cell') && accuracy != null && ` (to about ${formatAccuracy(accuracy)})`}
      </span>
    </p>
  )
}

/** Asks the server which real buses are on this route, as long as the page is showing it. */
/**
 * Asks the server which real buses are on this route, as long as the page is showing it. Also notes
 * when each bus is seen passing a stop, which gives real passing times for stops it reaches while
 * the page is open.
 *
 * @returns {buses, passings}. passings maps a registration number to {stop index: seconds since midnight}.
 */
function useLiveBuses(feedId, serviceId, refreshCount, service) {
  const [buses, setBuses] = useState([])
  // Whether the first answer has come back, so the page knows if a live bus is there before drawing.
  const [checked, setChecked] = useState(false)
  const [passings, setPassings] = useState({})
  const lastKm = useRef({})

  const notePassings = useEffectEvent((fresh) => {
    if (!service) return
    const now = secondsNow(service.timezone)
    const seenAtMs = Date.now()
    const seen = {}
    const restarted = []
    for (const b of fresh) {
      const prev = lastKm.current[b.plate]
      lastKm.current[b.plate] = { km: b.km, at: seenAtMs }
      if (prev == null) continue
      const before = prev.km
      // Further than a bus could go since the last sighting means the position jumped (GPS matched
      // to the wrong part of the route), so nothing in between was really passed at this moment.
      const possibleKm = (MAX_BUS_KMH * (seenAtMs - prev.at)) / 3_600_000 + JUMP_ALLOWANCE_KM
      // A big step back means the bus has started a new run, so its old passing times no longer apply.
      if (b.km < before - RESTART_KM) restarted.push(b.plate)
      else if (b.km > before && b.km - before <= possibleKm) {
        service.stops.forEach((s, i) => {
          if (s.km > before && s.km <= b.km) (seen[b.plate] ??= {})[i] = now
        })
      }
    }
    if (restarted.length === 0 && Object.keys(seen).length === 0) return
    setPassings((old) => {
      const next = { ...old }
      restarted.forEach((plate) => delete next[plate])
      // The first sighting past a stop is kept, so GPS wobble can't move it later.
      Object.entries(seen).forEach(([plate, stops]) => (next[plate] = { ...stops, ...next[plate] }))
      return next
    })
  })

  useEffect(() => {
    const poll = async () => {
      try {
        const fresh = await api.liveBuses(feedId, serviceId)
        setBuses(fresh)
        setChecked(true)
        notePassings(fresh)
      } catch {
        // Riders and the timetable still show, so this needn't interrupt anyone.
        setBuses([])
        setChecked(true)
      }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [feedId, serviceId, refreshCount])
  return { buses, passings, checked }
}

/** Asks the server for rider positions on this trip, as long as the page is showing it. */
function useLivePolling(feedId, tripId, mode, refreshCount) {
  const [live, setLive] = useState(null)
  useEffect(() => {
    if (!tripId) return undefined
    const poll = async () => {
      try {
        setLive(await api.live(feedId, tripId))
      } catch {
        // Tracking from the phone doesn't need this, and the timetable still shows otherwise.
        setLive(null)
      }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [feedId, tripId, mode, refreshCount])
  return live
}

function useSharing({ feedId, tripId, mode, enabled, fixRef }) {
  useEffect(() => {
    if (!enabled || mode === 'off' || !tripId || !RIDER_ID) return undefined
    const send = () => {
      const fix = fixRef.current
      if (fix) {
        // A failed report only means others see this bus a little less often.
        api.report(feedId, tripId, { riderId: RIDER_ID, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, source: mode }).catch(() => {})
        // A GPS position beside the connected tower is how the tower map grows.
        if (mode === 'gps' && canReadTowers()) {
          readCells().then((cells) => api.learnCells(cells, fix)).catch(() => {})
        }
      }
    }
    send()
    const id = setInterval(send, SHARE_EVERY_MS)
    return () => clearInterval(id)
  }, [enabled, mode, tripId, feedId, fixRef])
}
