import { useEffect, useEffectEvent, useState } from 'react'
import { api } from '../lib/api.js'
import { CACHE_MS } from '../lib/cache.js'
import { useData, useDebounced, useSessionState, useStoredState, useTick } from '../lib/hooks.js'
import { formatClock, formatDuration, formatKm, secondsNow } from '../lib/time.js'
import { track } from '../lib/usage.js'
import FeedNotice from './FeedNotice.jsx'
import MetroLines from './MetroLines.jsx'
import { count, isMetro, lineColours, wordsFor } from '../lib/words.js'
import { BusIcon, ErrorMessage, Message, PinIcon, PlatformChip, ReloadIcon, SearchIcon, ServicePlate, SwapIcon, TrainIcon } from './ui.jsx'

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
    const entry = { feedId, serviceId: s.serviceId, number: s.number, from: s.from, to: s.to, operator: s.operator, color: s.color, textColor: s.textColor }
    setRecent([entry, ...recent.filter((r) => r.serviceId !== s.serviceId)].slice(0, MAX_RECENT))
  }

  return (
    <>
      <header className="app-header px-5 pt-5 pb-4 text-paper">
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <BusIcon className="size-6 text-road" />
          Where Is My Bus
        </h1>
        <p className="mt-0.5 text-xs text-paper/70">Live bus and metro tracking, with no GPS needed on board.</p>
        {feeds && <FeedPicker feeds={feeds} selected={feed} onSelect={setFeedId} />}
      </header>

      {failed && !feeds && (
        <ErrorMessage title="We can't connect right now" error={{ message: "Check your internet. We'll keep trying." }} />
      )}
      {!failed && !feeds && <Message title="Connecting…" />}

      {feed && (
        <main className="px-4 py-4">
          <div role="tablist" aria-label="Search type" className="mb-3 grid grid-cols-2 rounded-xl bg-line/70 p-1 text-sm font-semibold">
            {[
              ['number', wordsFor(feed).searchTab],
              ['between', wordsFor(feed).betweenTab],
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
            <Message title={`Getting ${feed.name} timetable…`}>The server is starting up after a quiet spell. This can take a few minutes.</Message>
          )}
          {feed.status === 'FAILED' && (
            <ErrorMessage
              title={`${feed.name} isn't available right now`}
              error={{ message: "We couldn't get its timetable. We'll keep trying, so check back in a few minutes." }}
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

/**
 * A short name that fits a small button: the first place in the name ("Mumbai" from "Mumbai, Thane &
 * Kalyan"), or the operator when the name is long ("MSRTC" for "Maharashtra ST").
 */
function shortName(feed) {
  const place = feed.name.split(/[,&]/)[0].trim()
  return place.length <= 10 ? place : feed.operators.split(',')[0].trim()
}

/**
 * Bus or metro first, then where. Two small rows rather than a tile per region, so the search below
 * stays on screen. The last region picked for each is remembered, so switching back is one tap.
 */
function FeedPicker({ feeds, selected, onSelect }) {
  const [lastBus, setLastBus] = useStoredState('wimb.lastBusFeed', null)
  const [lastMetro, setLastMetro] = useStoredState('wimb.lastMetroFeed', null)
  const metro = isMetro(selected)
  const busFeeds = feeds.filter((f) => !isMetro(f))
  const metroFeeds = feeds.filter((f) => isMetro(f))
  const shown = metro ? metroFeeds : busFeeds

  const pick = (f) => {
    if (isMetro(f)) setLastMetro(f.id)
    else setLastBus(f.id)
    onSelect(f.id)
  }
  const switchTo = (toMetro) => {
    if (toMetro === metro) return
    // Remembers where they were, even if it was picked before this switch existed.
    if (selected) {
      if (metro) setLastMetro(selected.id)
      else setLastBus(selected.id)
    }
    const list = toMetro ? metroFeeds : busFeeds
    const remembered = list.find((f) => f.id === (toMetro ? lastMetro : lastBus))
    if (list.length > 0) pick(remembered ?? list[0])
  }

  return (
    <div className="mt-3.5">
      <div role="tablist" aria-label="Bus or metro" className="grid grid-cols-2 gap-1 rounded-2xl bg-paper/10 p-1">
        {[
          [false, 'Bus', BusIcon, busFeeds.length],
          [true, 'Metro', TrainIcon, metroFeeds.length],
        ].map(([isMetroTab, label, Icon, available]) => (
          <button
            key={label}
            role="tab"
            aria-selected={metro === isMetroTab}
            disabled={available === 0}
            onClick={() => switchTo(isMetroTab)}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-colors disabled:opacity-40 ${
              metro === isMetroTab ? 'bg-card text-ink shadow-sm' : 'text-paper/80'
            }`}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>

      {shown.length > 1 && (
        <div role="radiogroup" aria-label={metro ? 'Metro' : 'Region'} className="mt-2.5 flex gap-1.5">
          {shown.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={f.id === selected?.id}
              aria-label={f.name}
              onClick={() => pick(f)}
              className={`min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-semibold transition-colors ${
                f.id === selected?.id ? 'bg-road text-ink' : 'bg-paper/10 text-paper/85'
              }`}
            >
              {shortName(f)}
            </button>
          ))}
        </div>
      )}
      {/* The full name and operators of what's picked, so the short button names stay clear. */}
      {selected && (
        <p className="mt-2 truncate text-center text-xs text-paper/70">
          <span className="font-semibold text-paper">{selected.name}</span> · {selected.operators}
        </p>
      )}
    </div>
  )
}

function BusSearch({ feed, recent, onOpen }) {
  const [query, setQuery] = useSessionState(`wimb.${feed.id}.query`, '')
  const q = useDebounced(query.trim(), 250)
  const metro = isMetro(feed)
  const words = wordsFor(feed)
  // A metro has only a few lines, so all of them show before anything is typed. Every line's name
  // ends in "Line", which the search matches.
  const lookup = q || (metro ? 'line' : '')
  // Metro lines are built into the server, so the list is kept for a week; next trains are worked out
  // from each line's saved timetable (see MetroLines).
  const { data, error, loading, retry } = useData(lookup ? `bus|${feed.id}|${lookup}` : null, (signal) => api.buses(feed.id, lookup, signal), {
    cacheMs: metro ? CACHE_MS.metro : CACHE_SEARCH_MS,
  })

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
        <span className="sr-only">{words.searchTab}</span>
        <input
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={feed.id === 'msrtc' ? 'Town name, such as Solapur' : words.searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent py-3.5 text-base outline-none placeholder:text-ink-soft/70"
        />
      </label>

      {!q && !metro && recent.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Recent</h2>
          <ul className="space-y-2">
            {recent.map((r, i) => (
              <li key={r.serviceId} className="card-in" style={stagger(i)}>
                <a href={`#/${r.feedId}/bus/${r.serviceId}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-sm">
                  {!feed.numbersAreCodes && <ServicePlate metro={metro} service={r} />}
                  <span className="min-w-0 truncate text-sm">
                    {r.from} → {r.to}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lookup && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {lookup && loading && <p className="py-6 text-center text-sm text-ink-soft">Searching…</p>}
      {q && data?.length === 0 && (
        <Message title={`No ${words.buses} found for “${q}”`}>
          {metro ? 'Try a line number or colour, such as 1 or Aqua, or search between two stations.' : 'Try part of the number, or a place on the route.'}
        </Message>
      )}
      {lookup && data?.length > 0 && metro && <MetroLines feed={feed} services={data} onOpen={onOpen} />}
      {lookup && data?.length > 0 && !metro && (
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
  const metro = isMetro(feed)
  const words = wordsFor(feed)
  return (
    <a
      href={`#/${feed.id}/bus/${s.serviceId}`}
      onClick={onOpen}
      // A metro card carries its line's colour down the left edge, as on station maps.
      style={metro && s.color ? { ...lineColours(s.color), borderLeft: `6px solid #${s.color}` } : undefined}
      className="press block rounded-2xl border border-line bg-card p-3.5 shadow-sm transition-[border-color,box-shadow,translate] hover:-translate-y-0.5 hover:border-road hover:shadow-md"
    >
      {!feed.numbersAreCodes && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <ServicePlate metro={metro} service={s} />
          {metro ? (
            <span className="text-xs font-semibold text-ink-soft">{s.label}</span>
          ) : (
            s.operator && <span className="text-xs font-semibold text-ink-soft">{s.operator}</span>
          )}
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
          {s.stops} {words.stops} · {formatKm(s.km)}
          {s.timetabled !== false && ` · about ${formatDuration(s.typicalMinutes)}`}
          <br />
          {/* Live buses outrank the timetable, which often ends early in these feeds. */}
          {s.busesRunning > 0 ? (
            <span className="font-semibold text-ontime">
              {count(words, s.busesRunning)} running now
            </span>
          ) : s.timetabled === false ? (
            'No timetable published yet · track it live on board'
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
        <StopInput feedId={feed.id} words={wordsFor(feed)} label="From" value={from} onChange={setFrom} onListOpen={setListOpen} />
        <StopInput feedId={feed.id} words={wordsFor(feed)} label="To" value={to} onChange={setTo} onListOpen={setListOpen} />
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
      <p className="mt-2 px-1 text-xs text-ink-soft">Type each {wordsFor(feed).stop}, then pick it from the list.</p>
      <button type="submit" disabled={!from.trim() || !to.trim()} className="mt-2 w-full rounded-2xl bg-ink py-3.5 font-semibold text-paper disabled:opacity-40">
        Find {wordsFor(feed).buses}
      </button>

      {search && loading && <p className="py-6 text-center text-sm text-ink-soft">Searching…</p>}
      {search && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {search && data?.length === 0 && (
        isMetro(feed) ? (
          <Message title="No direct line between these stations">You may need to change lines, for example at District Court.</Message>
        ) : (
          <Message title="No direct bus between these stops">You may need to change buses. Try a major stop nearby, or search for a bus number.</Message>
        )
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
  const words = wordsFor(feed)
  const untimed = rows.filter((r) => r.untimed)
  const today = rows.filter((r) => !r.tomorrow && !r.untimed)
  const tomorrow = rows.filter((r) => r.tomorrow && !r.untimed)
  const nextIndex = today.findIndex((r) => !r.departed)
  const leftToday = today.filter((r) => !r.departed).length

  return (
    <div className="mt-4 space-y-4">
      {today.length > 0 && (
        <TimetableSection
          title={`Today · ${count(words, today.length)}`}
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
          title={`Tomorrow · ${count(words, tomorrow.length)}`}
          feed={feed}
          rows={tomorrow}
          nextIndex={leftToday === 0 ? 0 : -1}
          nowSec={nowSec}
          onOpen={onOpen}
        />
      )}
      {untimed.length > 0 && <UntimedSection feed={feed} rows={untimed} onOpen={onOpen} />}
    </div>
  )
}

/** Lines that go there but have no published timetable, so they have no times to list. */
function UntimedSection({ feed, rows, onOpen }) {
  const words = wordsFor(feed)
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-bold">No timetable published</h2>
        <span className="text-xs text-ink-soft">Track live on board</span>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        {rows.map((r, i) => (
          <li key={r.tripId} className="card-in" style={stagger(i)}>
            <a
              href={`#/${feed.id}/bus/${r.service.serviceId}/${encodeURIComponent(r.tripId)}`}
              onClick={() => onOpen(feed.id, r.service)}
              className="press flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <ServicePlate metro={isMetro(feed)} service={r.service} />
                  <span className="truncate text-sm font-semibold">to {r.service.to}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-soft">
                  {formatKm(r.km)} · from {r.boardStop}
                  <PlatformChip platform={r.boardPlatform} />
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-ink-soft">See {words.stops}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
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
          const metro = isMetro(feed)
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
                    {!feed.numbersAreCodes && <ServicePlate metro={metro} service={r.service} />}
                    <span className="truncate text-sm font-semibold">{feed.numbersAreCodes ? label : `to ${r.service.to}`}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-soft">
                    {formatDuration(r.minutes)} · {formatKm(r.km)}
                    {r.boardStop && ` · from ${r.boardStop}`}
                    <PlatformChip platform={r.boardPlatform} />
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

function StopInput({ feedId, words, label, value, onChange, onListOpen }) {
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
          placeholder={words.stopPlaceholder}
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
          {error && !loading && <li className="px-4 py-3 text-sm text-ink-soft">Couldn't load {words.stops}. Check your connection and try again.</li>}
          {!loading && !error && suggestions.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-soft">
              No {words.stops} found for “{q}”. Check the spelling, or try a nearby landmark.
            </li>
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
