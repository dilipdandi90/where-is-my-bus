// Finds the stations each train passes without stopping, as Where Is My Train lists them.
//
// The OpenStreetMap track (fetch-track.mjs) becomes a graph. Each station is tied to the track
// nodes beside it. For every pair of consecutive stops, A* finds the shortest way along the track,
// and the stations tied to nodes on that way are the ones passed, in order, with how far along.
// A pair with no believable way along the track (missing track, a detour far longer than the
// straight line) gets no passing stations rather than guessed ones.
//
// Writes rail/passing.json: { "PUNE|DD": [{ code, name, lat, lon, fraction }] }
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const R = fileURLToPath(new URL('./work/', import.meta.url))
const STATION_REACH_KM = 0.15 // a station's own tracks run within this distance of its point
const STOP_REACH_KM = 1.5 // a stop must be at least this close to some track to be routed
const MAX_DETOUR = 1.9 // a way along the track longer than this times the straight line is wrong

const rad = Math.PI / 180
function km(lat1, lon1, lat2, lon2) {
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

// ---------- Track nodes and their neighbours ----------

const index = new Map() // OSM node id -> our index
let lat = new Float64Array(1 << 20)
let lon = new Float64Array(1 << 20)
const pairs = [] // flat [a, b, a, b…] edges between consecutive nodes of a way
const grow = (a) => {
  const b = new Float64Array(a.length * 2)
  b.set(a)
  return b
}
for (const f of readdirSync(R + 'track').filter((f) => f.endsWith('.json'))) {
  const { nodes, ways } = JSON.parse(readFileSync(R + 'track/' + f, 'utf8'))
  const local = (id) => {
    let i = index.get(id)
    if (i === undefined) {
      const p = nodes[id]
      if (!p) return -1
      i = index.size
      if (i >= lat.length) {
        lat = grow(lat)
        lon = grow(lon)
      }
      lat[i] = p[0]
      lon[i] = p[1]
      index.set(id, i)
    }
    return i
  }
  for (const way of ways) {
    let prev = -1
    for (const id of way) {
      const i = local(String(id))
      if (i >= 0 && prev >= 0 && i !== prev) pairs.push(prev, i)
      prev = i
    }
  }
}
const N = index.size
// Neighbours as compressed rows: node i's neighbours are nbr[start[i] .. start[i + 1]).
const start = new Int32Array(N + 1)
for (let k = 0; k < pairs.length; k++) start[pairs[k] + 1]++
for (let i = 0; i < N; i++) start[i + 1] += start[i]
const nbr = new Int32Array(pairs.length)
const fill = start.slice(0, N)
for (let k = 0; k < pairs.length; k += 2) {
  nbr[fill[pairs[k]]++] = pairs[k + 1]
  nbr[fill[pairs[k + 1]]++] = pairs[k]
}
console.log(`track: ${N} nodes, ${pairs.length / 2} segments`)

// ---------- Stations tied to track nodes ----------

// A grid of 0.01° cells (about 1 km) to find nodes near a point quickly.
const CELL = 0.01
const grid = new Map()
const cellKey = (a, b) => Math.floor(a / CELL) * 100000 + Math.floor(b / CELL)
for (let i = 0; i < N; i++) {
  const k = cellKey(lat[i], lon[i])
  let list = grid.get(k)
  if (!list) grid.set(k, (list = []))
  list.push(i)
}
function nodesNear(la, lo, reachKm) {
  const out = []
  const r = Math.ceil(reachKm / 1.1)
  const ca = Math.floor(la / CELL)
  const cb = Math.floor(lo / CELL)
  for (let a = ca - r; a <= ca + r; a++) {
    for (let b = cb - r; b <= cb + r; b++) {
      for (const i of grid.get(a * 100000 + b) ?? []) {
        const d = km(la, lo, lat[i], lon[i])
        if (d <= reachKm) out.push([i, d])
      }
    }
  }
  return out.sort((x, y) => x[1] - y[1])
}

const osm = JSON.parse(readFileSync(R + 'osm-stations.json', 'utf8')).elements
// Metro and other city lines have their own stations beside the railway's; they aren't passed.
const CITY_LINE = /metro|monorail|light.?rail|subway/i
const stations = new Map() // the code, or the name where OSM gives no code -> { code, name, lat, lon }
for (const e of osm) {
  const t = e.tags ?? {}
  if (!['station', 'halt'].includes(t.railway)) continue
  if (['subway', 'light_rail', 'monorail', 'funicular'].includes(t.station) || t.subway === 'yes' || t.light_rail === 'yes') continue
  // train=yes marks a railway station even where it's also tagged with a metro network (Dapodi).
  if (t.train !== 'yes' && CITY_LINE.test([t.network, t.operator, t.name, t['name:en']].join(' '))) continue
  const ref = (t.ref ?? '').split(/[;,]/)[0].trim().toUpperCase()
  const code = /^[A-Z]{1,5}$/.test(ref) ? ref : ''
  const la = e.lat ?? e.center?.lat
  const lo = e.lon ?? e.center?.lon
  const name = (t['name:en'] || t.name || '').replace(/\s+(railway\s+)?station$/i, '').trim()
  // Plenty of small halts have no code in OpenStreetMap; they're still on the line, by name.
  const key = code || 'name:' + name.toLowerCase()
  if (la && name && !stations.has(key)) stations.set(key, { code, name, lat: la, lon: lo })
}
// Stations by grid cell, to find those beside a stretch of track. Track nodes on a straight stretch
// can be a kilometre apart, so stations are measured against the stretch, not its nodes.
const stationGrid = new Map()
for (const [key, s] of stations) {
  const k = cellKey(s.lat, s.lon)
  let list = stationGrid.get(k)
  if (!list) stationGrid.set(k, (list = []))
  list.push(key)
}
/** Stations within reach of the stretch from node u to node v, with how far along it each is (0–1). */
function stationsBeside(u, v) {
  const out = []
  const pad = Math.ceil(STATION_REACH_KM / 1.1)
  const a0 = Math.floor(Math.min(lat[u], lat[v]) / CELL) - pad
  const a1 = Math.floor(Math.max(lat[u], lat[v]) / CELL) + pad
  const b0 = Math.floor(Math.min(lon[u], lon[v]) / CELL) - pad
  const b1 = Math.floor(Math.max(lon[u], lon[v]) / CELL) + pad
  // Flat x/y in km around u is accurate enough over a few km.
  const kx = 111.32 * Math.cos(lat[u] * rad)
  const vx = (lon[v] - lon[u]) * kx
  const vy = (lat[v] - lat[u]) * 110.57
  const len2 = vx * vx + vy * vy
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      for (const key of stationGrid.get(a * 100000 + b) ?? []) {
        const s = stations.get(key)
        const px = (s.lon - lon[u]) * kx
        const py = (s.lat - lat[u]) * 110.57
        const t = len2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0
        const d = Math.hypot(px - t * vx, py - t * vy)
        if (d <= STATION_REACH_KM) out.push([key, t, d])
      }
    }
  }
  return out.sort((x, y) => x[1] - y[1])
}
console.log(`stations: ${stations.size}`)

