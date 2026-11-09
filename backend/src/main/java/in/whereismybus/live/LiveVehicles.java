package in.whereismybus.live;

import com.google.transit.realtime.GtfsRealtime;
import in.whereismybus.gtfs.FeedProperties;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Positions from GPS devices on the buses themselves, for feeds that publish them in the standard
 * GTFS-Realtime format. Only fetched while someone is asking, and no more often than the source updates.
 */
@Component
public class LiveVehicles {
    private static final Logger log = LoggerFactory.getLogger(LiveVehicles.class);
    private static final Duration REFRESH_AFTER = Duration.ofSeconds(20);
    /** Older than this and a position says more about where the bus was than where it is. */
    static final Duration FRESH_FOR = Duration.ofMinutes(10);

    /** @param plate the registration number painted on the bus */
    public record Vehicle(String plate, String routeId, double lat, double lon, Instant at) {}

    private static final class Source {
        final ReentrantLock lock = new ReentrantLock();
        volatile List<Vehicle> vehicles = List.of();
        volatile Instant checkedAt = Instant.EPOCH;
        volatile String etag;
    }

    private final Map<String, String> urls = new ConcurrentHashMap<>();
    private final Map<String, Source> sources = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(8))
            .build();

    public LiveVehicles(FeedProperties props) {
        for (var feed : props.feeds()) {
            if (feed.realtimeUrl() != null && !feed.realtimeUrl().isBlank()) {
                urls.put(feed.id(), feed.realtimeUrl());
            }
        }
    }

    /** Recent positions for one route, or none if this feed has no live source or it's down. */
    public List<Vehicle> onRoute(String feedId, String routeId) {
        return fresh(feedId).stream().filter(v -> v.routeId().equals(routeId)).toList();
    }

    private List<Vehicle> fresh(String feedId) {
        String url = urls.get(feedId);
        if (url == null) {
            return List.of();
        }
        Source source = sources.computeIfAbsent(feedId, k -> new Source());
        Instant now = Instant.now();
        // Whoever gets the lock refreshes, and everyone else carries on with what's there.
        if (source.checkedAt.plus(REFRESH_AFTER).isBefore(now) && source.lock.tryLock()) {
            try {
                refresh(source, url);
                source.checkedAt = now;
            } catch (IOException | RuntimeException e) {
                // The last positions stay usable until they go stale, so a blip doesn't hide buses.
                log.warn("Couldn't refresh live buses for {}: {}", feedId, e.getMessage());
                source.checkedAt = now;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                source.lock.unlock();
            }
        }
        Instant cutoff = now.minus(FRESH_FOR);
        return source.vehicles.stream().filter(v -> v.at().isAfter(cutoff)).toList();
    }

    private void refresh(Source source, String url) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(12))
                .header("User-Agent", "where-is-my-bus/0.1");
        if (source.etag != null) {
            request.header("If-None-Match", source.etag);
        }
        HttpResponse<byte[]> response = http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() == 304) {
            return;
        }
        if (response.statusCode() != 200) {
            throw new IOException("HTTP " + response.statusCode());
        }
        source.vehicles = parse(response.body());
        source.etag = response.headers().firstValue("ETag").orElse(null);
    }

    static List<Vehicle> parse(byte[] body) throws IOException {
        var message = GtfsRealtime.FeedMessage.parseFrom(new ByteArrayInputStream(body));
        List<Vehicle> vehicles = new ArrayList<>(message.getEntityCount());
        for (var entity : message.getEntityList()) {
            var v = entity.getVehicle();
            if (entity.hasVehicle() && v.hasPosition() && v.hasTimestamp() && v.getTrip().hasRouteId()) {
                String plate = v.getVehicle().hasLicensePlate() ? v.getVehicle().getLicensePlate() : v.getVehicle().getId();
                vehicles.add(new Vehicle(plate, v.getTrip().getRouteId(), v.getPosition().getLatitude(),
                        v.getPosition().getLongitude(), Instant.ofEpochSecond(v.getTimestamp())));
            }
        }
        return vehicles;
    }
}
