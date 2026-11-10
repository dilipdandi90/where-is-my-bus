package in.whereismybus.api;

import in.whereismybus.gtfs.FeedData;
import in.whereismybus.gtfs.FeedData.Service;
import in.whereismybus.gtfs.FeedData.Trip;
import in.whereismybus.gtfs.FeedRegistry;
import in.whereismybus.gtfs.Geo;
import in.whereismybus.live.FamilyShares;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Share links a rider sends to family, so they can watch the bus without the app. See {@link FamilyShares}. */
@RestController
@RequestMapping("/api/shares")
public class ShareController {
    private static final double MAX_ACCURACY_M = 5000;
    private static final double MIN_ROUTE_TOLERANCE_KM = 1;

    private final FeedRegistry registry;
    private final FamilyShares shares;

    public ShareController(FeedRegistry registry, FamilyShares shares) {
        this.registry = registry;
        this.shares = shares;
    }

    public record CreateRequest(String feed, String tripId) {}

    public record PositionRequest(String key, double lat, double lon, double accuracy, String source) {}

    public record EndRequest(String key) {}

    /**
     * What someone opening the link sees.
     *
     * @param km null until the rider's phone has sent a position on the route
     * @param ageSec seconds since that position, or null
     */
    public record ShareView(String feed, String serviceId, String tripId, Double km, String source, Integer ageSec,
                            boolean ended) {}

    @PostMapping
    public FamilyShares.Created create(@RequestBody CreateRequest r) {
        FeedData data = ready(r.feed());
        Trip trip = r.tripId() == null ? null : data.tripById().get(r.tripId());
        if (trip == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such trip");
        }
        FamilyShares.Created created = shares.create(r.feed(), trip.serviceId(), trip.id());
        if (created == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Too many shares right now");
        }
        return created;
    }

    @GetMapping("/{token}")
    public ShareView view(@PathVariable String token) {
        FamilyShares.Share s = found(token);
        Integer age = s.updatedAt() == null ? null : (int) (Instant.now().getEpochSecond() - s.updatedAt().getEpochSecond());
        return new ShareView(s.feed(), s.serviceId(), s.tripId(), s.km(), s.km() == null ? null : s.gps() ? "gps" : "cell",
                age, s.ended());
    }

    @PostMapping("/{token}/position")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void position(@PathVariable String token, @RequestBody PositionRequest r) {
        FamilyShares.Share s = found(token);
        boolean gps = "gps".equals(r.source());
        if ((!gps && !"cell".equals(r.source())) || Math.abs(r.lat()) > 90 || Math.abs(r.lon()) > 180
                || !(r.accuracy() >= 0) || r.accuracy() > MAX_ACCURACY_M) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid position");
        }
        Service service = ready(s.feed()).serviceById().get(s.serviceId());
        if (service == null) {
            throw new ResponseStatusException(HttpStatus.GONE, "This bus is no longer in the timetable");
        }
        Geo.Snap snap = Geo.snap(r.lat(), r.lon(), service.lats, service.lons, service.km);
        if (snap.offRouteKm() > Math.max(MIN_ROUTE_TOLERANCE_KM, r.accuracy() / 1000)) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "Position isn't on this route");
        }
        check(shares.update(token, r.key(), snap.km(), gps));
    }

    @PostMapping("/{token}/end")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void end(@PathVariable String token, @RequestBody EndRequest r) {
        check(shares.end(token, r.key()));
    }

    private FamilyShares.Share found(String token) {
        FamilyShares.Share s = shares.get(token);
        if (s == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This link has expired");
        }
        return s;
    }

    private static void check(FamilyShares.Result result) {
        switch (result) {
            case OK -> { }
            case NOT_FOUND -> throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This link has ended");
            case WRONG_KEY -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not your share");
            case TOO_SOON -> throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Updating too often");
        }
    }

    private FeedData ready(String feed) {
        FeedRegistry.Entry e = feed == null ? null : registry.get(feed);
        if (e == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such feed");
        }
        if (e.data() == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Feed is still loading");
        }
        return e.data();
    }
}
