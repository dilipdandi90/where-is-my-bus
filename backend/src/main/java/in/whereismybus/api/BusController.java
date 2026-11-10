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

    public record Departure(String tripId, int startSec, int durationSec) {}

    /**
     * @param untimedTripId for a line with no timetable, the trip to track and share live, otherwise null
     */
    public record ServiceDetail(String serviceId, String number, String operator, String label, String from,
                                String to, double km, String timezone, List<StopDto> stops,
                                List<Departure> departures, String color, String textColor, boolean timetabled,
                                String untimedTripId) {}

    public record TripDetail(String tripId, String serviceId, int startSec, int[] offsets) {}

    public record StopSuggestion(String name, double lat, double lon) {}

    /**
     * @param departed whether this bus has already left the boarding stop today
     * @param untimed a line with no timetable: boardSec, alightSec and minutes are null
     * @param boardPlatform the platform to board from, where the feed gives one, otherwise empty
     */
    public record ConnectionDto(ServiceSummary service, String tripId, Integer boardSec, Integer alightSec, Integer minutes,
                                double km, String boardStop, String alightStop, boolean tomorrow, boolean departed,
                                boolean untimed, String boardPlatform) {}

    public record LiveStatus(int riders, Double km, String source, Integer ageSec) {}

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
        List<Departure> departures = s.trips.stream().filter(t -> t.runsOn(weekday))
                .map(t -> new Departure(t.id(), t.startSec(), t.durationSec())).toList();
        return new ServiceDetail(s.id, s.number, s.operator, s.label, s.from(), s.to(), s.totalKm(),
                data.zone().getId(), stops, departures, s.color, s.textColor, s.timetabled,
                s.timetabled ? null : s.trips.getFirst().id());
    }

    // Trip IDs go in the query string: some contain backslashes (MSRTC's L5674\5), and the web
    // server rejects those in a URL path before the request gets here.
    @GetMapping("/{feed}/trip")
    public TripDetail trip(@PathVariable String feed, @RequestParam("id") String tripId, HttpServletResponse response) {
        Trip t = trip(ready(feed), tripId);
        cacheFor(response, 6 * 3600);
        return new TripDetail(t.id(), t.serviceId(), t.startSec(), t.offsets());
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
    public LiveStatus live(@PathVariable String feed, @RequestParam("id") String tripId) {
        trip(ready(feed), tripId);
        RiderReports.Consensus c = reports.consensus(feed + "/" + tripId);
        if (c == null) {
            return new LiveStatus(0, null, null, null);
        }
        return new LiveStatus(c.riders(), c.km(), c.gps() ? "gps" : "cell",
                (int) (Instant.now().getEpochSecond() - c.updatedAt().getEpochSecond()));
    }

    @PostMapping("/{feed}/trip/reports")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void report(@PathVariable String feed, @RequestParam("id") String tripId, @RequestBody ReportRequest r) {
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
        if (!reports.add(feed + "/" + tripId, r.riderId(), snap.km(), gps)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Reporting too often");
        }
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
