// Joins the pages read from TAG 2026 into whole trains: train numbers and running days, stations
// matched to real codes and map positions, each train's pieces from different tables merged into one
// route, and day numbers for trains running past midnight.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Downloaded pages, the book's text and intermediate results. Not committed (see .gitignore).
const R = fileURLToPath(new URL('./work/', import.meta.url))
const pagesText = JSON.parse(readFileSync(R + 'pages.json', 'utf8'))
const tagCodes = new Map(JSON.parse(readFileSync(R + 'station-codes.json', 'utf8')))
const dm = JSON.parse(readFileSync(R + 'stations.json', 'utf8')).features

// ---------- Text matching ----------

const norm = (s) =>
  s
    .toUpperCase()
    .replace(/\bJN\b\.?|\bJUNCTION\b|\bJ\.N\./g, '')
    .replace(/\(T\)|\bTERMINUS\b|\bTERMINAL\b/g, 'T')
    .replace(/[^A-Z0-9]/g, '')

/** Edit distance (Levenshtein), with one row of memory. */
function editDistance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

const trigrams = (s) => {
  const p = `  ${s} `
  const out = new Set()
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3))
  return out
}

/**
 * Finds the closest known name to a misread one. A trigram index shortlists names sharing several
 * three-letter pieces, so only a few dozen get the full edit-distance check instead of all 9,000.
 */
class Matcher {
  constructor(entries) {
    this.entries = entries
    this.index = new Map()
    entries.forEach((e, i) => {
      for (const t of trigrams(e.key)) {
        if (!this.index.has(t)) this.index.set(t, [])
        this.index.get(t).push(i)
      }
    })
  }
  best(name) {
    // The first row's name often carries the "Km 0" heading with it.
    const key = norm(name.replace(/^\s*Km\.?\s*\d*\s*/i, ''))
    if (!key) return null
    const counts = new Map()
    for (const t of trigrams(key)) for (const i of this.index.get(t) ?? []) counts.set(i, (counts.get(i) ?? 0) + 1)
    const shortlist = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40)
    let best = null
    for (const [i] of shortlist) {
      const d = editDistance(key, this.entries[i].key)
      if (!best || d < best.d) best = { d, e: this.entries[i] }
    }
    // Close enough: at most about one wrong letter in four.
    return best && best.d <= Math.max(1, Math.floor(key.length / 4)) ? best.e : null
  }
}

// Every known station with its current code and position. OpenStreetMap comes first, as it has
// today's codes and names (Mumbai CSMT, Kalaburagi, Prayagraj…); DataMeet's 2016 list fills gaps.
const osm = JSON.parse(readFileSync(R + 'osm-stations.json', 'utf8')).elements
const byCode = new Map()
for (const e of osm) {
  const code = (e.tags.ref ?? '').split(/[;,]/)[0].trim().toUpperCase()
  const lat = e.lat ?? e.center?.lat
  const lon = e.lon ?? e.center?.lon
  const name = e.tags['name:en'] || e.tags.name
  if (/^[A-Z]{1,5}$/.test(code) && lat && name && !byCode.has(code)) byCode.set(code, { code, name, lat, lon })
}
for (const f of dm) {
  const p = f.properties
  if (p.code && f.geometry?.coordinates && !byCode.has(p.code)) byCode.set(p.code, { code: p.code, name: p.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })
}
const entries = []
// The book's own index names map to codes; positions come from byCode.
for (const [name, code] of tagCodes) if (byCode.has(code)) entries.push({ key: norm(name), name, code })
for (const s of byCode.values()) entries.push({ key: norm(s.name), name: s.name, code: s.code })
// Official names the book uses that neither list spells the same way. Each is only used when the
// code is in the current list, so nothing is placed without a real position.
const ALIASES = {
  BANARAS: 'BSBS',
  'SSS HUBBALLI': 'UBL',
  'SRI SATHYA SAI PRASHANTI NILAYAM': 'SSPN',
  'NETAJI SUBHASH CHANDRA BOSE GOMOH': 'GMO',
  'NSCB GOMOH': 'GMO',
  'NSCB ITWARI': 'ITR',
  'MAA BELHA DEVI DHAM PRATAPGARH': 'PBH',
  'VIRANGANA LAKSHMIBAI': 'VGLJ',
  'DAUND CHORD': 'DDCC',
}
for (const [name, code] of Object.entries(ALIASES)) if (byCode.has(code)) entries.push({ key: norm(name), name, code })
const stations = new Matcher(entries)

// ---------- Official train names ----------

/**
 * The book's train index lists each train by name and number, such as "Hutatma Exp 12157/12158 Pune
 * Solapur 10", in its exact text, so names come from there rather than from reading table headers.
 */
