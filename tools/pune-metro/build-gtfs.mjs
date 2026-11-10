// Builds a GTFS feed for Pune Metro from OpenStreetMap, where volunteers map each line's stations in
// order along with the published service hours, frequency and end-to-end journey time. Pune Metro
// itself publishes no timetable data.
//
//   node tools/pune-metro/build-gtfs.mjs
//
// writes backend/src/main/resources/feeds/pune-metro.zip. Run it again to pick up changes in
// OpenStreetMap, such as newly opened stations or platform numbers.
//
// The data is © OpenStreetMap contributors, under the Open Database Licence, and the app credits it.
//
// - Stations come in route order, one route per direction, from the line's stop positions.
// - Platform numbers come from a stop position's ref, where mappers have added one.
// - Departures run from opening to closing time, every `interval` minutes, or `interval:conditional`
//   in the peak hours it names. Times between stations divide the published journey time by distance,
//   as no per-station times are published.
// - Where OpenStreetMap has no timings yet, published ones listed in PUBLISHED below are used.
// - A line with no published hours, frequency or journey time at all gets no timetable. Its trips use a calendar that never runs, which the app reads as "no timetable
//   published": the line and its stations still show, and riders can still track it live.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../backend/src/main/resources/feeds/pune-metro.zip')
const API = 'https://api.openstreetmap.org/api/0.6'

// Each line's route_master in OpenStreetMap, with the official line names.
const LINES = [
  { master: 13917129, name: 'Purple Line' },
  { master: 13916711, name: 'Aqua Line' },
  { master: 21872221, name: 'Pink Line' },
]
// OpenStreetMap allows CSS colour names; GTFS needs hex.
const NAMED_COLOURS = { purple: '800080', aqua: '00FFFF', pink: 'FFC0CB' }
const NO_TIMETABLE = 'NO_TIMETABLE'

// Published timings for routes OpenStreetMap hasn't been given yet, written the way OpenStreetMap would
// hold them. Tags mapped in OpenStreetMap take over once they exist.
//
// Pink Line, from the official timetable as reported when the line opened on 4 November 2026
// (https://railzi.com/stories/pune-metro-line-3-hinjewadi-shivajinagar; frequencies rounded to 6 and
// 12 minutes in https://www.constructionworld.in/transport-infrastructure/metro-rail-and-railways-infrastructure/pune-metro-line-3-to-begin-services-on-november-4/99833):
// first trains at 06:00, every 5 min 30 s from 07:30 to 09:30 and 17:00 to 20:00, every 10 minutes
// otherwise, last trains at 22:30 from Maan and 23:40 from District Court, about 45 minutes end to end.
const PINK_PEAKS = '00:05:30 @(Mo-Su 07:30-09:30; Mo-Su 17:00-20:00)'
const PUBLISHED = {
  21871930: { opening_hours: 'Mo-Su 06:00-23:40', interval: '00:10', 'interval:conditional': PINK_PEAKS, duration: '00:45' }, // District Court → Maan
  21872220: { opening_hours: 'Mo-Su 06:00-22:30', interval: '00:10', 'interval:conditional': PINK_PEAKS, duration: '00:45' }, // Maan → District Court
}

async function osm(path) {
  const response = await fetch(`${API}${path}`, { headers: { 'User-Agent': 'where-is-my-bus GTFS builder' } })
  if (!response.ok) throw new Error(`${response.status} for ${path}`)
  return response.json()
}

const hex = (colour) => (colour?.startsWith('#') ? colour.slice(1).toUpperCase() : NAMED_COLOURS[colour] ?? '777777')

/** Dark text on light colours (such as aqua), white on dark ones, by WCAG relative luminance. */
function textColour(bg) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '000000' : 'FFFFFF'
}

/** "00:07:30" or "00:15" to seconds. */
function duration(text) {
  if (!text) return null
  const [h, m, s = 0] = text.split(':').map(Number)
  return h * 3600 + m * 60 + s
}

/** The first "HH:MM-HH:MM" in an opening_hours value, as seconds since midnight. */
function hours(text) {
  const m = text?.match(/(\d\d):(\d\d)-(\d\d):(\d\d)/)
  return m ? [m[1] * 3600 + m[2] * 60, m[3] * 3600 + m[4] * 60] : null
}

/** "00:07 @(Mo-Su,PH 08:00-11:00; Mo-Su,PH 16:00-20:00)" to the peak interval and its time windows. */
function peaks(text) {
  if (!text) return null
  const interval = duration(text.split('@')[0].trim())
  const windows = [...text.matchAll(/(\d\d):(\d\d)-(\d\d):(\d\d)/g)].map((m) => [m[1] * 3600 + m[2] * 60, m[3] * 3600 + m[4] * 60])
  return { interval, windows }
}

