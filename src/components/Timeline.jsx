import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatClock, formatDistance, formatDuration, formatKm } from '../lib/time.js'
import { AT_STOP_KM, journeyDay, nextStopInfo } from '../lib/journey.js'
import { BellIcon, BusIcon, PlatformChip, TrainIcon } from './ui.jsx'

// Up to this far behind schedule still counts as on time, as on the status card.
const LATE_FROM_SEC = 120
// Long enough for the stops to start appearing before the page glides down to the bus.
const SCROLL_DELAY_MS = 350
// Each stop fades in a moment after the one above, up to this delay so long routes don't drag.
const STAGGER_MS = 25
const MAX_STAGGER_MS = 500

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
// Middle of the dot column: the 5rem time column plus half the 2rem dot column.
const RAIL_X = 80 + 16

/**
 * How far down the list the bus is, in pixels: between the two dots either side of it (stops, and
 * stations passed without stopping when they're shown), in proportion to how far along it really is.
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

/**
 * The route from top to bottom, with the bus marked between the stops it's travelling between. Each
 * stop shows its scheduled time and, when the bus is live, the actual or expected time: green when on
 * time or early, red when late.
 *
 * @param passedAt {stop index: seconds since midnight} for stops the bus was seen passing on live GPS.
 *        These are real, so they're shown in preference to anything worked out.
 */
