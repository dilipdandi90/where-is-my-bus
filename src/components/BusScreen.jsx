import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { canReadTowers, readCells } from '../lib/cells.js'
import { useData, usePhonePosition, useTick, useWakeLock } from '../lib/hooks.js'
import { assignBuses, defaultDeparture, departureWithBus, describeJourney } from '../lib/journey.js'
import { formatAge, formatClock, formatDuration, formatKm, secondsNow } from '../lib/time.js'
import { nearestDeparture } from '../lib/tracker.js'
import DeparturePicker from './DeparturePicker.jsx'
import FeedNotice from './FeedNotice.jsx'
import LiveBuses from './LiveBuses.jsx'
import Timeline from './Timeline.jsx'
import { ErrorMessage, Message, NumberPlate, ReloadIcon } from './ui.jsx'

const LIVE_POLL_MS = 15_000
const SHARE_EVERY_MS = 15_000
const ALARM_KM = 1
const ALARM_SECONDS = 180
// A random ID for this visit only, so one rider's reports count once.
const RIDER_ID = globalThis.crypto?.randomUUID?.() ?? null

const NOT_ON_BUS_HINT = "Showing where the bus is from its GPS or riders on board if available, otherwise it's estimated from the timetable."
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

export default function BusScreen({ feedId, feed, serviceId }) {
  useTick(15_000)
  // Always starts off, so opening a bus never uses location until the rider chooses to.
  const [onBus, setOnBus] = useState(false)
  const [trackBy, setTrackBy] = useState(null)
  const mode = onBus && trackBy ? trackBy : 'off'
  const [refreshCount, setRefreshCount] = useState(0)
  const [pickedTripId, setPickedTripId] = useState(null)
  const [matchedTripId, setMatchedTripId] = useState(null)

  const { data: service, error: serviceError, retry: retryService, refreshing: serviceRefreshing } = useData(`${feedId}|${serviceId}`, (signal) => api.service(feedId, serviceId, signal))

  const nowSec = secondsNow(service?.timezone ?? 'Asia/Kolkata')

  // When a rider starts tracking, work out which departure they're on, unless they've picked one.
  const { position, method, error: locationError, tooVague, accuracy, fixRef } = usePhonePosition(service?.stops, mode, usualSpeed(service), (km) => {
    const match = nearestDeparture(service.departures, service.km, km, nowSec)
    if (match) setMatchedTripId(match.departure.tripId)
  })
  useWakeLock(mode !== 'off')

  const buses = useLiveBuses(feedId, serviceId, refreshCount)
  const [followedPlate, setFollowedPlate] = useState(null)
  const assigned = service ? assignBuses(buses, service.departures, service.km, nowSec) : new Map()

  const fallback = service ? defaultDeparture(service.departures, nowSec) : null
  // With no choice made, show a departure that has a real bus on it, if the usual one doesn't.
  const withBus = !fallback || assigned.has(fallback.tripId) ? null : departureWithBus(service.departures, assigned, nowSec)?.tripId
  const tripId = pickedTripId ?? (mode !== 'off' ? matchedTripId : null) ?? withBus ?? fallback?.tripId ?? null
  const { data: trip, error: tripError, retry: retryTrip, refreshing: tripRefreshing } = useData(tripId && `${feedId}|${tripId}`, (signal) => api.trip(feedId, tripId, signal))

  const live = useLivePolling(feedId, tripId, mode, refreshCount)
  const [sharing, setSharing] = useState(false)
  useSharing({ feedId, tripId, mode, enabled: sharing, fixRef })

  const phoneKm = position?.onRoute ? position.km : null
  const followed = buses.find((b) => b.plate === followedPlate)
  const bus = followed ?? assigned.get(tripId) ?? null
  const journey =
    service && trip?.tripId === tripId
      ? describeJourney({ stops: service.stops, trip, nowSec, phoneKm, bus, live, mode })
      : null

  const { alarm, firing, toggle: toggleAlarm, dismiss: dismissAlarm } = useStopAlarm(service?.stops, journey, nowSec)

  const refresh = () => {
    retryService()
    retryTrip()
    setRefreshCount((c) => c + 1)
  }

  if (serviceError && !service) {
    return (
      <>
        <TopBar />
        <ErrorMessage title="We couldn't open this bus" error={serviceError} onRetry={retryService} />
      </>
    )
  }
  if (!service) {
    return (
      <>
        <TopBar />
        <Message title="Loading bus…" />
      </>
    )
  }

  return (
    <>
      <div className="sticky top-0 z-30 shadow-md">
        <TopBar>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {feed && !feed.numbersAreCodes && <NumberPlate number={service.number} large />}
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
          onBus={onBus}
          trackBy={trackBy}
          onChangeOnBus={(next) => {
            setOnBus(next)
            // Asked again each time, because the better choice depends on the phone's signal now.
            setTrackBy(null)
          }}
          onChangeTrackBy={setTrackBy}
        />
      </div>

      {(!onBus || trackBy) && (
        <p className="border-b border-line bg-card px-4 py-2 text-xs text-ink-soft">
          {onBus ? TRACKING_OPTIONS.find((o) => o.id === trackBy).hint : NOT_ON_BUS_HINT}
        </p>
      )}

      {service.departures.length === 0 ? (
        <Message title="No departures listed today">This feed doesn't show this bus running today.</Message>
      ) : (
        // The bottom padding keeps the last stop and its alert bell clear of the refresh button.
        <main className="pb-24">
          {firing && (
            <div role="alert" className="flex items-center gap-3 bg-late px-4 py-3 font-semibold text-white">
              <p className="flex-1">{service.stops[alarm].name} is coming up. Get ready!</p>
              <button onClick={dismissAlarm} className="rounded-md bg-white/20 px-3 py-1.5 text-sm">
                OK
              </button>
            </div>
          )}

          <LocationStatus mode={mode} error={locationError} tooVague={tooVague} accuracy={accuracy} position={position} />
          {journey && <StatusCard service={service} journey={journey} live={live} bus={bus} method={method} accuracy={accuracy} nowSec={nowSec} />}

          <DeparturePicker
            departures={service.departures}
            selectedId={tripId}
            nowSec={nowSec}
            onSelect={(id) => {
              setPickedTripId(id)
              setFollowedPlate(null)
            }}
          />
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

          {mode !== 'off' && (
            <label className="flex items-start gap-3 border-b border-line px-4 py-3 text-sm">
              <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} className="mt-0.5 size-5 accent-ink" />
              <span>
                <span className="font-semibold">Help others waiting for this bus</span>
                <span className="block text-xs text-ink-soft">
                  {canReadTowers()
                    ? "Anonymously shares how far along the route the bus is, and helps map cell towers, only while this is on. Nothing is tied to you."
                    : "Anonymously shares how far along the route the bus is, only while this is on. Your exact location isn't stored."}
                </span>
              </span>
            </label>
          )}

          {tripError && !journey && <ErrorMessage title="We couldn't load this departure" error={tripError} onRetry={retryTrip} />}
          {!journey && !tripError && <Message title="Loading stops…" />}
          {journey && (
            <div className="pt-1">
              {alarm != null && !firing && (
                <p className="mx-4 mt-2 rounded-xl bg-tint px-3 py-2 text-xs">
                  We'll alert you before <span className="font-semibold">{service.stops[alarm].name}</span>. Keep this page open.
                </p>
              )}
              <Timeline stops={service.stops} trip={trip} journey={journey} alarmIndex={alarm} onToggleAlarm={toggleAlarm} />
            </div>
          )}

          {feed && (
            <footer className="border-t border-line px-4 py-3">
              <FeedNotice feed={feed} />
            </footer>
          )}
        </main>
      )}

      <RefreshButton onClick={refresh} refreshing={serviceRefreshing || tripRefreshing} />
    </>
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
function RefreshButton({ onClick, refreshing }) {
  return (
    <button
      onClick={onClick}
      disabled={refreshing}
      aria-label="Refresh this bus"
      title="Refresh"
      className="fixed right-[max(1.25rem,calc((100vw-36rem)/2+1.25rem))] bottom-5 z-20 flex size-14 items-center justify-center rounded-full bg-ink text-paper shadow-lg"
    >
      <ReloadIcon className={`size-6 ${refreshing ? 'animate-spin' : ''}`} />
    </button>
  )
}

/** "Are you on this bus?", then how to track it. Location is only used once both are answered. */
function TrackingControls({ onBus, trackBy, onChangeOnBus, onChangeTrackBy }) {
  return (
    <div className="bg-card px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span id="on-bus-label" className="font-semibold">
          I'm on this bus
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
          {!trackBy && <p className="mb-1.5 text-sm text-ink-soft">How should we track your bus?</p>}
          <div role="radiogroup" aria-label="How to track your bus" className="grid grid-cols-2 gap-2">
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
function LocationStatus({ mode, error, tooVague, accuracy, position }) {
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
    message = `You're about ${formatKm(position.offRouteKm)} from this route, so we're not using your location. Are you on this bus?`
  } else if (!position && !error) {
    message = 'Finding your location…'
  }
  return message && <p className="border-b border-line bg-tint px-4 py-2.5 text-sm">{message}</p>
}

function StatusCard({ service, journey, live, bus, method, accuracy, nowSec }) {
  const { phase, source, last, delaySec, eta, startsInSec } = journey
  const stops = service.stops
  const next = stops[last + 1]
  const nextInMin = next ? Math.max(0, Math.round((eta[last + 1] - (journey.clock ?? nowSec)) / 60)) : null

  let headline
  let detail
  if (phase === 'not-started') {
    headline = `Departs in ${formatDuration(startsInSec / 60)}`
    detail = `From ${stops[0].name} at ${formatClock(eta[0])}`
  } else if (phase === 'finished') {
    headline = `Reached ${stops[stops.length - 1].name}`
    detail = source === 'timetable' ? 'According to the timetable' : null
  } else {
    headline = next ? `Next: ${next.name}` : stops[last].name
    detail = next && `${nextInMin === 0 ? 'Due now' : `In about ${formatDuration(nextInMin)}`} · ${formatClock(eta[last + 1])}`
  }

  return (
    <section className="border-b border-line bg-card px-4 py-3.5" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-bold">{headline}</h2>
          {detail && <p className="mt-0.5 text-sm text-ink-soft">{detail}</p>}
        </div>
        {delaySec != null && phase === 'running' && <DelayChip sec={delaySec} />}
      </div>
      <SourceBadge source={source} live={live} bus={bus} method={method} accuracy={accuracy} />
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

function SourceBadge({ source, live, bus, method, accuracy }) {
  const isLive = source !== 'timetable'
  const text = {
    gps: "Live from your phone's GPS",
    cell:
      method === 'tower'
        ? 'Live from nearby cell towers, approximate'
        : canReadTowers()
          ? "Live from network location, as these towers aren't mapped yet"
          : 'Live from network location, approximate',
    bus: `Live from bus GPS · ${bus?.plate} · ${formatAge(bus?.ageSec ?? 0)}`,
    riders: `Live from ${live?.riders} ${live?.riders === 1 ? 'rider' : 'riders'} on this bus`,
    timetable: 'Estimate from the timetable, not live. Nobody on this bus is sharing yet.',
  }[source]
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
      <span className={`size-2 shrink-0 rounded-full ${isLive ? 'bg-ontime' : 'bg-ink-soft/50'}`} />
      <span className={isLive ? 'text-ontime' : 'text-ink-soft'}>
        {text}
        {(source === 'gps' || source === 'cell') && accuracy != null && ` (to about ${formatAccuracy(accuracy)})`}
      </span>
    </p>
  )
}

/** Asks the server which real buses are on this route, as long as the page is showing it. */
function useLiveBuses(feedId, serviceId, refreshCount) {
  const [buses, setBuses] = useState([])
  useEffect(() => {
    const poll = async () => {
      try {
        setBuses(await api.liveBuses(feedId, serviceId))
      } catch {
        // Riders and the timetable still show, so this needn't interrupt anyone.
        setBuses([])
      }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [feedId, serviceId, refreshCount])
  return buses
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

/**
 * Alerts when the bus nears a chosen stop, until dismissed. Sound needs a tap to allow it, which
 * choosing the stop provides.
 *
 * @returns {alarm, firing, toggle, dismiss}
 */
function useStopAlarm(stops, journey, nowSec) {
  const [alarm, setAlarm] = useState(null)
  const audio = useRef(null)

  const toggle = (index) => {
    setAlarm(alarm === index ? null : index)
    if (!audio.current) {
      const Context = window.AudioContext ?? window.webkitAudioContext
      if (Context) audio.current = new Context()
    }
    audio.current?.resume()
  }

  const firing =
    alarm != null &&
    journey != null &&
    journey.phase !== 'not-started' &&
    (alarm <= journey.last ||
      stops[alarm].km - journey.km <= ALARM_KM ||
      journey.eta[alarm] - (journey.clock ?? nowSec) <= ALARM_SECONDS)

  useEffect(() => {
    if (firing) {
      navigator.vibrate?.([400, 200, 400, 200, 400])
      if (audio.current) beep(audio.current)
    }
  }, [firing])

  return { alarm, firing, toggle, dismiss: () => setAlarm(null) }
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
