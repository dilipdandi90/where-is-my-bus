// What to call things, which depends on whether a feed is buses or a metro. Pass the feed object
// (or null while it loads, which reads as buses).

const BUS = {
  bus: 'bus',
  buses: 'buses',
  Bus: 'Bus',
  stop: 'stop',
  stops: 'stops',
  Stops: 'Stops',
  searchTab: 'Bus number or place',
  searchPlaceholder: 'Bus number or place',
  betweenTab: 'Between two stops',
  stopPlaceholder: 'Stop name',
}

const METRO = {
  bus: 'train',
  buses: 'trains',
  Bus: 'Train',
  stop: 'station',
  stops: 'stations',
  Stops: 'Stations',
  searchTab: 'Line or station',
  searchPlaceholder: 'Line, colour or end station',
  betweenTab: 'Between two stations',
  stopPlaceholder: 'Station name',
}

export const isMetro = (feed) => feed?.mode === 'metro'

export const wordsFor = (feed) => (isMetro(feed) ? METRO : BUS)

/** "1 bus", "3 trains". */
export const count = (words, n) => `${n} ${n === 1 ? words.bus : words.buses}`

/**
 * Paints a part of the page in a line's colour, by overriding the theme's orange (road) colours there.
 * Used for metro lines, which riders know by colour. Returns undefined for services without one.
 */
export function lineColours(color) {
  if (!color) return undefined
  const hex = `#${color}`
  return {
    '--color-road': hex,
    // Darker for borders and text on light backgrounds, which pale colours such as aqua can't be.
    '--color-road-dark': `color-mix(in srgb, ${hex} 62%, black)`,
    '--color-tint': `color-mix(in srgb, ${hex} 12%, white)`,
  }
}
