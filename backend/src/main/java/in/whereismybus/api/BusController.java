package in.whereismybus.api;

import in.whereismybus.gtfs.Connections;
import in.whereismybus.gtfs.FeedData;
import in.whereismybus.gtfs.FeedData.Service;
import in.whereismybus.gtfs.FeedData.Trip;
import in.whereismybus.gtfs.FeedProperties;
import in.whereismybus.gtfs.FeedRegistry;
import in.whereismybus.gtfs.Geo;
import in.whereismybus.gtfs.GtfsLoader;
import in.whereismybus.live.LiveVehicles;
import in.whereismybus.live.RiderReports;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/feeds")
public class BusController {
    private static final int MAX_RESULTS = 40;
    // A whole day of buses between two big places, such as a busy city corridor, can run to hundreds.
    private static final int MAX_TIMETABLE_ROWS = 400;
    private static final double MAX_ACCURACY_M = 5000;
    private static final double MIN_ROUTE_TOLERANCE_KM = 1;
    /** Within this of the last stop, a bus has finished its run (matches the app's own rule). */
    private static final double ROUTE_END_KM = 0.3;
    private static final Pattern RIDER_ID = Pattern.compile("[A-Za-z0-9-]{8,64}");

    private final FeedRegistry registry;
    private final RiderReports reports;
    private final LiveVehicles vehicles;

    public BusController(FeedRegistry registry, RiderReports reports, LiveVehicles vehicles) {
        this.registry = registry;
        this.reports = reports;
        this.vehicles = vehicles;
    }

    public record FeedDto(String id, String name, String region, String operators, String status, String error,
                          String source, String sourceUrl, boolean official, boolean numbersAreCodes, boolean hasLiveBuses, LocalDate validTo, boolean expired,
                          boolean timesRepaired, String note, String timezone, Integer services, Integer trips,
                          Integer stops, Instant loadedAt, String mode) {}

    /**
     * @param color the line's colour as hex digits, empty if the feed gives none
     * @param timetabled false when no timetable is published for it
     */
    public record ServiceSummary(String serviceId, String number, String operator, String label, String from,
                                 String to, int stops, double km, int departuresToday, int typicalMinutes,
                                 Integer nextDepartureSec, int busesRunning, String color, String textColor,
                                 boolean timetabled) {}

    /** @param platform the platform number, where the feed gives one, otherwise empty */
    public record StopDto(String id, String name, double lat, double lon, double km, String platform) {}

    /**
     * @param pattern which of the service's {@code patterns} holds this departure's times between stops
     * @param days the days it leaves its first stop, one bit per weekday from Monday (bit 0)
     * @param arrivalPattern which of {@code arrivalPatterns} holds its arrival times, or -1 when they're
     *        the same as its departures
     */
    public record Departure(String tripId, int startSec, int durationSec, int pattern, int days, int arrivalPattern) {}

    /**
     * @param untimedTripId for a line with no timetable, the trip to track and share live, otherwise null
     * @param patterns each distinct list of seconds from the first stop to every stop. Departures share
     *        a few of these (every Purple Line train takes the same time between stations), so sending
     *        them once lets the app build any departure's times itself instead of asking for each one.
     */
    public record ServiceDetail(String serviceId, String number, String operator, String label, String from,
                                String to, double km, String timezone, List<StopDto> stops,
                                List<Departure> departures, String color, String textColor, boolean timetabled,
                                String untimedTripId, List<int[]> patterns, List<int[]> arrivalPatterns,
                                List<FeedData.Passing> passing) {}

    /** @param arrivals seconds from the first stop to arriving at each, or null when the same as offsets */
    public record TripDetail(String tripId, String serviceId, int startSec, int[] offsets, int[] arrivals) {}

    public record StopSuggestion(String name, double lat, double lon) {}

    /**
     * @param departed whether this bus has already left the boarding stop today
     * @param untimed a line with no timetable: boardSec, alightSec and minutes are null
     * @param boardPlatform the platform to board from, where the feed gives one, otherwise empty
     */
    public record ConnectionDto(ServiceSummary service, String tripId, Integer boardSec, Integer alightSec, Integer minutes,
                                double km, String boardStop, String alightStop, boolean tomorrow, boolean departed,
                                boolean untimed, String boardPlatform) {}

    /**
     * @param lastKm where riders last saw it, even after they stopped sharing, or null
     * @param lastAgeSec how long ago that was
     */
    public record LiveStatus(int riders, Double km, String source, Integer ageSec, Double lastKm, Integer lastAgeSec) {}

