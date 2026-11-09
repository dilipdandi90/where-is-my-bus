package in.whereismybus.usage;

import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Usage events from people who agreed to share them, kept in Postgres because hosting disks can be
 * wiped on restart. Without DATABASE_URL this is switched off and the app never asks for consent.
 * Connects only to write a batch, because a connection pool would use memory the timetables need.
 */
@Component
public class UsageStore {
    private static final Logger log = LoggerFactory.getLogger(UsageStore.class);
    private static final int MAX_QUEUED = 5000;
    private static final Duration KEEP_FOR = Duration.ofDays(365);
    private static final int SUMMARY_DAYS = 30;

    /**
     * @param text what was searched, or the tracking method chosen
     * @param text2 the destination stop in a between-stops search
     * @param lat already rounded, so an exact position can never reach the database
     */
    public record Event(Instant at, String deviceId, String event, String feed, String text, String text2,
                        String bus, Integer results, Double lat, Double lon) {}

    record Connect(String url, String user, String password) {}

    private final Connect connect;
    private final Queue<Event> queue = new ConcurrentLinkedQueue<>();
    private final AtomicInteger queued = new AtomicInteger();
    private volatile boolean tableReady;

    public UsageStore(@Value("${DATABASE_URL:}") String databaseUrl) {
        this.connect = databaseUrl.isBlank() ? null : parse(databaseUrl);
    }

    public boolean enabled() {
        return connect != null;
    }

    /** Accepts the postgres://user:pass@host/db form that database providers hand out. */
    static Connect parse(String url) {
        if (url.startsWith("jdbc:")) {
            return new Connect(url, null, null);
        }
        URI uri = URI.create(url);
        String[] login = uri.getUserInfo() == null ? new String[0] : uri.getUserInfo().split(":", 2);
        String port = uri.getPort() > 0 ? ":" + uri.getPort() : "";
        String query = uri.getQuery() == null ? "" : "?" + uri.getQuery().replace("channel_binding=require", "").replaceAll("&$|^&", "");
        return new Connect("jdbc:postgresql://" + uri.getHost() + port + uri.getPath() + query,
                login.length > 0 ? login[0] : null, login.length > 1 ? login[1] : null);
    }

    public void add(Event event) {
        if (enabled() && queued.get() < MAX_QUEUED) {
            queue.add(event);
            queued.incrementAndGet();
        }
    }

