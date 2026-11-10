import { useEffect, useState } from 'react'
import { useStopAlarm } from '../lib/alarm.js'
import { api } from '../lib/api.js'
import { useData, useTick, useWakeLock } from '../lib/hooks.js'
import { describeJourney } from '../lib/journey.js'
import { formatAge, formatClock, formatDuration, secondsNow } from '../lib/time.js'
import { isMetro, lineColours, wordsFor } from '../lib/words.js'
import JourneyView from './JourneyView.jsx'
import { AlarmBanner, AlarmNote } from './StopAlarm.jsx'
import { ErrorMessage, Message, ServicePlate } from './ui.jsx'

const POLL_MS = 15_000
// An older position is more misleading than the timetable, so past this the timetable takes over.
const STALE_SEC = 30 * 60
const CACHE_TIMETABLE_MS = 12 * 3600 * 1000

/** Polls a share link. Keeps the last answer through a dropped connection. */
function useShare(token) {
  const [state, setState] = useState({})
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      try {
        const view = await api.share(token)
        if (!stopped) setState({ view })
      } catch (error) {
        if (!stopped) setState((s) => ({ ...s, error }))
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [token])
  return state
}

/**
 * What family see when they open a share link: the rider's bus moving along its route, from the
 * rider's phone. Needs no app or sign-in, and shows the timetable when the phone goes quiet.
 */
export default function FamilyScreen({ token, feeds }) {
  useTick(15_000)
  const { view, error } = useShare(token)
  const feed = view?.feed
  const { data: service, error: serviceError } = useData(feed && `svc|${feed}|${view.serviceId}`, (signal) => api.service(feed, view.serviceId, signal), { cacheMs: CACHE_TIMETABLE_MS })
  const { data: trip, error: tripError } = useData(feed && `trip|${feed}|${view.tripId}`, (signal) => api.trip(feed, view.tripId, signal), { cacheMs: CACHE_TIMETABLE_MS })

  const nowSec = secondsNow(service?.timezone ?? 'Asia/Kolkata')
  const feedInfo = feeds?.find((f) => f.id === feed)
  const words = wordsFor(feedInfo)
  const metro = isMetro(feedInfo)
  const timetabled = service?.timetabled !== false
  const fresh = view && !view.ended && view.km != null && view.ageSec <= STALE_SEC
  const journey =
    service && trip?.tripId === view?.tripId
      ? describeJourney({ stops: service.stops, trip, nowSec, phoneKm: null, bus: null, live: fresh ? { riders: 1, km: view.km } : null, mode: 'off', timetabled })
      : null
  const stopAlarm = useStopAlarm(service?.stops, journey)
  useWakeLock(stopAlarm.alarm != null)

  if (!view) {
    return (
      <>
        <Header />
        {error ? (
          <ErrorMessage
            title="This link has ended"
            error={{ message: 'Sharing was stopped or the link has expired. Ask them to send a new one.' }}
          />
        ) : (
          <Message title="Opening shared journey…" />
        )}
      </>
    )
  }
  if ((serviceError && !service) || (tripError && !trip)) {
    return (
      <>
        <Header />
        <ErrorMessage title={`We couldn't load this ${words.bus}`} error={serviceError ?? tripError} />
      </>
    )
  }
  if (!journey) {
    return (
      <>
        <Header />
        <Message title={`Loading ${words.bus}…`} />
      </>
    )
  }

  return (
    <div style={metro ? lineColours(service.color) : undefined}>
      <div className="sticky top-0 z-30 shadow-md">
        <Header>
          {metro && <ServicePlate metro service={service} />}
          <div className="min-w-0 text-sm leading-tight">
            <div className="truncate font-semibold">
              {words.Bus} to {service.to}
            </div>
            <div className="truncate text-xs text-paper/70">
              from {service.from}
              {timetabled && ` · left at ${formatClock(trip.startSec)}`}
            </div>
          </div>
        </Header>
      </div>
      <main className="pb-24">
        {stopAlarm.firing && <AlarmBanner stop={service.stops[stopAlarm.alarm]} onDismiss={stopAlarm.dismiss} />}
        <SharedStatus service={service} journey={journey} view={view} fresh={fresh} nowSec={nowSec} words={words} />
        {stopAlarm.alarm != null && !stopAlarm.firing && (
          <AlarmNote
            stop={service.stops[stopAlarm.alarm]}
            alarmKm={stopAlarm.alarmKm}
            onChangeKm={stopAlarm.setAlarmKm}
            remainingKm={stopAlarm.remainingKm}
            estimated={journey.source === 'timetable'}
            estimateHint={
              timetabled
                ? "Their phone isn't sending a position right now, so this uses the timetable and may ring early or late."
                : "Their phone isn't sending a position right now, and this line has no timetable, so the alarm waits for it."
            }
          />
        )}
        <JourneyView
          stopsLabel={words.Stops}
          lineColor={metro ? service.color : null}
          defaultView="map"
          storageKey="wimb.familyView"
          stops={service.stops}
          trip={trip}
          journey={journey}
          alarmIndex={stopAlarm.alarm}
          onToggleAlarm={stopAlarm.toggle}
        />
        <p className="px-4 pt-4 text-xs text-ink-soft">
          Tap the bell next to a {words.stop} in the {words.Stops} list to get an alarm when the {words.bus} is near it, for example to pick
          them up.
        </p>
      </main>
    </div>
  )
}

