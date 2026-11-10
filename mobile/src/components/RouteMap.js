import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { formatDistance, nextStopInfo, pointAtKm } from '../lib/shared.js'
import { API_BASE, SITE_URL } from '../lib/config.js'
import { colors } from '../lib/theme.js'
import { Press } from './ui.js'

// The same OpenStreetMap map as the website, drawn by Leaflet in a web view, so it needs no map API
// key. The route is drawn once; after that only the vehicle's position is sent in.
const HTML = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;height:100%;background:#dfe5f0}
.pin{display:flex;width:30px;height:30px;align-items:center;justify-content:center;border:3px solid var(--road);border-radius:50%;background:#0f1f3d;color:#f2f5fb;box-shadow:0 2px 8px rgba(0,0,0,.35);box-sizing:border-box}
.pin.est{background:#566079;border-color:#fff}.pin svg{width:16px;height:16px}
.mk{transition:transform 1.2s ease-out}.leaflet-zoom-anim .mk{transition:none}
.lbl{font:12px Roboto,sans-serif;color:#0f1f3d;border-radius:8px}</style></head>
<body><div id="map"></div><script>
var map, done, bus, stops = [], road = '#ff8a2b', icon = '';
function init(d){
  stops = d.stops; road = d.road; icon = d.icon;
  document.documentElement.style.setProperty('--road', road);
  map = L.map('map', {zoomSnap: .5});
  map.attributionControl.setPosition('topright');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'}).addTo(map);
  var pts = stops.map(function(s){return [s.lat, s.lon]});
  if (d.metro) {
    L.polyline(pts, {color: '#fff', weight: 12, opacity: .9, lineCap: 'round'}).addTo(map);
    L.polyline(pts, {color: road, weight: 7, opacity: .55, lineCap: 'round'}).addTo(map);
  } else {
    L.polyline(pts, {color: '#566079', weight: 5, opacity: .35}).addTo(map);
  }
  done = L.polyline([], {color: road, weight: d.metro ? 8 : 6, lineCap: 'round'}).addTo(map);
  stops.forEach(function(s, i){
    var end = i === 0 || i === stops.length - 1;
    L.circleMarker([s.lat, s.lon], {radius: d.metro ? (end ? 7.5 : 5) : (end ? 6 : 3.5), color: d.metro && !end ? road : '#0f1f3d', weight: d.metro ? 3 : (end ? 2.5 : 1.5), fillColor: '#fff', fillOpacity: 1})
      .bindTooltip(document.createTextNode(s.name), {direction: 'top'}).addTo(map);
  });
  bus = L.marker(pts[0], {keyboard: false, zIndexOffset: 1000});
  bus.bindTooltip('', {permanent: true, direction: 'auto', offset: [16, 0], className: 'lbl'});
  map.fitBounds(L.latLngBounds(pts), {padding: [24, 24]});
}
function update(u){
  if (!map) return;
  done.setLatLngs(u.travelled);
  if (!u.here) { bus.remove(); return; }
  bus.setIcon(L.divIcon({className: 'mk', html: '<span class="pin' + (u.estimated ? ' est' : '') + '">' + icon + '</span>', iconSize: [30, 30], iconAnchor: [15, 15]}));
  bus.setLatLng(u.here);
  var el = document.createElement('span');
  if (u.distance) { var b = document.createElement('b'); b.textContent = u.distance; el.append(b, ' to ' + u.name); }
  else { var c = document.createElement('b'); c.textContent = u.name; el.append('At ', c); }
  bus.setTooltipContent(el);
  if (!map.hasLayer(bus)) bus.addTo(map);
  window.__here = u.here;
}
function centre(){ if (window.__here) map.setView(window.__here, Math.max(map.getZoom(), 14)); }
</script></body></html>`

const svg = (d) => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`
const BUS = 'M5 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a2 2 0 0 1-1 1.73V21a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.27A2 2 0 0 1 5 18V4Zm2 2v6h10V6H7Zm1.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'
const TRAIN = 'M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z'

/** The route on a map with the part travelled in colour and the vehicle on it. */
export default function RouteMap({ stops, journey, scheme, metro }) {
  const web = useRef(null)
  const [ready, setReady] = useState(false)
  const { km, last, phase, source } = journey
  const running = phase === 'running'

  useEffect(() => {
    if (!ready) return
    const info = running ? nextStopInfo(stops, km, last) : null
    const update = {
      travelled: phase === 'not-started' || phase === 'unknown' ? [] : [...stops.slice(0, Math.max(0, last) + 1).map((s) => [s.lat, s.lon]), pointAtKm(stops, km)],
      here: running ? pointAtKm(stops, km) : null,
      estimated: source === 'timetable',
      name: info?.name,
      distance: info?.distanceKm != null ? formatDistance(info.distanceKm) : null,
    }
    web.current?.injectJavaScript(`update(${JSON.stringify(update)}); true;`)
  }, [ready, stops, km, last, phase, source, running])

  const start = () => {
    const data = { stops: stops.map((s) => ({ lat: s.lat, lon: s.lon, name: s.name })), road: scheme.road, metro, icon: svg(metro ? TRAIN : BUS) }
    web.current?.injectJavaScript(`init(${JSON.stringify(data)}); true;`)
    setReady(true)
  }

  return (
    <View style={styles.box}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        // A real address, so map tile requests carry a Referer as OpenStreetMap's tile policy asks.
        source={{ html: HTML, baseUrl: SITE_URL || API_BASE }}
        onLoadEnd={start}
        style={{ flex: 1 }}
        // The page scrolls, not the map, unless the rider is dragging the map itself.
        nestedScrollEnabled
        renderError={() => (
          <View style={styles.fallback}>
            <Text style={{ color: colors.inkSoft }}>The map needs an internet connection.</Text>
          </View>
        )}
      />
      {running && (
        <Press onPress={() => web.current?.injectJavaScript('centre(); true;')} style={styles.show} accessibilityRole="button">
          <Text style={{ color: colors.paper, fontWeight: '600' }}>Show {metro ? 'train' : 'bus'}</Text>
        </Press>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { height: 420, marginTop: 8, backgroundColor: colors.line },
  show: { position: 'absolute', left: 12, bottom: 12, backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, elevation: 4 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
