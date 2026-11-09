package in.whereismybus.cell;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Looks up towers in OpenCelliD's public database, which needs a free API key. Without a key this
 * does nothing and the app relies on learned towers and network location. Answers are cached,
 * because the free tier limits requests per day.
 */
@Component
public class OpenCellIdClient {
    private static final Logger log = LoggerFactory.getLogger(OpenCellIdClient.class);
    private static final Duration KNOWN_FOR = Duration.ofDays(30);
    private static final Duration UNKNOWN_FOR = Duration.ofDays(1);
    private static final int CELL_NOT_FOUND = 1;
    private static final int MAX_CACHED = 200_000;
    /** Used when the database doesn't say how far a tower reaches. */
    private static final double DEFAULT_RANGE_M = 2000;

    private record Cached(Optional<Tower.Position> position, Instant until) {}

    private final String key;
    private final String url;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private final JsonMapper json = JsonMapper.builder().build();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public OpenCellIdClient(@Value("${wimb.opencellid.key:}") String key,
                            @Value("${wimb.opencellid.url:https://opencellid.org/cell/get}") String url) {
        this.key = key;
        this.url = url;
    }

    public boolean isConfigured() {
        return !key.isBlank();
    }

    /** @return null if the tower is unknown, no key is set, or the service can't be reached */
    public Tower.Position find(Tower tower) {
        if (!isConfigured()) {
            return null;
        }
        Cached cached = cache.get(tower.key());
        if (cached != null && cached.until().isAfter(Instant.now())) {
            return cached.position().orElse(null);
        }
        try {
            Optional<Tower.Position> found = fetch(tower);
            if (cache.size() >= MAX_CACHED) {
                cache.clear();
            }
            cache.put(tower.key(), new Cached(found, Instant.now().plus(found.isPresent() ? KNOWN_FOR : UNKNOWN_FOR)));
            return found.orElse(null);
        } catch (IOException | RuntimeException e) {
            // Left uncached: an outage or used-up quota doesn't mean the tower is unknown.
            log.warn("OpenCelliD lookup failed: {}", e.getMessage());
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    private Optional<Tower.Position> fetch(Tower t) throws IOException, InterruptedException {
        URI uri = URI.create(url + "?key=" + key + "&mcc=" + t.mcc() + "&mnc=" + t.mnc()
                + "&lac=" + t.lac() + "&cellid=" + t.cid() + "&format=json");
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(8)).build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode body = json.readTree(response.body());
        if (body.has("lat") && body.has("lon")) {
            double range = body.path("range").asDouble(0);
            return Optional.of(new Tower.Position(body.get("lat").asDouble(), body.get("lon").asDouble(),
                    range > 0 ? range : DEFAULT_RANGE_M, "opencellid"));
        }
        if (body.path("code").asInt(-1) == CELL_NOT_FOUND) {
            return Optional.empty();
        }
        throw new IOException("Unexpected response: HTTP " + response.statusCode());
    }
}
