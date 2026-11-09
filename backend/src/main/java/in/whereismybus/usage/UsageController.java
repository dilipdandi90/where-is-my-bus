package in.whereismybus.usage;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Takes in usage events from people who agreed, and shows the totals to whoever holds the admin key. */
@RestController
@RequestMapping("/api/usage")
public class UsageController {
    private static final Logger log = LoggerFactory.getLogger(UsageController.class);
    private static final Set<String> EVENTS = Set.of("search", "between", "open_bus", "tracking", "area");
    private static final Pattern DEVICE_ID = Pattern.compile("[A-Za-z0-9-]{8,64}");
    private static final int MAX_TEXT = 100;

    private final UsageStore store;
    private final String adminKey;

    public UsageController(UsageStore store, @Value("${ADMIN_KEY:}") String adminKey) {
        this.store = store;
        this.adminKey = adminKey;
    }

    public record EventRequest(String deviceId, String event, String feed, String text, String text2, String bus,
                               Integer results, Double lat, Double lon) {}

    public record ForgetRequest(String deviceId) {}

    public record Status(boolean enabled) {}

    @GetMapping("/status")
    public Status status() {
        return new Status(store.enabled());
    }

    @PostMapping("/events")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void event(@RequestBody EventRequest r) {
        requireDevice(r.deviceId());
        if (r.event() == null || !EVENTS.contains(r.event())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown event");
        }
        store.add(new UsageStore.Event(Instant.now(), r.deviceId(), r.event(), trim(r.feed()), trim(r.text()), trim(r.text2()),
                trim(r.bus()), r.results(), roundToArea(r.lat(), 90), roundToArea(r.lon(), 180)));
    }

    @PostMapping("/forget")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void forget(@RequestBody ForgetRequest r) {
        requireDevice(r.deviceId());
        try {
            store.forget(r.deviceId());
        } catch (SQLException e) {
            log.warn("Couldn't delete a device's usage events: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Try again");
        }
    }

    @GetMapping("/summary")
    public Map<String, Object> summary(@RequestHeader(value = "X-Admin-Key", required = false) String key) {
        if (adminKey.isBlank() || !store.enabled()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Not set up");
        }
        if (key == null || !MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8), adminKey.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Wrong key");
        }
        try {
            return store.summary();
        } catch (SQLException e) {
            log.warn("Couldn't read usage summary: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Try again");
        }
    }

    /**
     * Rounds to one decimal place, about 11 km: enough to tell which city someone is in, and not where
     * they are in it. Done here as well as in the app, so an exact position can't reach the database.
     */
    static Double roundToArea(Double degrees, double limit) {
        if (degrees == null || degrees.isNaN() || Math.abs(degrees) > limit) {
            return null;
        }
        return Math.round(degrees * 10) / 10.0;
    }

    private static void requireDevice(String id) {
        if (id == null || !DEVICE_ID.matcher(id).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid device");
        }
    }

    private static String trim(String text) {
        return text == null || text.length() <= MAX_TEXT ? text : text.substring(0, MAX_TEXT);
    }
}