function Header({ children }) {
  return (
    <header className="app-header flex items-center gap-2 px-4 py-2.5 text-paper">
      {children ?? <span className="font-semibold">Where Is My Bus</span>}
    </header>
  )
}

function SharedStatus({ service, journey, view, fresh, nowSec, words }) {
  const { phase, last, eta, delaySec, startsInSec } = journey
  const stops = service.stops
  const next = stops[last + 1]
  const clock = journey.clock ?? nowSec

  let headline
  let detail = null
  if (phase === 'unknown') {
    headline = `Waiting for their position`
  } else if (phase === 'not-started') {
    headline = `Departs in ${formatDuration(startsInSec / 60)}`
  } else if (phase === 'finished') {
    headline = `Reached ${stops[stops.length - 1].name}`
  } else {
    headline = next ? `Next: ${next.name}` : stops[last].name
    if (next && eta[last + 1] != null) {
      const minutes = Math.max(0, Math.round((eta[last + 1] - clock) / 60))
      detail = `${minutes === 0 ? 'Due now' : `In about ${formatDuration(minutes)}`} · ${formatClock(eta[last + 1])}`
    }
  }

  // A line with no timetable has nothing to fall back on, so say so instead of "showing the timetable".
  const fallback = journey.untimed ? `This line has no timetable, so the ${words.bus}'s position isn't known.` : 'Showing the timetable.'
  let source
  if (view.ended) source = `They've stopped sharing. ${fallback}`
  else if (view.km == null) source = `Waiting for their phone's first position. ${fallback}`
  else if (!fresh) source = `No update for ${formatAge(view.ageSec)}: their phone may have lost signal. ${fallback}`
  else source = `Live from their phone · updated ${formatAge(view.ageSec)}`

  const late = delaySec != null && phase === 'running' && Math.abs(delaySec) >= 120
  return (
    <section className="border-b border-line bg-card px-4 py-3.5" aria-live="polite">
      <h2 key={headline} className="fade-in text-lg leading-tight font-bold">
        {headline}
      </h2>
      {detail && <p className="mt-0.5 text-sm text-ink-soft">{detail}</p>}
      {late && (
        <p className={`mt-0.5 text-sm font-semibold ${delaySec > 0 ? 'text-late' : 'text-ontime'}`}>
          {formatDuration(Math.round(Math.abs(delaySec) / 60))} {delaySec > 0 ? 'late' : 'early'}
        </p>
      )}
      <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${fresh ? 'text-ontime' : 'text-ink-soft'}`}>
        <span className={`size-2 shrink-0 rounded-full ${fresh ? 'live-dot bg-ontime' : 'bg-ink-soft/50'}`} />
        {source}
      </p>
    </section>
  )
}
