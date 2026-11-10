import { formatClock, formatDuration, formatKm } from '../lib/time.js'

// Results slide in one after another, as elsewhere on the home screen.
const stagger = (i) => ({ animationDelay: `${Math.min(i * 60, 400)}ms` })

/**
 * Metro lines as riders know them from station maps: one card per line in its colour, with the route
 * drawn between its two ends and a button for each direction.
 *
 * @param services the feed's services, each one direction of a line
 */
export default function MetroLines({ feed, services, onOpen }) {
  const lines = new Map()
  for (const s of services) lines.set(s.number, [...(lines.get(s.number) ?? []), s])
  const ordered = [...lines.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))

  return (
    <ul className="mt-4 space-y-4">
      {ordered.map(([number, directions], i) => (
        <li key={number} className="card-in" style={stagger(i)}>
          <LineCard feed={feed} directions={directions} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

function LineCard({ feed, directions, onOpen }) {
  const line = directions[0]
  const colour = `#${line.color || '566079'}`
  const onColour = `#${line.textColor || 'FFFFFF'}`
  // The route reads left to right from the end the first listed direction starts at.
  const [west, east] = [line.from, line.to]

  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-card shadow-sm">
      <header className="flex items-center gap-3 px-4 py-3" style={{ background: colour, color: onColour }}>
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-black"
          style={{ background: onColour, color: colour }}
          aria-hidden="true"
        >
          {line.number}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <h3 className="truncate text-lg font-extrabold">{line.label}</h3>
          <p className="truncate text-xs font-medium opacity-85">
            Line {line.number}
            {line.operator && ` · ${line.operator}`}
          </p>
        </div>
      </header>

      <div className="px-4 pt-4 pb-1">
        <RouteStrip colour={colour} west={west} east={east} />
        <p className="mt-2 text-center text-xs text-ink-soft">
          {line.stops} stations · {formatKm(line.km)}
          {line.timetabled !== false && ` · about ${formatDuration(line.typicalMinutes)} end to end`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        {directions.map((s) => (
          <a
            key={s.serviceId}
            href={`#/${feed.id}/bus/${s.serviceId}`}
            onClick={() => onOpen(feed.id, s)}
            className="press group rounded-2xl border-2 px-3 py-2.5 transition-colors"
            style={{ borderColor: `color-mix(in srgb, ${colour} 45%, transparent)`, background: `color-mix(in srgb, ${colour} 7%, white)` }}
          >
            <span className="block text-[11px] font-semibold tracking-wide text-ink-soft uppercase">Towards</span>
            <span className="block truncate text-sm font-bold">{s.to}</span>
            <span className="mt-1 block text-xs text-ink-soft">{nextTrain(s)}</span>
          </a>
        ))}
      </div>
    </article>
  )
}

/** The line drawn between its two end stations, like a strip map. */
function RouteStrip({ colour, west, east }) {
  return (
    <div>
      <div className="flex items-center px-1.5" aria-hidden="true">
        <span className="size-4 shrink-0 rounded-full border-4 bg-card" style={{ borderColor: colour }} />
        <span className="h-2 flex-1 rounded-full" style={{ background: colour }} />
        <span className="size-4 shrink-0 rounded-full border-4 bg-card" style={{ borderColor: colour }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-4 text-sm font-semibold">
        <span className="min-w-0 truncate">{west}</span>
        <span className="min-w-0 truncate text-right">{east}</span>
      </div>
    </div>
  )
}

function nextTrain(s) {
  if (s.timetabled === false) return 'Track live on board'
  if (s.departuresToday === 0) return 'No trains listed today'
  if (s.nextDepartureSec == null) return 'No more trains today'
  return `Next ${formatClock(s.nextDepartureSec)}`
}