/** @param train draw a train rather than a bus, for metro lines */
/** @param showDays label stops reached a day or two into the journey ("Day 2"), for long trains */
/** @param passing stations a train goes through without stopping, shown when its stop is tapped */
export default function Timeline({ stops, trip, journey, passedAt = {}, alarmIndex, onToggleAlarm, train = false, showDays = false, passing }) {
  const markerRef = useRef(null)
  const hasScrolled = useRef(false)
  const trackRef = useRef(null)
  const dotRefs = useRef([])
  const passDotRefs = useRef({})
  const [points, setPoints] = useState([])
  // Stops whose stations passed without stopping are shown, by index.
  const [open, setOpen] = useState(() => new Set())
  const { last, phase, source, km } = journey
  const byStop = passingByStop(passing)
  const passingCount = passing?.length ?? 0
  const allOpen = passingCount > 0 && Object.keys(byStop).every((i) => open.has(Number(i)))
  const toggle = (i) =>
    setOpen((old) => {
      const next = new Set(old)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  // Where each stop's dot sits, measured again whenever the list changes size (fonts loading,
  // rotating the phone, text wrapping differently).
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const measure = () => {
      const top = track.getBoundingClientRect().top
      const y = (dot) => {
        const r = dot?.getBoundingClientRect()
        return r ? r.top + r.height / 2 - top : 0
      }
      const stopY = stops.map((_, i) => y(dotRefs.current[i]))
      const next = []
      stops.forEach((stop, i) => {
        next.push({ km: stop.km, y: stopY[i], stop: true })
        if (!open.has(i)) return
        // While a list is opening or closing, only the stations already showing between the two
        // stops count.
        for (const [k, dot] of Object.entries(passDotRefs.current[i] ?? {})) {
          const at = dot ? y(dot) : null
          if (at != null && at > stopY[i] && at < (stopY[i + 1] ?? Infinity)) next.push({ km: Number(k), y: at, stop: false })
        }
      })
      setPoints(next.sort((a, b) => a.km - b.km))
    }
    // Calls measure once straight away, then on every resize.
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [stops, open])

  const measured = points.filter((p) => p.stop).length === stops.length && stops.length > 1
  const firstY = measured ? points[0].y : 0
  const lastY = measured ? points[points.length - 1].y : 0
  const busY = measured ? busOffset({ points, km, last, phase }) : 0
  const nextStop = phase === 'running' ? nextStopInfo(stops, km, last) : null

  // Glides to the bus once, as soon as its marker exists. That can be after the first render, as
  // live positions arrive a moment after the timetable.
  useEffect(() => {
    if (hasScrolled.current || !markerRef.current || phase !== 'running') return undefined
    hasScrolled.current = true
    const id = setTimeout(() => {
      markerRef.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }, SCROLL_DELAY_MS)
    return () => clearTimeout(id)
    // measured: the marker only renders once the dots have been measured, after the first render.
  }, [phase, last, measured])

  return (
    // The track, the orange progress line and the bus sit on top of the stops, placed by measuring
    // where each stop's dot is, so the bus can stand anywhere between two stops and glide as it moves.
    <div ref={trackRef} className="relative pb-4">
      {measured && (
        <>
          <span aria-hidden="true" className="absolute w-1.5 rounded-full bg-line" style={{ left: RAIL_X - 3, top: firstY, height: lastY - firstY }} />
          {/* Draws down from the first stop when the page opens, then follows the bus. */}
          <span
            // A new source (live bus appearing or dropping out) redraws the line from the top rather
            // than sliding it backwards or forwards from the old position.
            key={`${source}-${phase}`}
            aria-hidden="true"
            className="rail-grow track-move absolute w-1.5 rounded-full bg-road"
            style={{ left: RAIL_X - 3, top: firstY, height: Math.max(0, busY - firstY) }}
          />
        </>
      )}
      {/* Waits at the first stop before it leaves; a train also keeps its icon at the destination once it has arrived. */}
      {measured && (phase === 'running' || phase === 'not-started' || (showDays && phase === 'finished')) && (
        <div
          key={source}
          ref={markerRef}
          className="track-move pointer-events-none absolute z-10 flex items-center gap-2"
          style={{ left: RAIL_X - 14, top: busY - 14 }}
        >
          <BusMarker estimated={source === 'timetable' || source === 'lastSeen'} train={train} />
          {nextStop && (
            // Solid and raised, so it stays readable as it passes over the stop names.
            <span className="max-w-56 truncate rounded-lg border border-line bg-card px-2 py-1 text-xs whitespace-nowrap shadow-md">
              {nextStop.distanceKm != null && <span className="font-bold text-ink">{formatDistance(nextStop.distanceKm)}</span>}
              <span className="text-ink-soft">{nextStop.distanceKm != null ? ' to ' : 'At '}</span>
              <span className="font-semibold text-ink">{nextStop.name}</span>
              {/* Trains often run late, so a timetable position is labelled as one. */}
              {showDays && source === 'timetable' && <span className="text-ink-soft"> · as per timetable</span>}
              {source === 'lastSeen' && <span className="text-ink-soft"> · estimated</span>}
            </span>
          )}
          {phase === 'not-started' && journey.startsInSec != null && (
            <span className="max-w-56 truncate rounded-lg border border-line bg-card px-2 py-1 text-xs whitespace-nowrap shadow-md">
              <span className="text-ink-soft">Departs in </span>
              <span className="font-bold text-ink">{formatDuration(journey.startsInSec / 60)}</span>
              {journey.delaySec >= LATE_FROM_SEC && <span className="font-semibold text-late"> · {delayText(journey.delaySec)}</span>}
            </span>
          )}
        </div>
      )}
      {passingCount > 0 && (
        <div className="flex justify-end px-4 pb-1">
          <button
            onClick={() => setOpen(allOpen ? new Set() : new Set(Object.keys(byStop).map(Number)))}
            className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft"
          >
            {allOpen ? 'Show stops only' : `Show all ${passingCount + stops.length} stations`}
          </button>
        </div>
      )}
    <ol>
      {stops.map((stop, i) => {
        const passed = i <= last
        const isLast = i === stops.length - 1
        const atStop = phase === 'running' && i === last && km - stop.km < AT_STOP_KM
        const times = stopTimes({ i, passed, trip, journey, passedAt })
        const day = showDays ? journeyDay(trip, i) : 0
        const newDay = showDays && day > 0 && (i === 0 || journeyDay(trip, i - 1) !== day)
        const through = byStop[i] ?? []
        const isOpen = open.has(i)
        // Trains, as in the railway timetable: arrival on the left (departure at the first station),
        // departure on the right (none at the last).
        const timed = trip && !journey.offSchedule && !journey.untimed
        const arrives = showDays && timed ? trip.startSec + (i === 0 ? trip.offsets[0] : (trip.arrivals?.[i] ?? trip.offsets[i])) : null
        const leaves = showDays && timed && !isLast ? trip.startSec + trip.offsets[i] : null

        return (
          <li key={`${stop.id}-${i}`} className="stop-in" style={{ animationDelay: `${Math.min(i * STAGGER_MS, MAX_STAGGER_MS)}ms` }}>
            <div className="flex items-stretch">
              <div className="flex w-20 shrink-0 flex-col justify-center py-2.5 pr-2 text-right text-xs leading-tight">
                {newDay && <div className="mb-0.5 font-bold text-road-dark">Day {day + 1}</div>}
                {(arrives ?? times.scheduled) != null && <div className="text-ink-soft">{formatClock(arrives ?? times.scheduled)}</div>}
                {times.actual != null ? (
                  <div className={`mt-0.5 text-[13px] font-bold ${toneClass(times.delay)}`}>{formatClock(times.actual)}</div>
                ) : (
                  // A line with no timetable has no times at all, so a dash on every station would be noise.
                  times.scheduled == null && !journey.untimed && <div className="text-ink-soft">—</div>
                )}
              </div>

              <div className="relative flex w-8 shrink-0 items-center justify-center">
                <span
                  ref={(el) => (dotRefs.current[i] = el)}
                  className={`relative z-5 size-3 rounded-full border-2 transition-colors duration-500 ${passed ? 'border-road-dark bg-road' : 'border-ink-soft bg-card'}`}
                />
              </div>

              <div className={`flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-2 ${passed && !atStop ? 'text-ink-soft' : ''}`}>
                <div
                  className={`min-w-0 flex-1 ${through.length ? 'cursor-pointer' : ''}`}
                  onClick={through.length ? () => toggle(i) : undefined}
                  role={through.length ? 'button' : undefined}
                  aria-expanded={through.length ? isOpen : undefined}
                >
                  <div className={`text-sm leading-snug ${atStop ? 'font-bold' : i === 0 || isLast ? 'font-semibold' : ''}`}>{stop.name}
                    <PlatformChip platform={stop.platform} />
                  </div>
                  <div className="text-xs text-ink-soft">
                    {formatKm(stop.km)}
                    {showDays && stopStatus({ i, passed, atStop, isLast, phase }) && (
                      <span className="font-semibold text-ink"> · {stopStatus({ i, passed, atStop, isLast, phase })}</span>
                    )}
                    {times.delay != null && <span className={`font-semibold ${toneClass(times.delay)}`}> · {delayText(times.delay)}</span>}
                  </div>
                </div>
                {leaves != null && <div className="shrink-0 text-right text-xs text-ink-soft">{formatClock(leaves)}</div>}
                {passed ? (
                  // Keeps the bell's place, so departure times stay in line once a station is passed.
                  showDays && <span aria-hidden="true" className="size-10 shrink-0" />
                ) : (
                  <button
                    onClick={() => onToggleAlarm(i)}
                    aria-pressed={alarmIndex === i}
                    aria-label={`${alarmIndex === i ? 'Cancel alert for' : 'Alert me before'} ${stop.name}`}
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ${alarmIndex === i ? 'bg-road-dark text-white' : 'text-ink-soft/60'}`}
                  >
                    <BellIcon filled={alarmIndex === i} />
                  </button>
                )}
              </div>
            </div>
            {/* Always there, so it can slide open and closed: its height grows from nothing to its
                full size, and each station fades in a moment after the one above. */}
            {through.length > 0 && (
              <div
                inert={!isOpen}
                aria-hidden={!isOpen}
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              >
              <ul aria-label={`Stations passed after ${stop.name}`} className="min-h-0 overflow-hidden">
                {through.map((p, k) => {
                  const gone = phase === 'finished' || (phase === 'running' && km >= p.km)
                  const at = journey.offSchedule || journey.untimed ? null : passingSec(trip, i, p, stops)
                  const expected = at != null ? expectedAt(at, i, trip, journey) : null
                  return (
                    <li
                      key={`${p.code}-${p.km}`}
                      className={`flex min-h-11 items-stretch transition duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}
                      style={{ transitionDelay: isOpen ? `${Math.min(k * 30, 300)}ms` : '0ms' }}
                    >
                      {/* A grey band behind the time and name (not the line) marks stations the train doesn't stop at. */}
                      <div className="flex w-20 shrink-0 flex-col justify-center bg-line/70 py-2.5 pr-2 text-right text-[11px] leading-tight text-ink-soft">
                        {at != null && <div>~{formatClock(at)}</div>}
                        {expected != null && <div className={`font-semibold ${toneClass(expected - at)}`}>{formatClock(expected)}</div>}
                      </div>
                      <div className="relative flex w-8 shrink-0 items-center justify-center">
                        <span
                          ref={(el) => ((passDotRefs.current[i] ??= {})[p.km] = el)}
                          className={`relative z-5 size-2 rounded-full ${gone ? 'bg-road' : 'border border-ink-soft bg-card'}`}
                        />
                      </div>
                      <div className={`flex min-w-0 flex-1 items-center bg-line/70 py-2.5 pl-2 text-[13px] ${gone ? 'text-ink-soft' : 'text-ink'}`}>
                        <span className="min-w-0 truncate">
                          {p.name}
                          <span className="text-ink-soft"> · {formatKm(p.km)}</span>
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              </div>
            )}

          </li>
        )
      })}
    </ol>
    </div>
  )
}

