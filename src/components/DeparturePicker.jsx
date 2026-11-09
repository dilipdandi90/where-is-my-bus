import { useEffect, useRef, useState } from 'react'
import { clockForTrip, formatClock, formatDuration } from '../lib/time.js'
import { CheckIcon, ChevronIcon } from './ui.jsx'

function statusOf(departure, nowSec) {
  const clock = clockForTrip(nowSec, departure.startSec, departure.durationSec)
  if (clock < departure.startSec) return 'upcoming'
  return clock <= departure.startSec + departure.durationSec ? 'running' : 'done'
}

const BADGES = {
  running: { text: 'Running now', className: 'bg-ontime/10 text-ontime' },
  next: { text: 'Next', className: 'bg-tint text-road-dark' },
  done: { text: 'Finished', className: 'text-ink-soft' },
}

/**
 * Lets people pick a departure from a list showing which are running, next or finished.
 *
 * @param liveBus a live bus being followed that fits none of these departures, or null. Then no
 *        timetable departure is shown as chosen, so a running bus is never labelled "Finished".
 */
export default function DeparturePicker({ departures, selectedId, nowSec, onSelect, liveBus = null }) {
  const dialog = useRef(null)
  const selectedRow = useRef(null)
  const [open, setOpen] = useState(false)

  const chosenId = liveBus ? null : selectedId
  const selected = departures.find((d) => d.tripId === chosenId)
  const nextId = departures.find((d) => statusOf(d, nowSec) === 'upcoming')?.tripId

  const badgeFor = (d) => {
    const status = statusOf(d, nowSec)
    return BADGES[status] ?? (d.tripId === nextId ? BADGES.next : null)
  }

  useEffect(() => {
    if (open) selectedRow.current?.scrollIntoView({ block: 'center' })
  }, [open])

  const show = () => {
    dialog.current.showModal()
    setOpen(true)
  }
  const choose = (id) => {
    onSelect(id)
    dialog.current.close()
  }
  const badge = selected && badgeFor(selected)

  return (
    <section className="px-4 py-3">
      <button
        id="departure"
        data-trip={selectedId ?? ''}
        onClick={show}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left shadow-sm"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-ink-soft">{liveBus ? 'Live bus' : 'Departure'}</span>
          <span className="block font-semibold">
            {liveBus
              ? liveBus.plate
              : selected
                ? `${formatClock(selected.startSec)} to ${formatClock(selected.startSec + selected.durationSec)}`
                : 'Choose a departure'}
          </span>
        </span>
        {liveBus && <span className="shrink-0 rounded-full bg-ontime/10 px-2.5 py-1 text-xs font-semibold text-ontime">Running now</span>}
        {badge && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>{badge.text}</span>}
        <ChevronIcon className="size-5 shrink-0 text-ink-soft" />
      </button>

      <dialog
        ref={dialog}
        className="sheet"
        aria-label="Choose a departure"
        onClose={() => setOpen(false)}
        // A click landing on the dialog itself, not its contents, is on the backdrop.
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close()
        }}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-bold">Today's timetable</h2>
          <button onClick={() => dialog.current.close()} className="-mr-2 rounded-lg px-2 py-1 text-sm font-semibold text-ink-soft">
            Close
          </button>
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {departures.map((d) => {
            const isSelected = d.tripId === chosenId
            const rowBadge = badgeFor(d)
            const done = statusOf(d, nowSec) === 'done'
            return (
              <li key={d.tripId} ref={isSelected ? selectedRow : null}>
                <button
                  onClick={() => choose(d.tripId)}
                  data-trip={d.tripId}
                  aria-current={isSelected}
                  className={`flex w-full items-center gap-3 px-5 py-3 text-left ${isSelected ? 'bg-tint' : ''}`}
                >
                  <span className={`min-w-0 flex-1 ${done && !isSelected ? 'text-ink-soft' : ''}`}>
                    <span className="block font-semibold">{formatClock(d.startSec)}</span>
                    <span className="block text-xs text-ink-soft">
                      Arrives {formatClock(d.startSec + d.durationSec)} · {formatDuration(d.durationSec / 60)}
                    </span>
                  </span>
                  {rowBadge && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${rowBadge.className}`}>{rowBadge.text}</span>}
                  <span className="size-5 shrink-0 text-road-dark">{isSelected && <CheckIcon />}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </dialog>
    </section>
  )
}
