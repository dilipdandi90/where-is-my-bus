// Downloads what the build needs into work/: the text of every page of Trains at a Glance (the book's
// own search index), its station-code index, and station positions (OpenStreetMap for current codes,
// DataMeet's list to fill gaps). Page images are downloaded later by batch.mjs, one at a time.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const R = fileURLToPath(new URL('./work/', import.meta.url))
const BOOK = 'https://www.irctctourism.com/packageImage/TagBook/2026/English/'
mkdirSync(R, { recursive: true })

async function get(url, options) {
  const res = await fetch(url, { headers: { 'User-Agent': 'where-is-my-bus timetable builder' }, ...options })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

// Every page's text: the reader's search index is `var textForPages = [...]`.
const index = await get(`${BOOK}files/search/book_config.js`)
const pages = JSON.parse(index.slice(index.indexOf('['), index.lastIndexOf(']') + 1))
writeFileSync(R + 'pages.json', JSON.stringify(pages))
console.log(`book text: ${pages.length} pages`)

// The station index pages: lines of "STATION NAME CODE".
const codes = new Map()
for (const text of pages.filter((p) => /Station Name\s+Code/.test(p))) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z][A-Z0-9 .()'&-]*?[A-Z.)])\s+([A-Z]{1,5})$/)
    if (m && m[1] !== 'Station Name') codes.set(m[1].replace(/\s+/g, ' '), m[2])
  }
}
writeFileSync(R + 'station-codes.json', JSON.stringify([...codes]))
console.log(`station index: ${codes.size} stations`)

// Current station codes and positions, from OpenStreetMap.
const query = '[out:json][timeout:250];area["ISO3166-1"="IN"]->.in;(node["railway"~"station|halt"]["ref"](area.in);way["railway"="station"]["ref"](area.in););out center tags;'
const osm = await get('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }) })
writeFileSync(R + 'osm-stations.json', osm)
console.log(`OpenStreetMap: ${JSON.parse(osm).elements.length} stations`)

// DataMeet's 2016 list, for stations OpenStreetMap doesn't code.
writeFileSync(R + 'stations.json', await get('https://raw.githubusercontent.com/datameet/railways/master/stations.json'))
console.log('DataMeet stations saved')
