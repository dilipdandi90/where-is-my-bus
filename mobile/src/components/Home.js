import { router } from 'expo-router'
import { useEffect, useEffectEvent, useState } from 'react'
import { ActivityIndicator, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../lib/api.js'
import { useData, useDebounced, useTick } from '../lib/hooks.js'
import { CACHE_MS, count, defaultDeparture, formatClock, formatDuration, formatKm, isMetro, nextDepartureSec, secondsNow, wordsFor } from '../lib/shared.js'
import { prefetchData, useStoredState } from '../lib/storage.js'
import { colors } from '../lib/theme.js'
import { BusIcon, ErrorMessage, Message, PlatformChip, Press, SearchIcon, Segmented, ServicePlate, SwapIcon, TrainIcon } from './ui.js'

const FEEDS_POLL_MS = 3000
const CACHE_SEARCH_MS = 30 * 60 * 1000
const CACHE_STOPS_MS = 12 * 3600 * 1000

const openService = (feedId, serviceId, tripId) =>
  router.push({ pathname: '/bus/[feed]/[service]', params: { feed: feedId, service: serviceId, ...(tripId ? { trip: tripId } : {}) } })

/** The feed list, asked for again until every feed has loaded, as the server loads them one by one. */
function useFeeds() {
  // The last list shows at once, so the app doesn't sit on "Connecting…" while a sleeping server wakes.
  const { data, error, refreshing, retry } = useData('feeds', (signal) => api.feeds(signal), { cacheMs: 7 * 24 * 3600 * 1000 })
  const settled = !refreshing && data?.every((f) => f.status === 'READY')
  const again = useEffectEvent(retry)
  useEffect(() => {
    if (settled) return undefined
    const id = setTimeout(again, FEEDS_POLL_MS)
    return () => clearTimeout(id)
  }, [settled, data, error])
  return { feeds: data, error }
}

export default function Home() {
  const insets = useSafeAreaInsets()
  const { feeds, error } = useFeeds()
  const [storedFeedId, setFeedId] = useStoredState('wimb.feed', null)
  const [tab, setTab] = useState('number')
  const feed = feeds?.find((f) => f.id === storedFeedId) ?? feeds?.[0]
  const words = wordsFor(feed)

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <BusIcon size={24} color={colors.road} />
          <Text style={styles.title}>Where Is My Bus</Text>
        </View>
        <Text style={styles.tagline}>Live bus and metro tracking, with no GPS needed on board.</Text>
        {feeds && <FeedPicker feeds={feeds} selected={feed} onSelect={setFeedId} />}
      </View>

      {error && !feeds && <ErrorMessage title="We can't connect right now" error={{ message: "Check your internet. We'll keep trying." }} />}
      {!error && !feeds && <Message title="Connecting…" />}

      {feed && (
        <View style={{ padding: 16 }}>
          <Segmented
            options={[
              { value: 'number', label: words.searchTab },
              { value: 'between', label: words.betweenTab },
            ]}
            value={tab}
            onChange={setTab}
          />
          <View style={{ height: 12 }} />
          {feed.status === 'LOADING' && <Message title={`Getting ${feed.name} timetable…`}>The server is starting up after a quiet spell. This can take a few minutes.</Message>}
          {feed.status === 'FAILED' && <ErrorMessage title={`${feed.name} isn't available right now`} error={{ message: "We'll keep trying, so check back in a few minutes." }} />}
          {feed.status === 'READY' && (tab === 'number' ? <ServiceSearch key={feed.id} feed={feed} /> : <BetweenSearch key={feed.id} feed={feed} />)}
          <FeedNotice feed={feed} />
        </View>
      )}
    </ScrollView>
  )
}

