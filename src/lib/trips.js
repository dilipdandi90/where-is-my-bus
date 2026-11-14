// Builds a departure's stop times from its service, so opening a different departure needs no request.
// Shared by the website and the mobile app.

// One index per service object, built on first use and dropped with it.
const indexes = new WeakMap()

/** tripId → departure, for O(1) lookups instead of scanning the list each time. */
function departureIndex(service) {
  let index = indexes.get(service)
  if (!index) {
    index = new Map(service.departures.map((d) => [d.tripId, d]))
    indexes.set(service, index)
  }
  return index
}

/**
 * The same shape as the server's trip answer ({tripId, serviceId, startSec, offsets}), from data the
 * service already holds, or null when it can't be built and must be asked for: a server too old to
 * send patterns, or a departure not running today (one of tomorrow's, from the timetable).
 */
export function tripFromService(service, tripId) {
  if (!service || !tripId) return null
  // A line with no timetable has one placeholder trip, whose times are never used.
  if (tripId === service.untimedTripId) return { tripId, serviceId: service.serviceId, startSec: 0, offsets: service.stops.map(() => 0) }
  if (!service.patterns) return null
  const departure = departureIndex(service).get(tripId)
  const offsets = departure && service.patterns[departure.pattern]
  if (!offsets) return null
  // Arrival times, where a stop has a wait (trains); null when they match the departures.
  const arrivals = departure.arrivalPattern >= 0 ? (service.arrivalPatterns?.[departure.arrivalPattern] ?? null) : null
  return { tripId, serviceId: service.serviceId, startSec: departure.startSec, offsets, arrivals }
}
