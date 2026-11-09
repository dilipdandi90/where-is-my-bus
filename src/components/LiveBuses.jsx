import { atRouteEnd } from '../lib/journey.js'
import { formatAge } from '../lib/time.js'
import { lastStopIndex } from '../lib/tracker.js'
import { CheckIcon } from './ui.jsx'

/** The real buses on this route right now, by the registration number painted on them. */
export default function LiveBuses({ buses, stops, followedPlate, onFollow }) {
  if (buses.length === 0) return null
  const totalKm = stops[stops.length - 1].km
  // Running buses first, nearest the end first. Finished buses go last, as nobody can catch them.
  const inOrder = [...buses].sort((a, b) => atRouteEnd(a, totalKm) - atRouteEnd(b, totalKm) || b.km - a.km)

  return (
    <section className="px-4 pb-3">
      <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">
        Live buses on this route ({buses.length})
      </h2>
      <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-card shadow-sm">
        {inOrder.map((bus) => {
          const following = bus.plate === followedPlate
          const stop = stops[lastStopIndex(stops, bus.km)]
          const where = atRouteEnd(bus, totalKm) ? 'At last stop' : bus.km < 0.1 ? 'At first stop' : `Past ${stop.name}`
          return (
            <li key={bus.plate}>
              <button
                onClick={() => onFollow(bus)}
                aria-current={following}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${following ? 'bg-tint' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{bus.plate}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {where} · {formatAge(bus.ageSec)}
                  </span>
                </span>
                <span className="size-5 shrink-0 text-road-dark">{following && <CheckIcon />}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
