package in.whereismybus.gtfs;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps each configured feed downloaded and loaded. A failed refresh keeps serving the last good
 * copy, and a feed that's never loaded reports why rather than failing the whole app.
 */
@Component
public class FeedRegistry {
    private static final Logger log = LoggerFactory.getLogger(FeedRegistry.class);

    public enum Status { LOADING, READY, FAILED }

    public record Entry(FeedProperties.Feed feed, Status status, FeedData data, String error) {}

    private final FeedProperties props;
    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final ReentrantLock refreshLock = new ReentrantLock();
    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(30))
            .build();

    public FeedRegistry(FeedProperties props) {
        this.props = props;
    }

    @PostConstruct
    void start() {
        props.feeds().forEach(f -> entries.put(f.id(), new Entry(f, Status.LOADING, null, null)));
        // One at a time, because parsing several large feeds at once needs far more memory than holding them.
        Thread.ofVirtual().name("feed-loader").start(() -> props.feeds().forEach(this::refresh));
    }

    /** Also picks up feeds that failed, so a network drop at startup only costs a few minutes. */
    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT5M")
    void refreshDue() {
        for (var feed : props.feeds()) {
            if (entries.get(feed.id()).status() == Status.FAILED || isStale(zipPath(feed))) {
                refresh(feed);
            }
        }
    }

    public List<Entry> all() {
        return props.feeds().stream().map(f -> entries.get(f.id())).toList();
    }

    public Entry get(String id) {
        return entries.get(id);
    }

    private void refresh(FeedProperties.Feed feed) {
        // A slow startup can still be running when the first scheduled refresh arrives.
        refreshLock.lock();
        try {
            loadLatest(feed);
        } finally {
            refreshLock.unlock();
        }
    }

    private void loadLatest(FeedProperties.Feed feed) {
        Path zip = zipPath(feed);
        Entry current = entries.get(feed.id());
        if (current.data() != null && !isStale(zip)) {
            return;
        }
        try {
            if (isStale(zip)) {
                try {
                    download(feed, zip);
                } catch (IOException e) {
                    if (!Files.exists(zip)) {
                        throw e;
                    }
                    log.warn("Couldn't refresh {}, using cached copy: {}", feed.id(), e.getMessage());
                }
            }
            long start = System.currentTimeMillis();
            FeedData data = GtfsLoader.load(zip, feed.numberRule());
            entries.put(feed.id(), new Entry(feed, Status.READY, data, null));
            log.info("Loaded {}: {} services, {} trips in {} ms{}", feed.id(), data.services().size(),
                    data.tripById().size(), System.currentTimeMillis() - start,
                    data.timesRepaired() ? " (repaired corrupt stop times)" : "");
        } catch (Exception e) {
            log.error("Couldn't load feed {}", feed.id(), e);
            Entry old = entries.get(feed.id());
            if (old == null || old.data() == null) {
                entries.put(feed.id(), new Entry(feed, Status.FAILED, null, e.getMessage()));
            }
        }
    }

    private void download(FeedProperties.Feed feed, Path zip) throws IOException {
        log.info("Downloading {} from {}", feed.id(), feed.url());
        Files.createDirectories(zip.getParent());
        Path tmp = zip.resolveSibling(zip.getFileName() + ".part");
        HttpRequest request = HttpRequest.newBuilder(URI.create(feed.url()))
                .timeout(Duration.ofMinutes(5))
                .header("User-Agent", "where-is-my-bus/0.1")
                .build();
        try {
            HttpResponse<Path> response = http.send(request, HttpResponse.BodyHandlers.ofFile(tmp));
            if (response.statusCode() != 200) {
                throw new IOException("HTTP " + response.statusCode() + " from " + feed.url());
            }
            Files.move(tmp, zip, StandardCopyOption.REPLACE_EXISTING);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while downloading", e);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    private boolean isStale(Path zip) {
        try {
            return !Files.exists(zip) || Files.getLastModifiedTime(zip).toInstant()
                    .isBefore(Instant.now().minus(Duration.ofHours(props.refreshAfterHours())));
        } catch (IOException e) {
            return true;
        }
    }

    private Path zipPath(FeedProperties.Feed feed) {
        return Path.of(props.dataDir()).resolve(feed.id() + ".zip");
    }
}
