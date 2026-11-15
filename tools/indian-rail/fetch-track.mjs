// Downloads India's main railway lines from OpenStreetMap in 2° tiles, so the stations a train passes
// without stopping can be found along the real track. Only tiles the trains run through are fetched
// (around every stop and along the line between stops), two at a time, one per Overpass server.
// Tiles already saved are skipped, so it can be stopped and run again.
// Usage: node fetch-track.mjs            all tiles the trains need
//        node fetch-track.mjs s w n e    every tile in a box
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const R = fileURLToPath(new URL('./work/', import.meta.url))
const DIR = R + 'track/'
mkdirSync(DIR, { recursive: true })
const STEP = 2
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

const tileOf = (lat, lon) => [Math.floor(lat / STEP) * STEP, Math.floor(lon / STEP) * STEP]
const tiles = new Map()
const add = (s, w) => tiles.set(`${s}_${w}`, [s, w])
if (process.argv.length >= 6) {
  const [S, W, N, E] = process.argv.slice(2, 6).map(Number)
  for (let s = S; s < N; s += STEP) for (let w = W; w < E; w += STEP) add(s, w)
} else {
  const trains = JSON.parse(readFileSync(R + 'trains.json', 'utf8'))
  for (const t of trains) {
    for (let i = 0; i < t.stops.length; i++) {
      const a = t.stops[i]
      const b = t.stops[i + 1] ?? a
      // Points every ~10 km along the straight line; the track rarely strays a whole tile from it.
      const n = Math.max(1, Math.ceil(Math.hypot(b.lat - a.lat, b.lon - a.lon) / 0.1))
      for (let k = 0; k <= n; k++) {
        const la = a.lat + ((b.lat - a.lat) * k) / n
        const lo = a.lon + ((b.lon - a.lon) * k) / n
        // A little either side too, for track that bends away from the straight line.
        for (const [dla, dlo] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) add(...tileOf(la + dla, lo + dlo))
      }
    }
  }
}

// Tracks without a service tag are running lines; sidings, yards and crossovers carry one.
const query = (s, w, n, e) => `[out:json][timeout:300];
way["railway"="rail"]["service"!~"."]["usage"!~"industrial|military|test|tourism"](${s},${w},${n},${e});
out body;>;out skel qt;`

async function fetchTile(endpoint, s, w) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = attempt % 3 === 2 ? ENDPOINTS.find((e) => e !== endpoint) : endpoint
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'where-is-my-bus-track-builder/1.0' },
        body: 'data=' + encodeURIComponent(query(s, w, s + STEP, w + STEP)),
      })
      if (res.ok) return await res.json()
      console.log(`  ${s},${w} ${url} -> ${res.status}, retrying`)
    } catch (err) {
      console.log(`  ${s},${w} ${url} -> ${err.message}, retrying`)
    }
    await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)))
  }
  throw new Error(`tile ${s},${w} failed`)
}

const todo = [...tiles.values()].filter(([s, w]) => !existsSync(`${DIR}t_${s}_${w}.json`))
console.log(`${tiles.size} tiles needed, ${todo.length} to download`)
let done = 0
async function worker(endpoint) {
  for (;;) {
    const next = todo.shift()
    if (!next) return
    const [s, w] = next
    try {
      const j = await fetchTile(endpoint, s, w)
      // Compact: node id -> [lat, lon], ways as node id lists.
      const nodes = {}
      const ways = []
      for (const el of j.elements) {
        if (el.type === 'node') nodes[el.id] = [+el.lat.toFixed(6), +el.lon.toFixed(6)]
        else if (el.type === 'way') ways.push(el.nodes)
      }
      writeFileSync(`${DIR}t_${s}_${w}.json`, JSON.stringify({ nodes, ways }))
      console.log(`${++done} done, ${todo.length} left | tile ${s},${w}: ${ways.length} ways`)
    } catch (err) {
      console.log(`${err.message}; run again later to retry it`)
    }
  }
}
await Promise.all(ENDPOINTS.map(worker))
console.log('track download finished')