/** The first place in the name, or the operator when the name is long ("MSRTC"), as on the website. */
function shortName(feed) {
  const place = feed.name.split(/[,&]/)[0].trim()
  return place.length <= 10 ? place : feed.operators.split(',')[0].trim()
}

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
  // Set when the server has nothing for the tapped mode, so the tap visibly does something.
  const [missing, setMissing] = useState(null)
  const switchTo = (toMetro) => {
    if (toMetro === metro) return
    const list = toMetro ? metroFeeds : busFeeds
    if (list.length === 0) {
      setMissing(toMetro ? 'Metro' : 'Bus')
      return
    }
    setMissing(null)
    if (selected) (metro ? setLastMetro : setLastBus)(selected.id)
    const remembered = list.find((f) => f.id === (toMetro ? lastMetro : lastBus))
    pick(remembered ?? list[0])
  }

  return (
    <View style={{ marginTop: 14 }}>
      <Segmented
        dark
        value={metro}
        onChange={switchTo}
        options={[
          { value: false, label: 'Bus', icon: (c) => <BusIcon size={20} color={c} /> },
          { value: true, label: 'Metro', icon: (c) => <TrainIcon size={20} color={c} /> },
        ]}
      />
      {shown.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }} accessibilityRole="radiogroup">
          {shown.map((f) => {
            const on = f.id === selected?.id
            return (
              <Press key={f.id} onPress={() => pick(f)} accessibilityRole="radio" accessibilityLabel={f.name} accessibilityState={{ checked: on }} style={[styles.region, on && { backgroundColor: colors.road }]}>
                <Text style={[styles.regionText, on && { color: colors.ink }]} numberOfLines={1}>
                  {shortName(f)}
                </Text>
              </Press>
            )
          })}
        </View>
      )}
      {missing && (
        <Text style={styles.missing}>
          {`${missing} timetables aren't available from the server yet. Please try again later.`}
        </Text>
      )}
      {selected && (
        <Text style={styles.selected} numberOfLines={1}>
          <Text style={{ fontWeight: '600', color: colors.paper }}>{selected.name}</Text> · {selected.operators}
        </Text>
      )}
    </View>
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <View style={styles.searchBox}>
      <SearchIcon size={20} color={colors.inkSoft} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="rgba(86,96,121,0.7)" style={styles.searchInput} autoCorrect={false} returnKeyType="search" />
    </View>
  )
}

function ServiceSearch({ feed }) {
  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim(), 250)
  const metro = isMetro(feed)
  const words = wordsFor(feed)
  // A metro has only a few lines, so all show before anything is typed. Every line's name ends in "Line".
  const lookup = q || (metro ? 'line' : '')
  // Metro lines are built into the server, so the list is kept for a week; next trains are worked out
  // from each line's saved timetable (see MetroDirection).
  const { data, error, loading, retry } = useData(lookup ? `bus|${feed.id}|${lookup}` : null, (signal) => api.buses(feed.id, lookup, signal), {
    cacheMs: metro ? CACHE_MS.metro : CACHE_SEARCH_MS,
  })

  return (
    <View>
      <SearchBox value={query} onChange={setQuery} placeholder={feed.id === 'msrtc' ? 'Town name, such as Solapur' : words.searchPlaceholder} />
      {lookup && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {lookup && loading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.inkSoft} />}
      {q && data?.length === 0 && (
        <Message title={`No ${words.buses} found for “${q}”`}>{metro ? 'Try a line number or colour, such as 1 or Aqua.' : 'Try part of the number, or a place on the route.'}</Message>
      )}
      {lookup && data?.length > 0 && (metro ? <MetroLines feed={feed} services={data} /> : data.map((s) => <ServiceCard key={s.serviceId} feed={feed} service={s} />))}
    </View>
  )
}

function ServiceCard({ feed, service: s }) {
  const words = wordsFor(feed)
  return (
    <Press onPress={() => openService(feed.id, s.serviceId)} style={styles.card}>
      {!feed.numbersAreCodes && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <ServicePlate service={s} />
          {s.operator ? <Text style={styles.small}>{s.operator}</Text> : null}
        </View>
      )}
      <Text style={styles.route}>
        {s.from} <Text style={{ color: colors.inkSoft }}>→</Text> {s.to}
      </Text>
      {feed.numbersAreCodes && <Text style={styles.small}>{s.operator} · Route code {s.number}</Text>}
      <Text style={[styles.small, { marginTop: 4 }]}>
        {s.stops} {words.stops} · {formatKm(s.km)}
        {s.timetabled !== false && ` · about ${formatDuration(s.typicalMinutes)}`}
      </Text>
      <Text style={[styles.small, s.busesRunning > 0 && { color: colors.ontime, fontWeight: '600' }]}>
        {s.busesRunning > 0
          ? `${count(words, s.busesRunning)} running now`
          : s.departuresToday === 0
            ? 'No departures listed today'
            : s.nextDepartureSec != null
              ? `Next at ${formatClock(s.nextDepartureSec)} · ${s.departuresToday} today`
              : 'No more in our timetable today'}
      </Text>
    </Press>
  )
}