    public record LiveBus(String plate, double km, long ageSec, double lat, double lon) {}

    public record ReportRequest(String riderId, double lat, double lon, double accuracy, String source) {}

    @GetMapping
    public List<FeedDto> feeds() {
        return registry.all().stream().map(BusController::toDto).toList();
    }

    /**
     * Lets browsers reuse an answer for a while instead of asking again. Timetables change at most
     * daily; anything with live counts in it is kept briefly. Live positions are never cached.
     */
    private static void cacheFor(HttpServletResponse response, int seconds) {
        response.setHeader("Cache-Control", "public, max-age=" + seconds);
    }

    @GetMapping("/{feed}/buses")
    public List<ServiceSummary> searchBuses(@PathVariable String feed, @RequestParam String q, HttpServletResponse response) {
        FeedData data = ready(feed);
        // Short, because each result says how many buses are running right now.
        cacheFor(response, 30);
        String query = GtfsLoader.normalize(q);
        if (query.isEmpty()) {
            return List.of();
        }
        ZonedDateTime now = ZonedDateTime.now(data.zone());
        record Hit(Service service, int rank) {}
        List<Hit> hits = new ArrayList<>();
        for (Service s : data.services()) {
            int rank = s.searchRank(query);
            if (rank >= 0) {
                hits.add(new Hit(s, rank));
            }
        }
        return hits.stream()
                .sorted(Comparator.comparingInt(Hit::rank).thenComparing(h -> -h.service().trips.size()))
                .limit(MAX_RESULTS)
                .map(h -> summary(feed, h.service(), now))
                .toList();
    }

    @GetMapping("/{feed}/services/{serviceId}")
    public ServiceDetail service(@PathVariable String feed, @PathVariable String serviceId, HttpServletResponse response) {
        FeedData data = ready(feed);
        Service s = data.serviceById().get(serviceId);
        if (s == null) {
            throw notFound("No such service");
        }
        // The list holds today's departures, so it's kept for minutes rather than the whole day.
        cacheFor(response, 600);
        List<StopDto> stops = new ArrayList<>(s.stops.size());
        for (int i = 0; i < s.stops.size(); i++) {
            var st = s.stops.get(i);
            stops.add(new StopDto(st.id(), st.name(), st.lat(), st.lon(), s.km[i], st.platform()));
        }
        int weekday = ZonedDateTime.now(data.zone()).getDayOfWeek().getValue();
        // The loader stores each distinct offsets array once and shares it between trips, so the same
        // array means the same pattern. Identity keeps this a cheap lookup per departure.
        Map<int[], Integer> patternIndex = new IdentityHashMap<>();
        List<int[]> patterns = new ArrayList<>();
        Map<int[], Integer> arrivalIndex = new IdentityHashMap<>();
        List<int[]> arrivalPatterns = new ArrayList<>();
        // A train can be on its way for two or three days, and riders pick which day's run they're on,
        // so trains list every departure with its days; buses and metro list today's.
        boolean rail = "rail".equals(registry.get(feed).feed().mode());
        List<Departure> departures = s.trips.stream().filter(t -> rail || t.runsOn(weekday))
                .map(t -> new Departure(t.id(), t.startSec(), t.durationSec(), patternIndex.computeIfAbsent(t.offsets(), o -> {
                    patterns.add(o);
                    return patterns.size() - 1;
                }), t.weekdayMask(), t.arrivals() == null ? -1 : arrivalIndex.computeIfAbsent(t.arrivals(), o -> {
                    arrivalPatterns.add(o);
                    return arrivalPatterns.size() - 1;
                })))
                .toList();
        return new ServiceDetail(s.id, s.number, s.operator, s.label, s.from(), s.to(), s.totalKm(),
                data.zone().getId(), stops, departures, s.color, s.textColor, s.timetabled,
                s.timetabled ? null : s.trips.getFirst().id(), patterns, arrivalPatterns, s.passing);
    }

    // Trip IDs go in the query string: some contain backslashes (MSRTC's L5674\5), and the web
    // server rejects those in a URL path before the request gets here.
    @GetMapping("/{feed}/trip")
    public TripDetail trip(@PathVariable String feed, @RequestParam("id") String tripId, HttpServletResponse response) {
        Trip t = trip(ready(feed), tripId);
        cacheFor(response, 6 * 3600);
        return new TripDetail(t.id(), t.serviceId(), t.startSec(), t.offsets(), t.arrivals());
    }

