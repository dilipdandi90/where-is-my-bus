import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useData, useDebounced, useSessionState, useStoredState } from '../lib/hooks.js'
import { formatClock, formatDuration, formatKm } from '../lib/time.js'
import { track } from '../lib/usage.js'
import FeedNotice from './FeedNotice.jsx'
import { BusIcon, ErrorMessage, Message, NumberPlate, PinIcon, SearchIcon, SwapIcon } from './ui.jsx'

const MAX_RECENT = 6

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
            <Message title={`Getting ${feed.name} bus data…`}>This can take up to a minute the first time.</Message>
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
  const { data, error, loading, retry } = useData(q ? `${feed.id}|${q}` : null, (signal) => api.buses(feed.id, q, signal))

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
            {recent.map((r) => (
              <li key={r.serviceId}>
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
          {data.map((s) => (
            <li key={s.serviceId}>
              <ServiceCard feed={feed} service={s} onOpen={() => onOpen(feed.id, s)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ServiceCard({ feed, service: s, onOpen, children }) {
  return (
    <a href={`#/${feed.id}/bus/${s.serviceId}`} onClick={onOpen} className="block rounded-2xl border border-line bg-card p-3.5 shadow-sm hover:border-road">
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
          {s.departuresToday === 0
            ? 'No departures listed today'
            : s.nextDepartureSec != null
              ? `Next at ${formatClock(s.nextDepartureSec)} · ${s.departuresToday} today`
              : `No more today · ${s.departuresToday} today`}
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
  const key = search && `${feed.id}|${search.from}|${search.to}`
  const { data, error, loading, retry } = useData(key, (signal) => api.between(feed.id, search.from, search.to, signal))

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
      <div className="relative rounded-2xl border border-line bg-card shadow-sm">
        <StopInput feedId={feed.id} label="From" value={from} onChange={setFrom} zIndex="z-20" />
        <div className="mx-4 border-t border-line" />
        <StopInput feedId={feed.id} label="To" value={to} onChange={setTo} zIndex="z-10" />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap from and to"
          className="absolute top-1/2 right-2.5 z-[5] flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-card text-ink-soft"
        >
          <SwapIcon className="size-4" />
        </button>
      </div>
      <button type="submit" disabled={!from.trim() || !to.trim()} className="mt-3 w-full rounded-2xl bg-ink py-3.5 font-semibold text-paper disabled:opacity-40">
        Find buses
      </button>

      {search && loading && <p className="py-6 text-center text-sm text-ink-soft">Searching…</p>}
      {search && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {search && data?.length === 0 && (
        <Message title="No direct bus between these stops">You may need to change buses. Try a major stop nearby, or search for a bus number.</Message>
      )}
      {data?.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {data.map((c) => (
            <li key={c.service.serviceId}>
              <ServiceCard feed={feed} service={c.service} onOpen={() => onOpen(feed.id, c.service)}>
                <p className="mt-1 text-sm">
                  {c.tomorrow && <span className="font-semibold text-road-dark">Tomorrow </span>}
                  <span className="font-bold">{formatClock(c.boardSec)}</span> to {formatClock(c.alightSec)}
                  <span className="text-ink-soft"> · {formatDuration(c.minutes)} · {formatKm(c.km)}</span>
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  Board at <span className="font-semibold text-ink">{c.boardStop}</span>
                  <br />
                  Get off at <span className="font-semibold text-ink">{c.alightStop}</span>
                </p>
              </ServiceCard>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

function StopInput({ feedId, label, value, onChange, zIndex }) {
  // Open only while typing, so the list doesn't sit over the search button once a stop is picked.
  const [open, setOpen] = useState(false)
  const q = useDebounced(value.trim(), 200)
  const { data, loading } = useData(open && q ? `${feedId}|${q}` : null, (signal) => api.stops(feedId, q, signal))
  const suggestions = (data ?? []).filter((s) => s.name !== value)
  const showEmpty = open && q && !loading && data?.length === 0

  return (
    <div className={`relative ${open ? zIndex : ''}`}>
      <label className="flex items-center gap-2 rounded-2xl pl-4 focus-within:bg-tint">
        <span className="w-10 text-xs font-semibold text-ink-soft">{label}</span>
        <input
          value={value}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onBlur={() => setOpen(false)}
          placeholder="Stop name"
          className="min-w-0 flex-1 bg-transparent py-3.5 pr-14 text-base outline-none placeholder:text-ink-soft/70"
        />
      </label>
      {open && (suggestions.length > 0 || showEmpty) && (
        <ul className="absolute top-full right-0 left-0 mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-line bg-card py-1.5 shadow-xl">
          {showEmpty && <li className="px-4 py-3 text-sm text-ink-soft">No stops match “{q}”</li>}
          {suggestions.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                // Runs before the input's blur, which would otherwise remove this list first.
                onPointerDown={(e) => {
                  e.preventDefault()
                  onChange(s.name)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-paper"
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
