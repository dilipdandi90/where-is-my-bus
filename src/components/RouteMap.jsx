import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { nextStopInfo, pointAtKm } from '../lib/journey.js'
import { formatDistance } from '../lib/time.js'
import { TRAIN_PATH } from './ui.jsx'

// The same path as BusIcon in ui.jsx. The map draws its own markers outside React.
const BUS_PATH =
  'M5 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a2 2 0 0 1-1 1.73V21a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.27A2 2 0 0 1 5 18V4Zm2 2v6h10V6H7Zm1.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'
const BUS_ZOOM = 14
// Read from the map's own element, so a metro line's colour (set on the page around it) is used.
const color = (el, name) => getComputedStyle(el).getPropertyValue(`--color-${name}`).trim()

function busIcon(estimated, train) {
  return L.divIcon({
    className: 'bus-map-marker',
    html: `<span class="bus-map-pin ${estimated ? 'is-estimate' : ''}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${train ? TRAIN_PATH : BUS_PATH}"/></svg></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

/** Text for the bus's label, built as elements so stop names from the feed are never read as HTML. */
function labelFor(stops, km, last) {
  const info = nextStopInfo(stops, km, last)
  const el = document.createElement('span')
  const strong = document.createElement('b')
  if (info.distanceKm != null) {
    strong.textContent = formatDistance(info.distanceKm)
    el.append(strong, ` to ${info.name}`)
  } else {
    strong.textContent = info.name
    el.append('At ', strong)
  }
  return el
}

/**
 * The route on a map, with the part travelled in orange and the bus on it. Roads between stops are
 * drawn as straight lines: the feeds' road shapes are too large to send to phones, and stops are close
 * enough together that the line stays near the road.
 *
 * @param lineColor a metro line's colour (hex digits). The whole line is then drawn in it, as on a metro
 *        map, with the part already travelled stronger. Buses get a grey route with orange travelled.
 */
export default function RouteMap({ stops, journey, lineColor }) {
  const box = useRef(null)
  const parts = useRef(null)
  const { km, last, phase, source } = journey
  const showBus = phase === 'running'

  // Built once per route. Leaflet manages the map itself; React only tells it where the bus is.
  useEffect(() => {
    const points = stops.map((s) => [s.lat, s.lon])
    const map = L.map(box.current, { zoomSnap: 0.5 })
    // Top right, clear of the refresh button that floats at the bottom of the screen.
    map.attributionControl.setPosition('topright')
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    const el = box.current
    const metro = lineColor ? `#${lineColor}` : null
    if (metro) {
      // A white casing keeps pale colours such as aqua visible over the map.
      L.polyline(points, { color: '#ffffff', weight: 12, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map)
      L.polyline(points, { color: metro, weight: 7, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(map)
    } else {
      L.polyline(points, { color: color(el, 'ink-soft'), weight: 5, opacity: 0.35 }).addTo(map)
    }
    const done = L.polyline([], { color: metro ?? color(el, 'road'), weight: metro ? 8 : 6, lineCap: 'round', lineJoin: 'round' }).addTo(map)
    stops.forEach((s, i) => {
      const end = i === 0 || i === stops.length - 1
      // Metro stations are white rings in the line's colour, as on station maps.
      L.circleMarker([s.lat, s.lon], {
        radius: metro ? (end ? 7.5 : 5) : end ? 6 : 3.5,
        color: metro ? (end ? color(el, 'ink') : metro) : color(el, 'ink'),
        weight: metro ? 3 : end ? 2.5 : 1.5,
        fillColor: color(el, 'card'),
        fillOpacity: 1,
      })
        .bindTooltip(document.createTextNode(s.name), { direction: 'top', offset: [0, -4] })
        .addTo(map)
    })
    const bus = L.marker(points[0], { keyboard: false, zIndexOffset: 1000 })
    // 'auto' puts it left of the marker when that's in the right half of the map, so it's never cut off.
    bus.bindTooltip('', { permanent: true, direction: 'auto', offset: [16, 0], className: 'bus-map-label' })
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24] })
    parts.current = { map, done, bus }
    return () => {
      map.remove()
      parts.current = null
    }
  }, [stops, lineColor])

  // Moves the bus and the orange line whenever the journey changes.
  useEffect(() => {
    const p = parts.current
    if (!p) return
    const here = pointAtKm(stops, km)
    const travelled = stops.slice(0, Math.max(0, last) + 1).map((s) => [s.lat, s.lon])
    p.done.setLatLngs(phase === 'not-started' ? [] : [...travelled, here])
    if (!showBus) {
      p.bus.remove()
      return
    }
    p.bus.setIcon(busIcon(source === 'timetable', Boolean(lineColor)))
    p.bus.setLatLng(here)
    p.bus.setTooltipContent(labelFor(stops, km, last))
    if (!p.map.hasLayer(p.bus)) p.bus.addTo(p.map)
  }, [stops, km, last, phase, source, showBus, lineColor])

  const centreOnBus = () => {
    const p = parts.current
    if (p) p.map.setView(pointAtKm(stops, km), Math.max(p.map.getZoom(), BUS_ZOOM))
  }

  return (
    <div className="relative">
      {/* isolate keeps Leaflet's own z-indexes below the sticky header and refresh button. */}
      <div ref={box} className="isolate h-[60vh] min-h-80 w-full bg-line" role="application" aria-label="Map of the route" />
      {showBus && (
        <button
          onClick={centreOnBus}
          className="press absolute bottom-3 left-3 z-[500] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-lg"
        >
          Show bus
        </button>
      )}
    </div>
  )
}