    @Scheduled(fixedDelayString = "PT30S", initialDelayString = "PT30S")
    @PreDestroy
    void flush() {
        if (!enabled() || queue.isEmpty()) {
            return;
        }
        List<Event> batch = new ArrayList<>();
        for (Event e = queue.poll(); e != null; e = queue.poll()) {
            batch.add(e);
            queued.decrementAndGet();
        }
        try (Connection c = open(); PreparedStatement insert = c.prepareStatement("""
                INSERT INTO usage_events (at, device_id, event, feed, text, text2, bus, results, lat, lon)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")) {
            for (Event e : batch) {
                insert.setTimestamp(1, Timestamp.from(e.at()));
                insert.setString(2, e.deviceId());
                insert.setString(3, e.event());
                insert.setString(4, e.feed());
                insert.setString(5, e.text());
                insert.setString(6, e.text2());
                insert.setString(7, e.bus());
                insert.setObject(8, e.results(), Types.INTEGER);
                insert.setObject(9, e.lat(), Types.DOUBLE);
                insert.setObject(10, e.lon(), Types.DOUBLE);
                insert.addBatch();
            }
            insert.executeBatch();
        } catch (SQLException e) {
            // Tried again on the next round, so a database that's waking up loses nothing.
            log.warn("Couldn't save usage events: {}", e.getMessage());
            batch.forEach(this::add);
        }
    }

    /** Removes everything from one device, for someone who changes their mind. */
    public void forget(String deviceId) throws SQLException {
        queue.removeIf(e -> {
            boolean match = e.deviceId().equals(deviceId);
            if (match) {
                queued.decrementAndGet();
            }
            return match;
        });
        if (enabled()) {
            try (Connection c = open(); PreparedStatement delete = c.prepareStatement("DELETE FROM usage_events WHERE device_id = ?")) {
                delete.setString(1, deviceId);
                delete.executeUpdate();
            }
        }
    }

    @Scheduled(fixedDelayString = "P1D", initialDelayString = "PT10M")
    void deleteOld() {
        if (!enabled()) {
            return;
        }
        try (Connection c = open(); PreparedStatement delete = c.prepareStatement("DELETE FROM usage_events WHERE at < ?")) {
            delete.setTimestamp(1, Timestamp.from(Instant.now().minus(KEEP_FOR)));
            delete.executeUpdate();
        } catch (SQLException e) {
            log.warn("Couldn't delete old usage events: {}", e.getMessage());
        }
    }

    /** What people have done over the last 30 days. */
    public Map<String, Object> summary() throws SQLException {
        flush();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("days", SUMMARY_DAYS);
        try (Connection c = open()) {
            String recent = "at > now() - interval '" + SUMMARY_DAYS + " days'";
            out.put("users", rows(c, "SELECT count(DISTINCT device_id) AS count, count(*) AS events FROM usage_events WHERE " + recent).getFirst());
            out.put("perDay", rows(c, "SELECT to_char(at, 'YYYY-MM-DD') AS label, count(DISTINCT device_id) AS count FROM usage_events WHERE "
                    + recent + " GROUP BY 1 ORDER BY 1 DESC LIMIT 14"));
            out.put("regions", rows(c, "SELECT feed AS label, count(DISTINCT device_id) AS count FROM usage_events WHERE feed IS NOT NULL AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC"));
            out.put("searches", rows(c, "SELECT lower(text) AS label, count(*) AS count FROM usage_events WHERE event = 'search' AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC LIMIT 20"));
            out.put("noResults", rows(c, "SELECT lower(text) AS label, count(*) AS count FROM usage_events WHERE event = 'search' AND results = 0 AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC LIMIT 20"));
            out.put("routes", rows(c, "SELECT text || ' → ' || text2 AS label, count(*) AS count FROM usage_events WHERE event = 'between' AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC LIMIT 20"));
            out.put("buses", rows(c, "SELECT feed || ' · ' || bus AS label, count(*) AS count FROM usage_events WHERE event = 'open_bus' AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC LIMIT 20"));
            out.put("tracking", rows(c, "SELECT text AS label, count(*) AS count FROM usage_events WHERE event = 'tracking' AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC"));
            out.put("areas", rows(c, "SELECT lat || ',' || lon AS label, count(DISTINCT device_id) AS count FROM usage_events WHERE event = 'area' AND "
                    + recent + " GROUP BY 1 ORDER BY 2 DESC LIMIT 30"));
        }
        return out;
    }

    private static List<Map<String, Object>> rows(Connection c, String sql) throws SQLException {
        // Every value in these queries is a constant from this class, never anything a user sent.
        try (PreparedStatement query = c.prepareStatement(sql); ResultSet r = query.executeQuery()) {
            List<Map<String, Object>> out = new ArrayList<>();
            int columns = r.getMetaData().getColumnCount();
            while (r.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= columns; i++) {
                    row.put(r.getMetaData().getColumnLabel(i), r.getObject(i));
                }
                out.add(row);
            }
            return out;
        }
    }

    private Connection open() throws SQLException {
        Connection c = connect.user() == null
                ? DriverManager.getConnection(connect.url())
                : DriverManager.getConnection(connect.url(), connect.user(), connect.password());
        if (!tableReady) {
            try (PreparedStatement create = c.prepareStatement("""
                    CREATE TABLE IF NOT EXISTS usage_events (
                        id bigserial PRIMARY KEY,
                        at timestamptz NOT NULL,
                        device_id text NOT NULL,
                        event text NOT NULL,
                        feed text,
                        text text,
                        text2 text,
                        bus text,
                        results integer,
                        lat double precision,
                        lon double precision
                    )""")) {
                create.execute();
            }
            tableReady = true;
        }
        return c;
    }
}