/**
 * What to show for one stop, as on Where Is My Train: the scheduled time, and the actual or expected
 * time with how far it is from schedule.
 *
 * - With no live bus, only the timetable is known, so only the scheduled time shows.
 * - Passed stops use the time the bus was seen passing on live GPS if we have it; otherwise the
 *   worked-out time, marked approximate.
 * - A bus off the timetable (e.g. at night) has no scheduled time to compare with, so its times show
 *   without a scheduled time or colour.
 * - A line with no published timetable has no times, only recorded passing times while tracked.
 *
 * @returns {scheduled, actual, delay, approx}, any of which may be null
 */
function stopTimes({ i, passed, trip, journey, passedAt }) {
  const live = journey.source !== 'timetable'
  const scheduled = journey.offSchedule || journey.untimed ? null : trip.startSec + trip.offsets[i]
  if (!live) return { scheduled, actual: null, delay: null, approx: false }
  const recorded = passed ? passedAt[i] : null
  const actual = recorded ?? journey.eta[i]
  return {
    scheduled,
    actual,
    delay: scheduled != null && actual != null ? actual - scheduled : null,
    approx: passed && recorded == null && actual != null,
  }
}

/**
 * With a live position (or one last seen), when the train should really go through a station it
 * doesn't stop at: its timetable time plus the delay expected at the next stop. Null without one.
 */