/** One card per metro line in its colour, with a strip map and a button for each direction. */
function MetroLines({ feed, services }) {
  const lines = new Map()
  for (const s of services) lines.set(s.number, [...(lines.get(s.number) ?? []), s])
  const ordered = [...lines.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  return ordered.map(([number, directions]) => {
    const line = directions[0]
    const colour = `#${line.color || '566079'}`
    const onColour = `#${line.textColor || 'FFFFFF'}`
    return (
      <View key={number} style={styles.lineCard}>
        <View style={[styles.lineHead, { backgroundColor: colour }]}>
          <View style={[styles.lineBadge, { backgroundColor: onColour }]}>
            <Text style={{ color: colour, fontWeight: '900', fontSize: 18 }}>{line.number}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: onColour, fontWeight: '800', fontSize: 18 }}>{line.label}</Text>
            <Text style={{ color: onColour, opacity: 0.85, fontSize: 12, fontWeight: '500' }}>
              Line {line.number}
              {line.operator ? ` · ${line.operator}` : ''}
            </Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
            <View style={[styles.stripEnd, { borderColor: colour }]} />
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colour }} />
            <View style={[styles.stripEnd, { borderColor: colour }]} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={styles.endName} numberOfLines={1}>{line.from}</Text>
            <Text style={[styles.endName, { textAlign: 'right' }]} numberOfLines={1}>{line.to}</Text>
          </View>
          <Text style={[styles.small, { textAlign: 'center', marginTop: 6 }]}>
            {line.stops} stations · {formatKm(line.km)}
            {line.timetabled !== false && ` · about ${formatDuration(line.typicalMinutes)} end to end`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
          {directions.map((s) => (
            <MetroDirection key={s.serviceId} feed={feed} service={s} colour={colour} />
          ))}
        </View>
      </View>
    )
  })
}

/**
 * One direction of a metro line. Its timetable is loaded and saved here, for a week, so the next train
 * is worked out on the phone (right even from an old copy or offline) and the line opens at once when
 * tapped. The train that screen will show first is saved too.
 */
function MetroDirection({ feed, service: s, colour }) {
  useTick(30_000)
  const { data: detail } = useData(`svc|${feed.id}|${s.serviceId}`, (signal) => api.service(feed.id, s.serviceId, signal), { cacheMs: CACHE_MS.metro })
  const nowSec = secondsNow(feed.timezone ?? 'Asia/Kolkata')
  const firstTripId = detail ? (detail.untimedTripId ?? defaultDeparture(detail.departures, nowSec)?.tripId) : null
  const next = detail ? nextDepartureSec(detail.departures, nowSec) : s.nextDepartureSec

  useEffect(() => {
    if (firstTripId) prefetchData(`trip|${feed.id}|${firstTripId}`, () => api.trip(feed.id, firstTripId), CACHE_MS.metro)
  }, [feed.id, firstTripId])

  return (
    <Press onPress={() => openService(feed.id, s.serviceId)} style={[styles.direction, { borderColor: `${colour}73`, backgroundColor: `${colour}12` }]}>
      <Text style={styles.towards}>TOWARDS</Text>
      <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={1}>
        {s.to}
      </Text>
      <Text style={[styles.small, { marginTop: 4 }]}>{s.timetabled === false ? 'Track live on board' : next != null ? `Next ${formatClock(next)}` : 'No more trains today'}</Text>
    </Press>
  )
}