    @GetMapping("/{feed}/stops")
    public List<StopSuggestion> searchStops(@PathVariable String feed, @RequestParam String q, HttpServletResponse response) {
        cacheFor(response, 6 * 3600);
        String query = GtfsLoader.normalize(q);
        if (query.isEmpty()) {
            return List.of();
        }
        return ready(feed).stopNames().entrySet().stream()
                .filter(e -> e.getKey().contains(query))
                .sorted(Comparator.<Map.Entry<String, FeedData.StopName>>comparingInt(
                                e -> e.getKey().startsWith(query) ? 0 : 1)
                        .thenComparingInt(e -> e.getKey().length()))
                .limit(12)
                .map(e -> new StopSuggestion(e.getValue().name(), e.getValue().lat(), e.getValue().lon()))
                .toList();
    }

    /** Every direct bus between two places today, in boarding order, then tomorrow's if none are left. */
    @GetMapping("/{feed}/between")
    public List<ConnectionDto> between(@PathVariable String feed, @RequestParam String from, @RequestParam String to,
                                       HttpServletResponse response) {
        FeedData data = ready(feed);
        // Short, because which buses have already gone changes through the day.
        cacheFor(response, 60);
        ZonedDateTime now = ZonedDateTime.now(data.zone());
        int nowSec = now.toLocalTime().toSecondOfDay();
        Double radius = registry.get(feed).feed().stopRadiusKm();
        // Many rows share a service, so each service's summary (with its live bus count) is made once.
        Map<String, ServiceSummary> summaries = new HashMap<>();
        return Connections.find(data, from, to, now.getDayOfWeek().getValue(), nowSec,
                        radius != null ? radius : Connections.WALKABLE_KM).stream()
                .limit(MAX_TIMETABLE_ROWS)
                .map(k -> {
                    Service s = k.service();
                    boolean timed = !k.untimed();
                    return new ConnectionDto(summaries.computeIfAbsent(s.id, id -> summary(feed, s, now)), k.trip().id(),
                            timed ? k.boardSec() : null, timed ? k.alightSec() : null,
                            timed ? (k.alightSec() - k.boardSec()) / 60 : null,
                            s.km[k.alightStopIndex()] - s.km[k.boardStopIndex()], s.stops.get(k.boardStopIndex()).name(),
                            s.stops.get(k.alightStopIndex()).name(), k.tomorrow(), timed && !k.tomorrow() && k.boardSec() < nowSec,
                            k.untimed(), s.stops.get(k.boardStopIndex()).platform());
                })
                .toList();
    }

    /** Buses on this service right now, from GPS devices on the buses. */
    @GetMapping("/{feed}/services/{serviceId}/buses")
    public List<LiveBus> liveBuses(@PathVariable String feed, @PathVariable String serviceId) {
        Service s = ready(feed).serviceById().get(serviceId);
        if (s == null) {
            throw notFound("No such service");
        }
        return busesOn(feed, s);
    }

    private List<LiveBus> busesOn(String feed, Service s) {
        long now = Instant.now().getEpochSecond();
        List<LiveBus> buses = new ArrayList<>();
        for (String routeId : s.routeIds) {
            for (LiveVehicles.Vehicle v : vehicles.onRoute(feed, routeId)) {
                Geo.Snap snap = Geo.snap(v.lat(), v.lon(), s.lats, s.lons, s.km);
                // A bus well off its listed route is probably on another duty or heading to a depot.
                if (snap.offRouteKm() <= MIN_ROUTE_TOLERANCE_KM) {
                    buses.add(new LiveBus(v.plate(), snap.km(), Math.max(0, now - v.at().getEpochSecond()), v.lat(), v.lon()));
                }
            }
        }
        return buses;
    }

    @GetMapping("/{feed}/trip/live")
    public LiveStatus live(@PathVariable String feed, @RequestParam("id") String tripId,
                           @RequestParam(value = "run", required = false) String run) {
        trip(ready(feed), tripId);
        String key = tripKey(feed, tripId, run);
        RiderReports.Consensus c = reports.consensus(key);
        RiderReports.LastSeen seen = reports.lastSeen(key);
        Double lastKm = seen == null ? null : seen.km();
        Integer lastAge = seen == null ? null : (int) (Instant.now().getEpochSecond() - seen.at().getEpochSecond());
        if (c == null) {
            return new LiveStatus(0, null, null, null, lastKm, lastAge);
        }
        return new LiveStatus(c.riders(), c.km(), c.gps() ? "gps" : "cell",
                (int) (Instant.now().getEpochSecond() - c.updatedAt().getEpochSecond()), lastKm, lastAge);
    }