const km = (a, b) => {
  const rad = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Mappers name interchange stops after the line, such as "District Court (Aqua Line)". The line is
// already shown, so riders see the station's own name.
const stationName = (tags) => (tags['name:en'] || tags.name).replace(/\s*\((Purple|Aqua|Pink) Line\)\s*$/i, '').trim()

const clock = (sec) => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, '0')).join(':')

const csv = (rows) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n') + '\r\n'

const stops = new Map()
const routes = []
const trips = []
const stopTimes = []
const report = []

for (const line of LINES) {
  const master = (await osm(`/relation/${line.master}.json`)).elements[0]
  const colour = hex(master.tags.colour)
  // The app shows the agency as the operator, so it's the short name riders know.
  const agency = /PMRDA|Metropolitan Region/i.test(master.tags.operator ?? '') ? 'PMRDA' : 'Maha Metro'
  routes.push([master.tags.ref, agency, master.tags.ref, line.name, 1, colour, textColour(colour)])

  for (const member of master.members.filter((m) => m.type === 'relation')) {
    const full = await osm(`/relation/${member.ref}/full.json`)
    const byId = new Map(full.elements.map((e) => [`${e.type}${e.id}`, e]))
    const route = byId.get(`relation${member.ref}`)
    const t = { ...PUBLISHED[member.ref], ...route.tags }
    const calls = route.members
      .filter((m) => m.type === 'node' && /^stop/.test(m.role))
      .map((m) => byId.get(`node${m.ref}`))
    for (const node of calls) {
      stops.set(node.id, [node.id, stationName(node.tags), node.lat, node.lon, node.tags.ref ?? ''])
    }

    const open = hours(t.opening_hours)
    const base = duration(t.interval)
    const total = duration(t.duration)
    const timed = open && base && total
    // Times between stations: the journey time shared out by distance along the line.
    const along = [0]
    for (let i = 1; i < calls.length; i++) along.push(along[i - 1] + km(calls[i - 1], calls[i]))
    const offsets = along.map((d) => Math.round((total ?? 0) * (d / along.at(-1))))

    const addTrip = (id, service, start) => {
      // The headsign is the line's name, so searching "purple" or "aqua" finds it. The destination shows anyway.
      trips.push([master.tags.ref, service, id, line.name, member.ref])
      calls.forEach((node, i) => stopTimes.push([id, clock(start + offsets[i]), clock(start + offsets[i]), node.id, i]))
    }

    if (timed) {
      const peak = peaks(t['interval:conditional'])
      let count = 0
      for (let start = open[0]; start <= open[1]; count++) {
        addTrip(`${member.ref}-${clock(start).slice(0, 5).replace(':', '')}`, 'DAILY', start)
        const inPeak = peak?.windows.some(([from, to]) => start >= from && start < to)
        start += inPeak ? peak.interval : base
      }
      report.push(`${t.name}: ${calls.length} stations, ${count} departures ${clock(open[0]).slice(0, 5)}-${clock(open[1]).slice(0, 5)}, ${Math.round(total / 60)} min end to end`)
    } else {
      addTrip(`${member.ref}-untimed`, NO_TIMETABLE, 0)
      report.push(`${t.name}: ${calls.length} stations, no timetable published`)
    }
  }
}

const files = {
  'agency.txt': csv([
    ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
    ['Maha Metro', 'Maharashtra Metro Rail Corporation (Pune Metro lines 1 and 2)', 'https://www.punemetrorail.org/', 'Asia/Kolkata'],
    ['PMRDA', 'Pune Metropolitan Region Development Authority (Pune Metro line 3)', 'https://www.pmrda.gov.in/', 'Asia/Kolkata'],
  ]),
  'stops.txt': csv([['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'platform_code'], ...stops.values()]),
  'routes.txt': csv([['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'], ...routes]),
  'calendar.txt': csv([
    ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    ['DAILY', 1, 1, 1, 1, 1, 1, 1, '20260101', '20301231'],
    [NO_TIMETABLE, 0, 0, 0, 0, 0, 0, 0, '20260101', '20301231'],
  ]),
  'trips.txt': csv([['route_id', 'service_id', 'trip_id', 'trip_headsign', 'shape_id'], ...trips]),
  'stop_times.txt': csv([['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], ...stopTimes]),
  'feed_info.txt': csv([
    ['feed_publisher_name', 'feed_publisher_url', 'feed_lang'],
    ['OpenStreetMap contributors (ODbL), via where-is-my-bus', 'https://www.openstreetmap.org/copyright', 'en'],
  ]),
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, zip(files))
console.log(report.join('\n'))
const withPlatforms = [...stops.values()].filter((s) => s[4]).map((s) => `${s[1]} PF ${s[4]}`)
console.log(`\n${stops.size} stop positions, ${withPlatforms.length} with platform numbers: ${withPlatforms.join(', ') || 'none'}`)
console.log(`Wrote ${OUT}`)

// A minimal zip writer (stored, not compressed), so this needs nothing beyond Node itself.
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
    const data = Buffer.from(text, 'utf8')
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
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