// ---------- A* along the track ----------

// Plain binary heap of [priority, node].
class Heap {
  constructor() {
    this.p = []
    this.n = []
  }
  push(p, n) {
    const P = this.p
    const Q = this.n
    let i = P.length
    P.push(p)
    Q.push(n)
    while (i > 0) {
      const up = (i - 1) >> 1
      if (P[up] <= p) break
      P[i] = P[up]
      Q[i] = Q[up]
      i = up
    }
    P[i] = p
    Q[i] = n
  }
  pop() {
    const P = this.p
    const Q = this.n
    const top = Q[0]
    const p = P.pop()
    const n = Q.pop()
    if (P.length) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= P.length) break
        if (c + 1 < P.length && P[c + 1] < P[c]) c++
        if (P[c] >= p) break
        P[i] = P[c]
        Q[i] = Q[c]
        i = c
      }
      P[i] = p
      Q[i] = n
    }
    return top
  }
  get size() {
    return this.p.length
  }
}

const dist = new Float64Array(N).fill(Infinity)
const from = new Int32Array(N).fill(-1)
const touched = []
function route(sources, targets, limitKm) {
  for (const i of touched) {
    dist[i] = Infinity
    from[i] = -1
  }
  touched.length = 0
  const goal = new Set(targets)
  const [tLat, tLon] = [lat[targets[0]], lon[targets[0]]]
  const heap = new Heap()
  for (const s of sources) {
    dist[s] = 0
    touched.push(s)
    heap.push(km(lat[s], lon[s], tLat, tLon), s)
  }
  while (heap.size) {
    const u = heap.pop()
    if (goal.has(u)) {
      const path = []
      for (let v = u; v >= 0; v = from[v]) path.push(v)
      return path.reverse()
    }
    const du = dist[u]
    if (du > limitKm) return null
    for (let k = start[u]; k < start[u + 1]; k++) {
      const v = nbr[k]
      const nd = du + km(lat[u], lon[u], lat[v], lon[v])
      if (nd < dist[v]) {
        if (dist[v] === Infinity) touched.push(v)
        dist[v] = nd
        from[v] = u
        heap.push(nd + km(lat[v], lon[v], tLat, tLon), v)
      }
    }
  }
  return null
}