function BetweenSearch({ feed }) {
  const words = wordsFor(feed)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState(null)
  const key = search && `${feed.id}|${search.from}|${search.to}`
  const { data, error, loading, retry } = useData(key && `btw|${key}`, (signal) => api.between(feed.id, search.from, search.to, signal), { cacheMs: CACHE_SEARCH_MS })

  return (
    <View>
      <View>
        <StopInput feed={feed} label="From" value={from} onChange={setFrom} />
        <View style={{ height: 8 }} />
        <StopInput feed={feed} label="To" value={to} onChange={setTo} />
        <Press
          onPress={() => {
            setFrom(to)
            setTo(from)
          }}
          accessibilityLabel="Swap from and to"
          style={styles.swap}
        >
          <SwapIcon size={18} color={colors.inkSoft} />
        </Press>
      </View>
      <Text style={[styles.small, { marginTop: 8, marginLeft: 4 }]}>Type each {words.stop}, then pick it from the list.</Text>
      <Press
        disabled={!from.trim() || !to.trim()}
        onPress={() => {
          Keyboard.dismiss()
          setSearch({ from: from.trim(), to: to.trim() })
        }}
        style={[styles.find, (!from.trim() || !to.trim()) && { opacity: 0.4 }]}
      >
        <Text style={{ color: colors.paper, fontWeight: '600', fontSize: 16 }}>Find {words.buses}</Text>
      </Press>
      {search && loading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.inkSoft} />}
      {search && error && <ErrorMessage title="Search didn't work" error={error} onRetry={retry} />}
      {search && data?.length === 0 &&
        (isMetro(feed) ? (
          <Message title="No direct line between these stations">You may need to change lines, for example at District Court.</Message>
        ) : (
          <Message title="No direct bus between these stops">You may need to change buses. Try a major stop nearby, or search for a bus number.</Message>
        ))}
      {data?.length > 0 && <Timetable feed={feed} rows={data} />}
    </View>
  )
}

function StopInput({ feed, label, value, onChange }) {
  const words = wordsFor(feed)
  const [open, setOpen] = useState(false)
  const q = useDebounced(value.trim(), 200)
  const active = open && q.length > 0
  const { data, loading } = useData(active ? `stop|${feed.id}|${q}` : null, (signal) => api.stops(feed.id, q, signal), { cacheMs: CACHE_STOPS_MS })
  const suggestions = (data ?? []).filter((s) => s.name !== value)

  return (
    <View style={{ zIndex: open ? 10 : 1 }}>
      <View style={styles.stopBox}>
        <Text style={styles.stopLabel}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={(t) => {
            onChange(t)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={words.stopPlaceholder}
          placeholderTextColor="rgba(86,96,121,0.7)"
          style={styles.searchInput}
          autoCorrect={false}
          accessibilityLabel={label}
        />
        {active && loading && <ActivityIndicator size="small" color={colors.inkSoft} />}
      </View>
      {active && suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.slice(0, 8).map((s) => (
            <Press
              key={s.name}
              onPress={() => {
                onChange(s.name)
                setOpen(false)
              }}
              style={styles.suggestion}
            >
              <Text style={{ color: colors.ink }}>{s.name}</Text>
            </Press>
          ))}
        </View>
      )}
      {active && !loading && data && suggestions.length === 0 && (
        <View style={styles.suggestions}>
          <Text style={[styles.small, { padding: 12 }]}>No {words.stops} found for “{q}”.</Text>
        </View>
      )}
    </View>
  )
}

