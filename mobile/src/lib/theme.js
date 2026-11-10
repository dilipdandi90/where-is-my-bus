// The website's colours, so the app and the site look like one product.
export const colors = {
  ink: '#0f1f3d',
  inkSoft: '#566079',
  paper: '#f2f5fb',
  card: '#ffffff',
  line: '#dfe5f0',
  road: '#ff8a2b',
  roadDark: '#b84f00',
  tint: '#fff1e4',
  ontime: '#0b7f54',
  late: '#cf2f1f',
  header: '#13274d',
}

/** A metro line's colour scheme (hex digits from the feed), or the usual orange for buses. */
export function lineScheme(color) {
  if (!color) return { road: colors.road, roadDark: colors.roadDark, tint: colors.tint }
  const hex = `#${color}`
  return { road: hex, roadDark: mix(color, '000000', 0.38), tint: mix(color, 'ffffff', 0.88) }
}

/** Mixes two hex colours, `amount` of the way from a to b. */
function mix(a, b, amount) {
  const channel = (hex, i) => parseInt(hex.slice(i, i + 2), 16)
  const out = [0, 2, 4].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * amount))
  return `#${out.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}