// ---------- Every pair of consecutive stops ----------

const trains = JSON.parse(readFileSync(R + 'trains.json', 'utf8'))
const list = Array.isArray(trains) ? trains : Object.values(trains)
const wanted = new Map()
for (const t of list) {
  for (let i = 0; i + 1 < t.stops.length; i++) {
    const a = t.stops[i]
    const b = t.stops[i + 1]
    wanted.set(`${a.code}|${b.code}`, [a, b])
  }
}

const out = {}
let routed = 0
let noTrack = 0
let detour = 0
let passed = 0
const t0 = Date.now()
for (const [key, [a, b]] of wanted) {
  const straight = km(a.lat, a.lon, b.lat, b.lon)
  // Several nearby nodes each end, so a stop between parallel lines can use either.
  const src = nodesNear(a.lat, a.lon, STOP_REACH_KM).slice(0, 12).map(([i]) => i)
  const dst = nodesNear(b.lat, b.lon, STOP_REACH_KM).slice(0, 12).map(([i]) => i)
  if (!src.length || !dst.length || straight < 0.5) {
    noTrack++
    continue
  }
  const path = route(src, dst, straight * MAX_DETOUR + 5)
  if (!path) {
    noTrack++
    continue
  }
  let along = 0
  const at = [0]
  for (let k = 1; k < path.length; k++) at.push((along += km(lat[path[k - 1]], lon[path[k - 1]], lat[path[k]], lon[path[k]])))
  if (along > straight * MAX_DETOUR + 5) {
    detour++
    continue
  }
  routed++
  const seen = new Set([a.code, b.code])
  const between = []
  const firstWord = (n) => n.toLowerCase().split(/[\s-]+/)[0]
  const beside = []
  for (let k = 1; k < path.length; k++) {
    for (const [key, t, d] of stationsBeside(path[k - 1], path[k])) beside.push([key, at[k - 1] + t * (at[k] - at[k - 1]), d])
  }
  // Each station once, where it's nearest the track.
  const nearest = new Map()
  for (const b of beside) if (!nearest.has(b[0]) || b[2] < nearest.get(b[0])[2]) nearest.set(b[0], b)
  beside.length = 0
  beside.push(...nearest.values())
  beside.sort((x, y) => x[1] - y[1])
  beside.forEach(([key, here, off]) => {
    if (seen.has(key)) return
    seen.add(key)
    const s = stations.get(key)
    // A station right at either stop, or one nearby named after it ("Daund Junction Chord Line"),
    // is part of that stop.
    for (const stop of [a, b]) {
      const d = km(s.lat, s.lon, stop.lat, stop.lon)
      if (d < 1 || (d < 5 && firstWord(s.name) === firstWord(stop.name))) return
    }
    // Two stations side by side (Parel and Prabhadevi, a narrow-gauge one beside the main one) are one
    // place to riders: the one on this track, nearest it, is kept.
    const twin = between.findIndex((p) => km(p.lat, p.lon, s.lat, s.lon) < 0.5)
    const entry = { code: s.code, name: s.name, lat: s.lat, lon: s.lon, fraction: +(here / along).toFixed(4), off }
    if (twin < 0) between.push(entry)
    else if (off < between[twin].off) between[twin] = entry
  })
  if (between.length) {
    out[key] = between.map(({ off, ...p }) => p)
    passed += between.length
  }
}
writeFileSync(R + 'passing.json', JSON.stringify(out))
console.log(`pairs ${wanted.size} | routed ${routed} | no track ${noTrack} | detour ${detour} | stations passed ${passed} | ${((Date.now() - t0) / 1000).toFixed(0)}s`)
