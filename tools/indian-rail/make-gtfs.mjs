// Writes the joined trains as a GTFS feed the server loads like any other, at
// backend/src/main/resources/feeds/indian-rail.zip. Multi-day trains use times past 24:00, as GTFS allows.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

// Downloaded pages, the book's text and intermediate results. Not committed (see .gitignore).
const R = fileURLToPath(new URL('./work/', import.meta.url))
const OUT = fileURLToPath(new URL('../../backend/src/main/resources/feeds/indian-rail.zip', import.meta.url))
const trains = JSON.parse(readFileSync(R + 'trains.json', 'utf8'))

const csv = (rows) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n') + '\r\n'
const clock = (sec) => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, '0')).join(':')
const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const stops = new Map()
const routes = []
const trips = []
const stopTimes = []
const calendars = new Map()
for (const t of trains) {
  // Times count from the train's first departure, so the first stop is never on day 2.
  const base = Math.floor(t.stops[0].dep / 86400) * 86400
  const service = `D${t.days}`
  if (!calendars.has(service)) calendars.set(service, [service, ...WEEK.map((_, d) => ((t.days >> d) & 1 ? 1 : 0)), '20260101', '20261231'])
  routes.push([t.number, 'Indian Railways', t.number, t.name, 2])
  trips.push([t.number, service, t.number, t.name])
  t.stops.forEach((s, i) => {
    stops.set(s.code, [s.code, s.name, s.lat.toFixed(6), s.lon.toFixed(6)])
    stopTimes.push([t.number, clock(s.arr - base), clock(s.dep - base), s.code, i])
  })
}

const files = {
  'agency.txt': csv([['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], ['Indian Railways', 'Indian Railways', 'https://indianrailways.gov.in/', 'Asia/Kolkata']]),
  'stops.txt': csv([['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], ...stops.values()]),
  'routes.txt': csv([['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], ...routes]),
  'calendar.txt': csv([['service_id', ...WEEK, 'start_date', 'end_date'], ...calendars.values()]),
  'trips.txt': csv([['route_id', 'service_id', 'trip_id', 'trip_headsign'], ...trips]),
  'stop_times.txt': csv([['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], ...stopTimes]),
  // Not GTFS: the stations passed without stopping between two stops, from passing.mjs.
  'passing.txt': csv([['from_stop_id', 'to_stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon', 'fraction'], ...passingRows()]),
  'feed_info.txt': csv([['feed_publisher_name', 'feed_lang', 'feed_start_date', 'feed_end_date'], ['Indian Railways Trains at a Glance 2026, via where-is-my-bus', 'en', '20260101', '20261231']]),
}
writeFileSync(OUT, zip(files))

function passingRows() {
  const file = R + 'passing.json'
  if (!existsSync(file)) return []
  const passing = JSON.parse(readFileSync(file, 'utf8'))
  const rows = []
  for (const [key, list] of Object.entries(passing)) {
    const [from, to] = key.split('|')
    for (const p of list) rows.push([from, to, p.code, p.name, p.lat.toFixed(6), p.lon.toFixed(6), p.fraction])
  }
  return rows
}
console.log(`trains ${trains.length} | stations ${stops.size} | stop times ${stopTimes.length} | wrote ${OUT}`)

// A minimal zip writer, deflate-compressed.
function zip(entries) {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8')
    const data = deflateRawSync(raw, { level: 9 })
    const nameBuf = Buffer.from(name)
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
