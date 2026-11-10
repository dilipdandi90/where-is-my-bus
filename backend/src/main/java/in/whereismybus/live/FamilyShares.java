package in.whereismybus.live;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Links a rider makes to show family or friends their bus moving. A rider starts one on purpose and
 * can stop it at any time; it also ends by itself after a while. Held in memory only, and like rider
 * reports, only the distance along the route is kept, never the coordinates.
 *
 * Each share has two random values: the token, which goes in the link and only lets people watch,
 * and the key, which stays on the rider's phone and is needed to update or stop the share.
 */
@Component
public class FamilyShares {
    /** Longer than any bus journey in these feeds, so a share never ends mid-trip by itself. */
    static final Duration LASTS_FOR = Duration.ofHours(18);
    private static final Duration MIN_INTERVAL = Duration.ofSeconds(3);
    private static final int MAX_SHARES = 20_000;
    private static final SecureRandom RANDOM = new SecureRandom();

    /** @param km null until the first position arrives */
    public record Share(String feed, String serviceId, String tripId, String key, Instant expiresAt,
                        Double km, boolean gps, Instant updatedAt, boolean ended) {
        Share withPosition(double newKm, boolean newGps, Instant at) {
            return new Share(feed, serviceId, tripId, key, expiresAt, newKm, newGps, at, ended);
        }

        Share asEnded() {
            return new Share(feed, serviceId, tripId, key, expiresAt, km, gps, updatedAt, true);
        }
    }

    public record Created(String token, String key) {}

    private final Map<String, Share> shares = new ConcurrentHashMap<>();

    /** @return null when the limit on shares has been reached */
    public Created create(String feed, String serviceId, String tripId) {
        return create(feed, serviceId, tripId, Instant.now());
    }

    Created create(String feed, String serviceId, String tripId, Instant now) {
        if (shares.size() >= MAX_SHARES) {
            return null;
        }
        String token = randomId();
        String key = randomId();
        shares.put(token, new Share(feed, serviceId, tripId, key, now.plus(LASTS_FOR), null, false, null, false));
        return new Created(token, key);
    }

    /** @return null if there's no such share, it has ended, or it has expired */
    public Share get(String token) {
        return get(token, Instant.now());
    }

    Share get(String token, Instant now) {
        Share s = token == null ? null : shares.get(token);
        return s == null || s.expiresAt().isBefore(now) ? null : s;
    }

    public enum Result { OK, NOT_FOUND, WRONG_KEY, TOO_SOON }

    public Result update(String token, String key, double km, boolean gps) {
        return update(token, key, km, gps, Instant.now());
    }

    Result update(String token, String key, double km, boolean gps, Instant now) {
        Share s = get(token, now);
        if (s == null || s.ended()) {
            return Result.NOT_FOUND;
        }
        if (!s.key().equals(key)) {
            return Result.WRONG_KEY;
        }
        if (s.updatedAt() != null && s.updatedAt().plus(MIN_INTERVAL).isAfter(now)) {
            return Result.TOO_SOON;
        }
        shares.put(token, s.withPosition(km, gps, now));
        return Result.OK;
    }

    /** Ends the share but keeps it for a while, so anyone watching sees that it was stopped. */
    public Result end(String token, String key) {
        return end(token, key, Instant.now());
    }

    Result end(String token, String key, Instant now) {
        Share s = get(token, now);
        if (s == null) {
            return Result.NOT_FOUND;
        }
        if (!s.key().equals(key)) {
            return Result.WRONG_KEY;
        }
        shares.put(token, s.asEnded());
        return Result.OK;
    }

    private static String randomId() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @Scheduled(fixedDelayString = "PT10M")
    void forgetExpired() {
        Instant now = Instant.now();
        shares.values().removeIf(s -> s.expiresAt().isBefore(now));
    }
}