/** A day's departures between two stops, like a station departure board. */
function Timetable({ feed, rows }) {
  useTick(30_000)
  const words = wordsFor(feed)
  const metro = isMetro(feed)
  const nowSec = secondsNow(feed.timezone ?? 'Asia/Kolkata')
  const untimed = rows.filter((r) => r.untimed)
  const today = rows.filter((r) => !r.tomorrow && !r.untimed)
  const tomorrow = rows.filter((r) => r.tomorrow && !r.untimed)
  const nextIndex = today.findIndex((r) => !r.departed)
  const leftToday = today.filter((r) => !r.departed).length

  const section = (title, subtitle, list, next) => (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{title}</Text>
        {subtitle ? <Text style={styles.small}>{subtitle}</Text> : null}
      </View>
      <View style={styles.board}>
        {list.map((r, i) => {
          const onTheWay = r.departed && r.alightSec > nowSec
          const gone = r.departed && !onTheWay
          return (
            <Press key={`${r.tripId}-${r.tomorrow}`} onPress={() => openService(feed.id, r.service.serviceId, r.tripId)} style={[styles.boardRow, i === next && { backgroundColor: colors.tint }, gone && { opacity: 0.55 }, i > 0 && styles.divider]}>
              <View style={{ width: 56 }}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{formatClock(r.boardSec)}</Text>
                <Text style={styles.small}>→ {formatClock(r.alightSec)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {!feed.numbersAreCodes && <ServicePlate metro={metro} service={r.service} />}
                  <Text style={{ fontWeight: '600', color: colors.ink, flexShrink: 1 }} numberOfLines={1}>
                    {feed.numbersAreCodes ? r.service.to : `to ${r.service.to}`}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Text style={styles.small} numberOfLines={1}>
                    {formatDuration(r.minutes)} · {formatKm(r.km)} · from {r.boardStop}
                  </Text>
                  <PlatformChip platform={r.boardPlatform} />
                </View>
              </View>
              <Text style={[styles.small, { fontWeight: '600' }, onTheWay && { color: colors.ontime }]}>{onTheWay ? 'On the way' : gone ? 'Reached' : i === next ? 'Next' : ''}</Text>
            </Press>
          )
        })}
      </View>
    </View>
  )

  return (
    <View>
      {today.length > 0 && section(`Today · ${count(words, today.length)}`, leftToday === 0 ? 'All have left for today' : `${leftToday} still to go`, today, nextIndex)}
      {tomorrow.length > 0 && section(`Tomorrow · ${count(words, tomorrow.length)}`, null, tomorrow, leftToday === 0 ? 0 : -1)}
      {untimed.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 6, paddingHorizontal: 4 }}>No timetable published</Text>
          <View style={styles.board}>
            {untimed.map((r, i) => (
              <Press key={r.tripId} onPress={() => openService(feed.id, r.service.serviceId, r.tripId)} style={[styles.boardRow, i > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ServicePlate metro={metro} service={r.service} />
                    <Text style={{ fontWeight: '600', color: colors.ink }}>to {r.service.to}</Text>
                  </View>
                  <Text style={styles.small}>
                    {formatKm(r.km)} · from {r.boardStop}
                  </Text>
                </View>
                <Text style={styles.small}>Track live</Text>
              </Press>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

/** The feed's source and its known limits, as on the website. */
export function FeedNotice({ feed }) {
  return (
    <View style={styles.notice}>
      {feed.note ? <Text style={[styles.small, { marginBottom: 6 }]}>{feed.note}</Text> : null}
      {feed.hasLiveBuses && <Text style={[styles.small, { marginBottom: 6 }]}>{"Live positions don't cover every bus."}</Text>}
      {/* <Text style={styles.small}>
        Data: {feed.source}
        {feed.official ? '' : ' (unofficial)'}
      </Text> */}
    </View>
  )
}

const styles = StyleSheet.create
({
  header: { backgroundColor: colors.header, paddingHorizontal: 20, paddingBottom: 16 },
  title: { color: colors.paper, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  tagline: { color: 'rgba(242,245,251,0.7)', fontSize: 12, marginTop: 2 },
  region: { flex: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 6, alignItems: 'center', backgroundColor: 'rgba(242,245,251,0.1)' },
  regionText: { color: 'rgba(242,245,251,0.85)', fontSize: 12, fontWeight: '600' },
  missing: { marginTop: 10, borderRadius: 10, padding: 10, backgroundColor: 'rgba(255,138,43,0.18)', color: colors.paper, fontSize: 13, textAlign: 'center' },
  selected: { marginTop: 8, textAlign: 'center', fontSize: 12, color: 'rgba(242,245,251,0.7)' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  searchInput: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.ink },
  card: { marginTop: 10, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14 },
  route: { fontWeight: '600', fontSize: 15, color: colors.ink },
  small: { fontSize: 12, color: colors.inkSoft },
  lineCard: { marginTop: 16, backgroundColor: colors.card, borderRadius: 24, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  lineBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stripEnd: { width: 16, height: 16, borderRadius: 8, borderWidth: 4, backgroundColor: colors.card },
  endName: { flex: 1, fontWeight: '600', fontSize: 14, color: colors.ink },
  direction: { flex: 1, borderWidth: 2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  towards: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, color: colors.inkSoft },
  stopBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 16, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 14 },
  stopLabel: { width: 36, fontSize: 12, fontWeight: '600', color: colors.inkSoft },
  swap: { position: 'absolute', right: 12, top: 44, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  suggestions: { marginTop: 6, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, elevation: 6 },
  suggestion: { paddingHorizontal: 16, paddingVertical: 12 },
  find: { marginTop: 8, backgroundColor: colors.ink, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  board: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  notice: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
})
