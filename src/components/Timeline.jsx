import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatClock, formatDistance, formatKm } from '../lib/time.js'
import { AT_STOP_KM, nextStopInfo } from '../lib/journey.js'
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
 * How far down the list the bus is, in pixels: between the dots of the stop it last passed and the
 * next one, in proportion to how far along that stretch it really is.
 */
function busOffset({ stops, centers, km, last, phase }) {
  if (phase === 'finished') return centers[centers.length - 1]
  if (phase !== 'running' || last < 0) return centers[0]
  if (last >= stops.length - 1) return centers[last]
  const span = stops[last + 1].km - stops[last].km
  const along = span > 0 ? Math.min(1, Math.max(0, (km - stops[last].km) / span)) : 0
  return centers[last] + along * (centers[last + 1] - centers[last])
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
export default function Timeline({ stops, trip, journey, passedAt = {}, alarmIndex, onToggleAlarm, train = false }) {
  const markerRef = useRef(null)
  const hasScrolled = useRef(false)
  const trackRef = useRef(null)
  const dotRefs = useRef([])
  const [centers, setCenters] = useState([])
  const { last, phase, source, km } = journey

  // Where each stop's dot sits, measured again whenever the list changes size (fonts loading,
  // rotating the phone, text wrapping differently).
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const measure = () => {
      const top = track.getBoundingClientRect().top
      setCenters(dotRefs.current.slice(0, stops.length).map((dot) => {
        const r = dot?.getBoundingClientRect()
        return r ? r.top + r.height / 2 - top : 0
      }))
    }
    // Calls measure once straight away, then on every resize.
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [stops.length])

  const measured = centers.length === stops.length && stops.length > 1
  const firstY = measured ? centers[0] : 0
  const lastY = measured ? centers[centers.length - 1] : 0
  const busY = measured ? busOffset({ stops, centers, km, last, phase }) : 0
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
      {measured && phase === 'running' && (
        <div
          key={source}
          ref={markerRef}
          className="track-move pointer-events-none absolute z-10 flex items-center gap-2"
          style={{ left: RAIL_X - 14, top: busY - 14 }}
        >
          <BusMarker estimated={source === 'timetable'} train={train} />
          {nextStop && (
            // Solid and raised, so it stays readable as it passes over the stop names.
            <span className="max-w-56 truncate rounded-lg border border-line bg-card px-2 py-1 text-xs whitespace-nowrap shadow-md">
              {nextStop.distanceKm != null && <span className="font-bold text-ink">{formatDistance(nextStop.distanceKm)}</span>}
              <span className="text-ink-soft">{nextStop.distanceKm != null ? ' to ' : 'At '}</span>
              <span className="font-semibold text-ink">{nextStop.name}</span>
            </span>
          )}
        </div>
      )}
    <ol>
      {stops.map((stop, i) => {
        const passed = i <= last
        const isLast = i === stops.length - 1
        const atStop = phase === 'running' && i === last && km - stop.km < AT_STOP_KM
        const times = stopTimes({ i, passed, trip, journey, passedAt })

        return (
          <li key={`${stop.id}-${i}`} className="stop-in" style={{ animationDelay: `${Math.min(i * STAGGER_MS, MAX_STAGGER_MS)}ms` }}>
            <div className="flex items-stretch">
              <div className="w-20 shrink-0 py-2.5 pr-2 text-right text-xs leading-tight">
                {times.scheduled != null && <div className="text-ink-soft">{formatClock(times.scheduled)}</div>}
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
                <div className="min-w-0 flex-1">
                  <div className={`text-sm leading-snug ${atStop ? 'font-bold' : i === 0 || isLast ? 'font-semibold' : ''}`}>{stop.name}
                    <PlatformChip platform={stop.platform} />
                  </div>
                  <div className="text-xs text-ink-soft">
                    {formatKm(stop.km)}
                    {times.delay != null && <span className={`font-semibold ${toneClass(times.delay)}`}> · {delayText(times.delay)}</span>}
                  </div>
                </div>
                {!passed && (
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