function expectedAt(at, after, trip, journey) {
  if (journey.source === 'timetable' || journey.eta?.[after + 1] == null) return null
  return at + journey.eta[after + 1] - (trip.startSec + (trip.arrivals?.[after + 1] ?? trip.offsets[after + 1]))
}

/** Where the train is in relation to a station: departed, at the station, or arrived at the end. */
function stopStatus({ passed, atStop, isLast, phase }) {
  if (atStop) return 'At station'
  if (isLast) return phase === 'finished' ? 'Arrived' : null
  return passed ? 'Departed' : null
}

const toneClass = (delay) => (delay == null ? 'text-ink' : delay >= LATE_FROM_SEC ? 'text-late' : 'text-ontime')

function delayText(delay) {
  const minutes = Math.round(Math.abs(delay) / 60)
  if (delay >= LATE_FROM_SEC) return `${minutes} min late`
  if (delay <= -LATE_FROM_SEC) return `${minutes} min early`
  return 'On time'
}

// Hops in when the page opens, then glides along the track as the bus moves.
function BusMarker({ estimated = false, train = false }) {
  return (
    // Grey for a timetable estimate and dark for live GPS, but animated either way, so the bus always
    // looks like it's on the move.
    <span className="bus-arrive relative z-10 flex size-7 items-center justify-center">
      <span className={`pulse-ring absolute inset-0 rounded-full ${estimated ? 'bg-ink-soft/60' : 'bg-road'}`} />
      <span className={`bus-bob relative flex size-7 items-center justify-center rounded-full text-paper ${estimated ? 'bg-ink-soft' : 'bg-ink'}`}>
        {train ? <TrainIcon className="size-4" /> : <BusIcon className="size-4" />}
      </span>
    </span>
  )
}