const indexNames = new Map()
for (const text of pagesText) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z][A-Za-z .&'()-]*?(?:Exp|Express|Mail|Rajdhani|Shatabdi|Duronto|Humsafar|Garib Rath|Vande Bharat|Jan Shatabdi|Tejas|Antyodaya|Passenger|Special)\.?)\s+(\d{5})(?:\/(\d{5}))?\s/)
    if (!m) continue
    // The book's text sometimes has a lower-case l for a capital I at the start of a word ("lndrayani").
    const name = m[1].replace(/\bExp\b\.?/g, 'Express').replace(/\bl(?=[a-z])/g, 'I').replace(/\s+/g, ' ').trim()
    for (const n of [m[2], m[3]]) if (n && !indexNames.has(n)) indexNames.set(n, name)
  }
}

// OpenStreetMap names sometimes carry a suffix riders don't say.
const cleanStation = (name) => name.replace(/\s+(railway\s+)?station$/i, '').trim()

// ---------- Running days ----------

const DAY_NAMES = [['M', 'MO', 'MON'], ['TU', 'TUE'], ['W', 'WE', 'WED'], ['TH', 'THU'], ['F', 'FR', 'FRI'], ['SA', 'SAT'], ['SU', 'SUN']]
const dayIndex = (t) => DAY_NAMES.findIndex((names) => names.includes(t))

/** "Daily", "Except Tu", "Tu, F", "M W F" to a bit per weekday (bit 0 Monday), or null if unclear. */
function parseDays(text) {
  const t = (text ?? '').toUpperCase().replace(/[^A-Z,\s]/g, ' ')
  if (editDistance(t.replace(/\s/g, ''), 'DAILY') <= 1) return 0b1111111
  const tokens = t.split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return null
  const except = editDistance(tokens[0], 'EXCEPT') <= 2
  let mask = 0
  for (const tok of except ? tokens.slice(1) : tokens) {
    const d = dayIndex(tok)
    if (d < 0) return null
    mask |= 1 << d
  }
  if (!mask) return null
  return except ? 0b1111111 & ~mask : mask
}

// ---------- Pages to train pieces ----------

const toSec = (t) => (/^\d\d\.\d\d$/.test(t) ? Number(t.slice(0, 2)) * 3600 + Number(t.slice(3)) * 60 : null)

/** The page's train numbers from its exact text, in column order, when the count matches. */
function numbersFromText(text, columns, read) {
  const m = text.match(/Train\s+Number\s+([\d\s]+)/)
  const exact = m ? m[1].trim().split(/\s+/).filter((n) => /^\d{5}$/.test(n)) : []
  if (exact.length === columns) return exact
  // Otherwise each misread number is replaced by the closest exact one, if any is close.
  return read.map((n) => {
    const d = exact.map((e) => [e, editDistance(n.replace(/\D/g, ''), e)]).sort((a, b) => a[1] - b[1])[0]
    return d && d[1] <= 1 ? d[0] : /^\d{5}$/.test(n) ? n : null
  })
}

/**
 * The station names printed on a page, in order, from its exact text: the lines between the header
 * ("Days of departure…") and the footer ("Days of arrival…"), less km figures, times and the a/d
 * markers. Neighbouring lines are joined too, for names printed on two lines.
 */
function textStations(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /originating\s+station/i.test(l))
  const end = lines.findIndex((l, i) => i > start && /Days\s+of\s+arrival/i.test(l))
  const names = []
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const name = line
      .replace(/\d{1,2}[.:]\d{2}|\.{2,}|…/g, ' ')
      .replace(/^\s*Km\.?\s*\d*\s*/i, '')
      .replace(/^\s*\d+\s+/, '')
      .replace(/\s+[ad]\s*$/i, '')
      .replace(/^\s*[ad]\s+/i, '')
      .trim()
    if (/[A-Za-z]{3,}/.test(name)) names.push(name)
  }
  return names
}

const ratio = (a, b) => editDistance(norm(a), norm(b)) / Math.max(1, norm(b).length)

/**
 * Replaces each misread station name with the page's exact one. Rows and names come in the same
 * order, so each row is matched to the closest of the next few names, and the search moves on from
 * there. A row with no close name keeps what was read.
 */
function alignNames(rows, names) {
  let from = 0
  for (const row of rows) {
    let best = null
    for (let j = from; j < Math.min(names.length, from + 6); j++) {
      for (const candidate of [names[j], j + 1 < names.length ? `${names[j]} ${names[j + 1]}` : null]) {
        if (!candidate) continue
        const r = ratio(row.s.name, candidate)
        if (!best || r < best.r) best = { r, j, candidate }
      }
    }
    if (best && best.r <= 0.5) {
      row.exact = best.candidate
      from = best.j + 1
    }
  }
}

// Footer and header rows that slipped in as stations.
const NOT_A_STATION = /arrival|destination|departure|originat|\bTable\b|Tabie|accommod/i