    @PostMapping("/{feed}/trip/reports")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void report(@PathVariable String feed, @RequestParam("id") String tripId,
                       @RequestParam(value = "run", required = false) String run, @RequestBody ReportRequest r) {
        FeedData data = ready(feed);
        Trip trip = trip(data, tripId);
        boolean gps = "gps".equals(r.source());
        if ((!gps && !"cell".equals(r.source())) || r.riderId() == null || !RIDER_ID.matcher(r.riderId()).matches()
                || Math.abs(r.lat()) > 90 || Math.abs(r.lon()) > 180
                || !(r.accuracy() >= 0) || r.accuracy() > MAX_ACCURACY_M) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid report");
        }
        Service service = data.serviceById().get(trip.serviceId());
        Geo.Snap snap = Geo.snap(r.lat(), r.lon(), service.lats, service.lons, service.km);
        if (snap.offRouteKm() > Math.max(MIN_ROUTE_TOLERANCE_KM, r.accuracy() / 1000)) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "Position isn't on this route");
        }
        if (!reports.add(tripKey(feed, tripId, run), r.riderId(), snap.km(), gps)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Reporting too often");
        }
    }

    private static final Pattern RUN_DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    /**
     * The key rider reports are kept under. A train's runs from different days can be on the line at
     * once (a 30-hour train), so each run is kept apart by the date it left; buses don't send one.
     */
    private static String tripKey(String feed, String tripId, String run) {
        return run != null && RUN_DATE.matcher(run).matches() ? feed + "/" + tripId + "@" + run : feed + "/" + tripId;
    }

    /** Buses on the route that haven't yet reached its last stop, so a passenger could still catch them. */
    private int busesRunning(String feed, Service s) {
        return (int) busesOn(feed, s).stream().filter(b -> s.totalKm() - b.km() > ROUTE_END_KM).count();
    }

    private ServiceSummary summary(String feed, Service s, ZonedDateTime now) {
        int weekday = now.getDayOfWeek().getValue();
        int nowSec = now.toLocalTime().toSecondOfDay();
        int count = 0;
        Integer next = null;
        for (Trip t : s.trips) {
            if (t.runsOn(weekday)) {
                count++;
                // Trips are sorted by start time, so the first future one is the next.
                if (next == null && t.startSec() >= nowSec) {
                    next = t.startSec();
                }
            }
        }
        int[] durations = s.trips.stream().mapToInt(Trip::durationSec).sorted().toArray();
        return new ServiceSummary(s.id, s.number, s.operator, s.label, s.from(), s.to(), s.stops.size(), s.totalKm(),
                count, durations[durations.length / 2] / 60, next, busesRunning(feed, s), s.color, s.textColor, s.timetabled);
    }

    private static FeedDto toDto(FeedRegistry.Entry e) {
        var f = e.feed();
        FeedData d = e.data();
        if (d == null) {
            return new FeedDto(f.id(), f.name(), f.region(), f.operators(), e.status().name(), e.error(), f.source(),
                    f.sourceUrl(), f.official(), f.numbersAreCodes(), f.realtimeUrl() != null, null, false, false, f.note(), null, null, null, null, null,
                    mode(f));
        }
        return new FeedDto(f.id(), f.name(), f.region(), f.operators(), e.status().name(), null, f.source(),
                f.sourceUrl(), f.official(), f.numbersAreCodes(), f.realtimeUrl() != null, d.validTo(), d.expired(LocalDate.now(d.zone())), d.timesRepaired(),
                f.note(), d.zone().getId(), d.services().size(), d.tripById().size(), d.stops().size(), d.loadedAt(), mode(f));
    }

    private static String mode(FeedProperties.Feed f) {
        return f.mode() == null ? "bus" : f.mode();
    }

    private FeedData ready(String feed) {
        FeedRegistry.Entry e = registry.get(feed);
        if (e == null) {
            throw notFound("No such feed");
        }
        if (e.data() == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Feed is still loading");
        }
        return e.data();
    }

    private static Trip trip(FeedData data, String tripId) {
        Trip t = data.tripById().get(tripId);
        if (t == null) {
            throw notFound("No such trip");
        }
        return t;
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }
}
