import { useEffect, useRef } from 'react'
import { formatClock, formatKm } from '../lib/time.js'
import { BellIcon, BusIcon } from './ui.jsx'

const SHOW_EXPECTED_FROM_SEC = 60

/** The route from top to bottom, with the bus marked between the stops it's travelling between. */
export default function Timeline({ stops, trip, journey, alarmIndex, onToggleAlarm }) {
  const markerRef = useRef(null)
  const hasScrolled = useRef(false)

  useEffect(() => {
    if (!hasScrolled.current && markerRef.current && journey.phase === 'running') {
      hasScrolled.current = true
      markerRef.current.scrollIntoView({ block: 'center' })
    }
  }, [journey.phase])

  const { last, phase, source, km, eta } = journey

  return (
    <ol className="pb-4">
      {stops.map((stop, i) => {
        const passed = i <= last
        const isLast = i === stops.length - 1
        const scheduled = trip.startSec + trip.offsets[i]
        const shift = eta[i] - scheduled
        const showBusHere = phase === 'running' && i === last
        const atStop = showBusHere && km - stop.km < 0.05

        return (
          <li key={`${stop.id}-${i}`}>
            <div className="flex items-stretch">
              <div className="w-20 shrink-0 py-3 pr-2 text-right text-xs">
                {shift >= SHOW_EXPECTED_FROM_SEC && !passed ? (
                  <>
                    <div className="font-bold text-late">{formatClock(eta[i])}</div>
                    <div className="text-ink-soft line-through">{formatClock(scheduled)}</div>
                  </>
                ) : (
                  <div className={passed ? 'text-ink-soft' : 'font-semibold'}>{formatClock(eta[i])}</div>
                )}
              </div>

              <Rail first={i === 0} last={isLast} topDone={passed} bottomDone={i < last} dotDone={passed} here={atStop} />

              <div className={`flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-2 ${passed && !atStop ? 'text-ink-soft' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm leading-snug ${atStop ? 'font-bold' : i === 0 || isLast ? 'font-semibold' : ''}`}>{stop.name}</div>
                  <div className="text-xs text-ink-soft">{formatKm(stop.km)}</div>
                </div>
                {!passed && (
                  <button
                    onClick={() => onToggleAlarm(i)}
                    aria-pressed={alarmIndex === i}
                    aria-label={`${alarmIndex === i ? 'Cancel alert for' : 'Alert me before'} ${stop.name}`}
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ${alarmIndex === i ? 'bg-road text-ink' : 'text-ink-soft/60'}`}
                  >
                    <BellIcon filled={alarmIndex === i} />
                  </button>
                )}
              </div>
            </div>

            {showBusHere && !atStop && !isLast && (
              <div ref={markerRef} className="flex items-center">
                <div className="w-20 shrink-0" />
                <div className="relative flex w-8 shrink-0 justify-center self-stretch">
                  <span className="absolute inset-y-0 w-1.5 bg-road" />
                  <BusMarker estimated={source === 'timetable'} />
                </div>
                <p className="py-1.5 pl-2 text-xs font-semibold text-road-dark">
                  {source === 'timetable' ? 'Should be about here' : 'Bus is here'}
                </p>
              </div>
            )}
            {atStop && <span ref={markerRef} />}
          </li>
        )
      })}
    </ol>
  )
}

function Rail({ first, last, topDone, bottomDone, dotDone, here }) {
  return (
    <div className="relative flex w-8 shrink-0 items-center justify-center">
      {!first && <span className={`absolute top-0 bottom-1/2 w-1.5 ${topDone ? 'bg-road' : 'bg-line'}`} />}
      {!last && <span className={`absolute top-1/2 bottom-0 w-1.5 ${bottomDone ? 'bg-road' : 'bg-line'}`} />}
      {here ? (
        <BusMarker />
      ) : (
        <span className={`relative z-10 size-3 rounded-full border-2 ${dotDone ? 'border-road-dark bg-road' : 'border-ink-soft bg-card'}`} />
      )}
    </div>
  )
}

function BusMarker({ estimated = false }) {
  return (
    <span className="relative z-10 flex size-7 items-center justify-center">
      {!estimated && <span className="pulse-ring absolute inset-0 rounded-full bg-road" />}
      <span className={`relative flex size-7 items-center justify-center rounded-full text-paper ${estimated ? 'bg-ink-soft' : 'bg-ink'}`}>
        <BusIcon className="size-4" />
      </span>
    </span>
  )
}