const unmatchedNames = new Map()
const pieces = new Map() // train number → [{page, name, days, stops}]
const files = readdirSync(R + 'out').filter((f) => /^p\d+\.json$/.test(f))
let pagesUsed = 0
for (const f of files) {
  const page = JSON.parse(readFileSync(R + 'out/' + f, 'utf8'))
  if (!page.header?.number || !page.stations?.length) continue
  pagesUsed++
  const numbers = numbersFromText(pagesText[page.page - 1], page.columns, page.header.number)
  const rows = page.stations.filter((s) => !NOT_A_STATION.test(s.name)).map((s) => ({ s, km: Number(s.km) || null }))
  alignNames(rows, textStations(pagesText[page.page - 1]))
  for (const row of rows) {
    const name = row.exact ?? row.s.name
    row.hit = stations.best(name)
    if (!row.hit && name) unmatchedNames.set(name, (unmatchedNames.get(name) ?? 0) + 1)
  }
  numbers.forEach((number, c) => {
    if (!number) return
    const stops = []
    for (const { hit, s } of rows) {
      const lines = (s.cells[c] ?? []).filter((v) => /^\d\d\.\d\d$/.test(v))
      if (!lines.length || !hit) continue
      const arr = toSec(lines[0])
      const dep = toSec(lines[lines.length - 1])
      const place = byCode.get(hit.code)
      if (!place) continue
      stops.push({ code: hit.code, name: cleanStation(place.name), lat: place.lat, lon: place.lon, arr, dep })
    }
    if (stops.length < 1) return
    if (!pieces.has(number)) pieces.set(number, [])
    pieces.get(number).push({ page: page.page, name: page.header.name?.[c] ?? '', days: parseDays(page.header.days?.[c]), stops })
  })
}

// ---------- Pieces to whole trains ----------

/**
 * Merges a train's pieces into one route. Each piece lists stations in travel order, so consecutive
 * stations give "comes before" edges; a topological sort (Kahn's algorithm) orders every station,
 * breaking ties by time of day. Then day numbers are added wherever the time wraps past midnight.
 */
function mergeRoute(list) {
  const stop = new Map()
  const after = new Map()
  const indegree = new Map()
  for (const p of list) {
    p.stops.forEach((s, i) => {
      if (!stop.has(s.code)) {
        stop.set(s.code, { ...s })
        after.set(s.code, new Set())
        indegree.set(s.code, 0)
      }
      const prev = p.stops[i - 1]
      if (prev && prev.code !== s.code && !after.get(prev.code).has(s.code)) {
        after.get(prev.code).add(s.code)
        indegree.set(s.code, indegree.get(s.code) + 1)
      }
    })
  }
  const ready = [...indegree].filter(([, d]) => d === 0).map(([c]) => c)
  const order = []
  while (ready.length) {
    ready.sort((a, b) => (stop.get(a).dep ?? 0) - (stop.get(b).dep ?? 0))
    const c = ready.shift()
    order.push(c)
    for (const n of after.get(c)) {
      indegree.set(n, indegree.get(n) - 1)
      if (indegree.get(n) === 0) ready.push(n)
    }
  }
  // A cycle means two pieces disagree on the order; such a train is left out rather than guessed.
  if (order.length !== stop.size) return null
  let day = 0
  let last = -1
  return order.map((c) => {
    const s = stop.get(c)
    const arrDay = s.arr < last ? ++day : day
    if (s.arr < last) last = -1
    const depDay = s.dep < s.arr ? ++day : day
    last = s.dep
    return { ...s, arr: s.arr + arrDay * 86400, dep: s.dep + depDay * 86400 }
  })
}

const trains = []
let leftOut = 0
for (const [number, list] of pieces) {
  const route = mergeRoute(list)
  if (!route || route.length < 2) {
    leftOut++
    continue
  }
  const days = list.map((p) => p.days).filter((d) => d != null)
  // The index's official name; a table header's (as read) only for trains missing from the index.
  const name = indexNames.get(number) ?? list.map((p) => p.name).sort((a, b) => b.length - a.length)[0].replace(/\s+/g, ' ').trim()
  trains.push({ number, name, days: days[0] ?? 0b1111111, pages: list.map((p) => p.page), stops: route })
}
trains.sort((a, b) => a.number.localeCompare(b.number))
writeFileSync(R + 'trains.json', JSON.stringify(trains))

const placed = trains.reduce((n, t) => n + t.stops.length, 0)
console.log(`pages used ${pagesUsed} | trains ${trains.length} (${leftOut} left out) | stops ${placed}`)
console.log(`station names not matched: ${[...unmatchedNames].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n} (${c})`).join(', ')}`)
const fmt = (s) => `${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${s >= 86400 ? ` (day ${Math.floor(s / 86400) + 1})` : ''}`
for (const n of process.argv.slice(2)) {
  const t = trains.find((x) => x.number === n)
  if (!t) {
    console.log(`\n${n}: not found yet`)
    continue
  }
  console.log(`\n${t.number} ${t.name} | days ${t.days.toString(2).padStart(7, '0').split('').reverse().join('')} | pages ${t.pages.join(',')}`)
  for (const s of t.stops) console.log(`  ${s.code.padEnd(5)} ${s.name.padEnd(22)} ${fmt(s.arr)} → ${fmt(s.dep)}`)
}
