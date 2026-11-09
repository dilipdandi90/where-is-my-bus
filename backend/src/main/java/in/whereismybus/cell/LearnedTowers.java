package in.whereismybus.cell;

import in.whereismybus.gtfs.FeedProperties;
import in.whereismybus.gtfs.Geo;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * A tower map built from riders. When a phone in GPS mode reports the tower it's connected to, the
 * position counts towards where that tower's coverage is centred. Only tower positions are kept,
 * with nothing about who reported them. Saved to disk so the map survives restarts.
 */
@Component
public class LearnedTowers {
    private static final Logger log = LoggerFactory.getLogger(LearnedTowers.class);
    static final int MIN_SAMPLES = 3;
    static final double MAX_SAMPLE_ACCURACY_M = 100;
    /** Further than any real tower reaches, so a sample this far from the rest is bad data. */
    static final double MAX_PLAUSIBLE_KM = 35;
    private static final double MIN_RANGE_M = 500;
    private static final int MAX_TOWERS = 500_000;

    private static final class Learned {
        double lat;
        double lon;
        int samples;
        double furthestM;
    }

    private final Map<String, Learned> towers = new ConcurrentHashMap<>();
    private final AtomicBoolean dirty = new AtomicBoolean();
    private final Path file;

    public LearnedTowers(FeedProperties props) {
        this.file = Path.of(props.dataDir()).resolve("learned-towers.csv");
    }

    /** @return false if the sample was too imprecise or implausible to use */
    public boolean learn(Tower tower, double lat, double lon, double accuracyM) {
        if (accuracyM > MAX_SAMPLE_ACCURACY_M) {
            return false;
        }
        if (!towers.containsKey(tower.key()) && towers.size() >= MAX_TOWERS) {
            return false;
        }
        Learned t = towers.computeIfAbsent(tower.key(), k -> new Learned());
        synchronized (t) {
            if (t.samples == 0) {
                t.lat = lat;
                t.lon = lon;
            } else {
                double km = Geo.km(t.lat, t.lon, lat, lon);
                if (km > MAX_PLAUSIBLE_KM) {
                    return false;
                }
                t.furthestM = Math.max(t.furthestM, km * 1000);
                t.lat += (lat - t.lat) / (t.samples + 1);
                t.lon += (lon - t.lon) / (t.samples + 1);
            }
            t.samples++;
        }
        dirty.set(true);
        return true;
    }

    /** @return null until enough riders have reported this tower to trust its position */
    public Tower.Position find(Tower tower) {
        Learned t = towers.get(tower.key());
        if (t == null) {
            return null;
        }
        synchronized (t) {
            return t.samples < MIN_SAMPLES ? null
                    : new Tower.Position(t.lat, t.lon, Math.max(MIN_RANGE_M, t.furthestM), "learned");
        }
    }

    @PostConstruct
    void load() {
        if (!Files.exists(file)) {
            return;
        }
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                String[] p = line.split(",");
                Learned t = new Learned();
                t.lat = Double.parseDouble(p[1]);
                t.lon = Double.parseDouble(p[2]);
                t.samples = Integer.parseInt(p[3]);
                t.furthestM = Double.parseDouble(p[4]);
                towers.put(p[0], t);
            }
            log.info("Loaded {} learned cell towers", towers.size());
        } catch (IOException | RuntimeException e) {
            log.warn("Couldn't read {}, starting a new tower map", file, e);
        }
    }

    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT5M")
    @PreDestroy
    void save() {
        if (!dirty.getAndSet(false)) {
            return;
        }
        List<String> lines = new ArrayList<>(towers.size());
        towers.forEach((key, t) -> {
            synchronized (t) {
                lines.add(key + "," + t.lat + "," + t.lon + "," + t.samples + "," + t.furthestM);
            }
        });
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling(file.getFileName() + ".part");
            Files.write(tmp, lines, StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            dirty.set(true);
            log.warn("Couldn't save learned towers", e);
        }
    }
}
