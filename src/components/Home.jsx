import { useEffect, useEffectEvent, useState } from 'react'
import { api } from '../lib/api.js'
import { useData, useDebounced, useSessionState, useStoredState, useTick } from '../lib/hooks.js'
import { formatClock, formatDuration, formatKm, secondsNow } from '../lib/time.js'
import { track } from '../lib/usage.js'
import FeedNotice from './FeedNotice.jsx'
import { BusIcon, ErrorMessage, Message, NumberPlate, PinIcon, ReloadIcon, SearchIcon, SwapIcon } from './ui.jsx'

const MAX_RECENT = 6
// Saved results show instantly, then the fresh ones replace them. Searches carry live counts and
// next-bus times, so they're kept for less time than stop names.
const CACHE_SEARCH_MS = 30 * 60 * 1000
const CACHE_STOPS_MS = 12 * 3600 * 1000

export default function Home({ feeds, failed }) {
  const [storedFeedId, setFeedId] = useStoredState('wimb.feed', null)
  const [tab, setTab] = useSessionState('wimb.tab', 'number')
  const [recent, setRecent] = useStoredState('wimb.recent', [])

  const feed = feeds?.find((f) => f.id === storedFeedId) ?? feeds?.[0]

  const remember = (feedId, s) => {
    const entry = { feedId, serviceId: s.serviceId, number: s.number, from: s.from, to: s.to, operator: s.operator }
    setRecent([entry, ...recent.filter((r) => r.serviceId !== s.serviceId)].slice(0, MAX_RECENT))
  }

  return (
    <>
      <header className="app-header px-5 pt-6 pb-5 text-paper">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <BusIcon className="size-7 text-road" />
          Where Is My Bus
        </h1>
        <p className="mt-1 text-sm text-paper/75">Follow your bus from your phone, with no GPS needed on the bus.</p>
        {feeds && <FeedPicker feeds={feeds} selected={feed?.id} onSelect={setFeedId} />}
      </header>

      {failed && !feeds && (
        <ErrorMessage title="We can't connect right now" error={{ message: "Check your internet. We'll keep trying." }} />
      )}
      {!failed && !feeds && <Message title="Connecting…" />}

      {feed && (
        <main className="px-4 py-4">
          <div role="tablist" aria-label="Search type" className="mb-3 grid grid-cols-2 rounded-xl bg-line/70 p-1 text-sm font-semibold">
            {[
              ['number', 'Bus number or place'],
              ['between', 'Between two stops'],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-lg py-2 ${tab === id ? 'bg-card shadow-sm' : 'text-ink-soft'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {feed.status === 'LOADING' && (
            <Message title={`Getting ${feed.name} bus data…`}>The server is starting up after a quiet spell. This can take a few minutes.</Message>
          )}
          {feed.status === 'FAILED' && (
            <ErrorMessage
              title={`${feed.name} isn't available right now`}
              error={{ message: "We couldn't get its bus data. We'll keep trying, so check back in a few minutes." }}
            />
          )}
          {feed.status === 'READY' &&
            (tab === 'number' ? (
              <BusSearch key={feed.id} feed={feed} recent={recent.filter((r) => r.feedId === feed.id)} onOpen={remember} />
            ) : (
              <BetweenSearch key={feed.id} feed={feed} onOpen={remember} />
            ))}

          <footer className="mt-6 border-t border-line pt-3">
            <FeedNotice feed={feed} />
          </footer>
        </main>
      )}
    </>
  )
}

function FeedPicker({ feeds, selected, onSelect }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {feeds.map((f) => (
        <button
          key={f.id}
          onClick={() => onSelect(f.id)}
          aria-pressed={f.id === selected}
          // An odd one out at the end takes the full width, so the grid has no gap.
          className={`min-w-0 rounded-xl px-3.5 py-2 text-left leading-tight last:odd:col-span-2 ${
            f.id === selected ? 'bg-road text-ink' : 'bg-paper/10 text-paper'
          }`}
        >
          <span className="block text-sm font-semibold">{f.name}</span>
          <span className="block text-xs opacity-75">{f.operators}</span>
        </button>
      ))}
    </div>
  )
}

function BusSearch({ feed, recent, onOpen }) {
  const [query, setQuery] = useSessionState(`wimb.${feed.id}.query`, '')
  const q = useDebounced(query.trim(), 250)
  const { data, error, loading, retry } = useData(q ? `bus|${feed.id}|${q}` : null, (signal) => api.buses(feed.id, q, signal), { cacheMs: CACHE_SEARCH_MS })

  // Only once they've stopped typing, so "1", "11" and "115" count as one search.
  const settled = useDebounced(q, 1500)
  const settledResults = settled === q && data ? data.length : null
  useEffect(() => {
    if (settled && settledResults != null) track('search', { feed: feed.id, text: settled, results: settledResults })
  }, [settled, settledResults, feed.id])

  return (
    <>
      <label className="flex items-center gap-2.5 rounded-2xl border border-line bg-card px-4 shadow-sm focus-within:border-road">
        <SearchIcon className="size-5 shrink-0 text-ink-soft" />
        <span className="sr-only">Bus number or place</span>
        <input
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={feed.id === 'msrtc' ? 'Town name, such as Solapur' : 'Bus number or place'}
          className="min-w-0 flex-1 bg-transparent py-3.5 text-base outline-none placeholder:text-ink-soft/70"
        />
      </label>

      {!q && recent.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Recent</h2>
          <ul className="space-y-2">
            {recent.map((r, i) => (
              <li key={r.serviceId} className="card-in" style={stagger(i)}>
                <a href={`#/${r.feedId}/bus/${r.serviceId}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-sm">
                  {!feed.numbersAreCodes && <NumberPlate number={r.number} />}
                  <span className="min-w-0 truncate text-sm">
                    {r.from} → {r.to}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {q && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {q && loading && <p className="py-6 text-center text-sm text-ink-soft">Searching…</p>}
      {q && data?.length === 0 && <Message title={`No buses found for “${q}”`}>Try part of the number, or a place on the route.</Message>}
      {q && data?.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {data.map((s, i) => (
            <li key={s.serviceId} className="card-in" style={stagger(i)}>
              <ServiceCard feed={feed} service={s} onOpen={() => onOpen(feed.id, s)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// Results slide in one after another, capped so a long list doesn't keep people waiting.
const stagger = (i) => ({ animationDelay: `${Math.min(i * 45, 400)}ms` })

function ServiceCard({ feed, service: s, onOpen, children }) {
  return (
    <a
      href={`#/${feed.id}/bus/${s.serviceId}`}
      onClick={onOpen}
      className="press block rounded-2xl border border-line bg-card p-3.5 shadow-sm transition-[border-color,box-shadow,translate] hover:-translate-y-0.5 hover:border-road hover:shadow-md"
    >
      {!feed.numbersAreCodes && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <NumberPlate number={s.number} />
          {s.operator && <span className="text-xs font-semibold text-ink-soft">{s.operator}</span>}
        </div>
      )}
      <p className="font-semibold">
        {s.from} <span className="text-ink-soft">→</span> {s.to}
      </p>
      {feed.numbersAreCodes && (
        <p className="mt-0.5 text-xs text-ink-soft">
          {s.operator} · Route code {s.number}
        </p>
      )}
      {children ?? (
        <p className="mt-1 text-xs text-ink-soft">
          {s.stops} stops · {formatKm(s.km)} · about {formatDuration(s.typicalMinutes)}
          <br />
          {/* Live buses outrank the timetable, which often ends early in these feeds. */}
          {s.busesRunning > 0 ? (
            <span className="font-semibold text-ontime">
              {s.busesRunning} {s.busesRunning === 1 ? 'bus' : 'buses'} running now
            </span>
          ) : s.departuresToday === 0 ? (
            'No departures listed today'
          ) : s.nextDepartureSec != null ? (
            `Next at ${formatClock(s.nextDepartureSec)} · ${s.departuresToday} today`
          ) : (
            'No more in our timetable today'
          )}
        </p>
      )}
    </a>
  )
}

function BetweenSearch({ feed, onOpen }) {
  // Kept for the whole visit, so coming back from a bus shows the same search and results.
  const [from, setFrom] = useSessionState(`wimb.${feed.id}.from`, '')
  const [to, setTo] = useSessionState(`wimb.${feed.id}.to`, '')
  const [search, setSearch] = useSessionState(`wimb.${feed.id}.between`, null)
  // Which fields have a suggestion list open, so the swap button hides only behind an open list.
  const [openFields, setOpenFields] = useState(() => new Set())
  const setListOpen = (name, isOpen) =>
    setOpenFields((prev) => {
      const next = new Set(prev)
      if (isOpen) next.add(name)
      else next.delete(name)
      return next
    })
  const listOpen = openFields.size > 0
  const key = search && `${feed.id}|${search.from}|${search.to}`
  const { data, error, loading, retry } = useData(key && `btw|${key}`, (signal) => api.between(feed.id, search.from, search.to, signal), { cacheMs: CACHE_SEARCH_MS })

  const swap = () => {
    setFrom(to)
    setTo(from)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (from.trim() && to.trim()) {
          setSearch({ from: from.trim(), to: to.trim() })
          track('between', { feed: feed.id, text: from.trim(), text2: to.trim() })
        }
      }}
    >
      <div className="relative space-y-2">
        <StopInput feedId={feed.id} label="From" value={from} onChange={setFrom} onListOpen={setListOpen} />
        <StopInput feedId={feed.id} label="To" value={to} onChange={setTo} onListOpen={setListOpen} />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap from and to"
          // Hidden only while a suggestion list is open, so it never peeks over it — but stays tappable
          // once a stop is picked, even though the field keeps focus.
          className={`absolute top-1/2 right-3 z-30 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-card text-ink-soft shadow-sm transition-opacity ${
            listOpen ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <SwapIcon className="size-4" />
        </button>
      </div>
      <p className="mt-2 px-1 text-xs text-ink-soft">Type each stop, then pick it from the list.</p>
      <button type="submit" disabled={!from.trim() || !to.trim()} className="mt-2 w-full rounded-2xl bg-ink py-3.5 font-semibold text-paper disabled:opacity-40">
        Find buses
      </button>

      {search && loading && <p className="py-6 text-center text-sm text-ink-soft">Searching…</p>}
      {search && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {search && data?.length === 0 && (
        <Message title="No direct bus between these stops">You may need to change buses. Try a major stop nearby, or search for a bus number.</Message>
      )}
      {data?.length > 0 && <Timetable feed={feed} rows={data} onOpen={onOpen} />}
    </form>
  )
}

/**
 * A day's buses between two stops, one row per bus in boarding order, like a station departure board.
 * Buses that have already left stay listed but faded, and the next one to catch is marked.
 */
function Timetable({ feed, rows, onOpen }) {
  useTick(30_000)
  const nowSec = secondsNow(feed.timezone ?? 'Asia/Kolkata')
  const today = rows.filter((r) => !r.tomorrow)
  const tomorrow = rows.filter((r) => r.tomorrow)
  const nextIndex = today.findIndex((r) => !r.departed)
  const leftToday = today.filter((r) => !r.departed).length

  return (
    <div className="mt-4 space-y-4">
      {today.length > 0 && (
        <TimetableSection
          title={`Today · ${today.length} ${today.length === 1 ? 'bus' : 'buses'}`}
          subtitle={leftToday === 0 ? 'All have left for today' : `${leftToday} still to go`}
          feed={feed}
          rows={today}
          nextIndex={nextIndex}
          nowSec={nowSec}
          onOpen={onOpen}
        />
      )}
      {tomorrow.length > 0 && (
        <TimetableSection
          title={`Tomorrow · ${tomorrow.length} ${tomorrow.length === 1 ? 'bus' : 'buses'}`}
          feed={feed}
          rows={tomorrow}
          nextIndex={leftToday === 0 ? 0 : -1}
          nowSec={nowSec}
          onOpen={onOpen}
        />
      )}
    </div>
  )
}

function TimetableSection({ title, subtitle, feed, rows, nextIndex, nowSec, onOpen }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-bold">{title}</h2>
        {subtitle && <span className="text-xs text-ink-soft">{subtitle}</span>}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        {rows.map((r, i) => {
          const isNext = i === nextIndex
          // Left the boarding stop but not yet at the destination: still on the road, so worth showing.
          const onTheWay = r.departed && r.alightSec > nowSec
          const gone = r.departed && !onTheWay
          const label = feed.numbersAreCodes ? r.service.to : r.service.number
          return (
            <li key={`${r.tripId}-${r.tomorrow}`} className="card-in" style={stagger(i)}>
              <a
                href={`#/${feed.id}/bus/${r.service.serviceId}/${encodeURIComponent(r.tripId)}`}
                onClick={() => onOpen(feed.id, r.service)}
                className={`press flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper ${isNext ? 'bg-tint' : ''} ${gone ? 'opacity-55' : ''}`}
              >
                <span className="w-14 shrink-0">
                  <span className="block text-base leading-tight font-bold">{formatClock(r.boardSec)}</span>
                  <span className="block text-xs text-ink-soft">→ {formatClock(r.alightSec)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {!feed.numbersAreCodes && <NumberPlate number={r.service.number} />}
                    <span className="truncate text-sm font-semibold">{feed.numbersAreCodes ? label : `to ${r.service.to}`}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-soft">
                    {formatDuration(r.minutes)} · {formatKm(r.km)}
                    {r.boardStop && ` · from ${r.boardStop}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs font-semibold">
                  {onTheWay ? (
                    <span className="rounded-full bg-ontime/10 px-2 py-0.5 text-ontime">On the way</span>
                  ) : gone ? (
                    // Past its arrival time too, so by the timetable it has finished the journey.
                    <span className="text-ink-soft">Reached</span>
                  ) : isNext ? (
                    <span className="rounded-full bg-road px-2 py-0.5 text-ink">Next</span>
                  ) : null}
                  {r.service.busesRunning > 0 && !gone && <span className="mt-1 block text-ontime">● Live</span>}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function StopInput({ feedId, label, value, onChange, onListOpen }) {
  // Open only while typing, so the list doesn't sit over the search button once a stop is picked.
  const [open, setOpen] = useState(false)
  const q = useDebounced(value.trim(), 200)
  const active = open && q.length > 0
  const { data, error, loading } = useData(active ? `stop|${feedId}|${q}` : null, (signal) => api.stops(feedId, q, signal), { cacheMs: CACHE_STOPS_MS })
  const suggestions = (data ?? []).filter((s) => s.name !== value)

  // Lets the parent hide the swap button behind this field's open list.
  const report = useEffectEvent((isOpen) => onListOpen?.(label, isOpen))
  useEffect(() => {
    report(active)
    return () => report(false)
  }, [active])

  const pick = (name) => {
    onChange(name)
    setOpen(false)
  }

  return (
    // Raised above the other field and the swap button while this one's list is open.
    <div className={`relative ${open ? 'z-40' : ''}`}>
      {/* A div, not a label: a clear button inside a label would become part of the input's name. */}
      <div className="flex items-center gap-2.5 rounded-2xl border-2 border-line bg-card pr-3 pl-3.5 shadow-sm focus-within:border-road">
        <PinIcon className="size-5 shrink-0 text-road-dark" />
        <span aria-hidden="true" className="w-9 shrink-0 text-xs font-semibold text-ink-soft">{label}</span>
        <input
          value={value}
          aria-label={label}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="Stop name"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-base outline-none placeholder:text-ink-soft/70"
        />
        {active && loading && <ReloadIcon className="size-4 shrink-0 animate-spin text-ink-soft" />}
        {value && !loading && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            // Before blur, so the field isn't closed first.
            onPointerDown={(e) => {
              e.preventDefault()
              onChange('')
              setOpen(true)
            }}
            className="shrink-0 px-1 text-lg leading-none text-ink-soft"
          >
            ×
          </button>
        )}
      </div>
      {active && (
        <ul className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-line bg-card py-1.5 shadow-xl">
          {loading && suggestions.length === 0 && <li className="px-4 py-3 text-sm text-ink-soft">Searching…</li>}
          {error && !loading && <li className="px-4 py-3 text-sm text-ink-soft">Couldn't load stops. Check your connection and try again.</li>}
          {!loading && !error && suggestions.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-soft">No stops found for “{q}”. Check the spelling, or try a nearby landmark.</li>
          )}
          {suggestions.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                // Runs before the input's blur, which would otherwise remove this list first.
                onPointerDown={(e) => {
                  e.preventDefault()
                  pick(s.name)
                }}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm hover:bg-paper"
              >
                <PinIcon className="size-4 shrink-0 text-road-dark" />
                <span className="min-w-0">
                  <Highlighted text={s.name} match={q} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Bolds the part of a suggestion that matches what was typed. */
function Highlighted({ text, match }) {
  const at = text.toLowerCase().indexOf(match.toLowerCase())
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-bold">{text.slice(at, at + match.length)}</strong>
      {text.slice(at + match.length)}
    </>
  )
}
