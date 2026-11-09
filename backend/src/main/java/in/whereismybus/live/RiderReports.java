package in.whereismybus.live;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Positions shared by riders on a bus, so people not on it can see where it is. Held in memory
 * only and forgotten after a few minutes: there are no accounts, and rider IDs are random per visit.
 * Only the distance along the route is kept, never the coordinates.
 */
@Component
public class RiderReports {
    static final Duration FRESH_FOR = Duration.ofMinutes(3);
    private static final Duration MIN_INTERVAL = Duration.ofSeconds(3);
    private static final int MAX_TRIPS = 50_000;
    private static final int MAX_RIDERS_PER_TRIP = 200;

    private record Report(double km, boolean gps, Instant at) {}

    /** The bus position agreed by riders on it. */
    public record Consensus(int riders, double km, boolean gps, Instant updatedAt) {}

    private final Map<String, Map<String, Report>> byTrip = new ConcurrentHashMap<>();

    /** @return false if this rider reported too recently, or capacity has been reached */
    public boolean add(String tripKey, String riderId, double km, boolean gps) {
        return add(tripKey, riderId, km, gps, Instant.now());
    }

    boolean add(String tripKey, String riderId, double km, boolean gps, Instant now) {
        if (byTrip.size() >= MAX_TRIPS && !byTrip.containsKey(tripKey)) {
            return false;
        }
        Map<String, Report> riders = byTrip.computeIfAbsent(tripKey, k -> new ConcurrentHashMap<>());
        Report last = riders.get(riderId);
        if (last != null && last.at().plus(MIN_INTERVAL).isAfter(now)) {
            return false;
        }
        if (last == null && riders.size() >= MAX_RIDERS_PER_TRIP) {
            return false;
        }
        riders.put(riderId, new Report(km, gps, now));
        return true;
    }

    /** @return null when nobody has reported recently */
    public Consensus consensus(String tripKey) {
        return consensus(tripKey, Instant.now());
    }

    Consensus consensus(String tripKey, Instant now) {
        Map<String, Report> riders = byTrip.get(tripKey);
        if (riders == null) {
            return null;
        }
        Instant cutoff = now.minus(FRESH_FOR);
        var fresh = riders.values().stream().filter(r -> r.at().isAfter(cutoff)).toList();
        if (fresh.isEmpty()) {
            return null;
        }
        // GPS is far more precise than cell positioning, so cell reports only count when alone.
        boolean anyGps = fresh.stream().anyMatch(Report::gps);
        var used = fresh.stream().filter(r -> r.gps() == anyGps).toList();
        // The median means one wrong or dishonest report can't move the bus.
        double[] km = used.stream().mapToDouble(Report::km).sorted().toArray();
        Instant latest = used.stream().map(Report::at).max(Instant::compareTo).orElse(now);
        return new Consensus(fresh.size(), km[km.length / 2], anyGps, latest);
    }

    @Scheduled(fixedDelayString = "PT1M")
    void forgetOld() {
        Instant cutoff = Instant.now().minus(FRESH_FOR);
        byTrip.values().forEach(riders -> riders.values().removeIf(r -> r.at().isBefore(cutoff)));
        byTrip.values().removeIf(Map::isEmpty);
    }
}
