package in.whereismybus.gtfs;

import in.whereismybus.gtfs.FeedData.Service;
import in.whereismybus.gtfs.FeedData.Stop;
import in.whereismybus.gtfs.FeedData.StopName;
import in.whereismybus.gtfs.FeedData.Trip;
import in.whereismybus.gtfs.FeedProperties.NumberRule;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

/**
 * Turns a GTFS zip into {@link FeedData}. Only weekly calendars are read; none of the configured
 * feeds use calendar_dates.txt exceptions.
 */
public final class GtfsLoader {
    private static final int DAY_SEC = 86400;
    private static final int EVERY_DAY = 0b1111111;
    private static final String[] WEEKDAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"};
    private static final Pattern DIRECTION_SUFFIX = Pattern.compile("(?i)[\\s-]*(UP\\d*|DOWN\\d*|D0WN\\d*|DN(VIA\\w*)?)$");
    private static final Pattern NON_ALPHANUMERIC = Pattern.compile("[^\\p{L}\\p{N}]");
    private static final DateTimeFormatter GTFS_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");

    private GtfsLoader() {}

    private record Route(String agency, String shortName, String longName, String color, String textColor) {}

    private record TripInfo(String routeId, String serviceId, String name) {}

    private record Draft(String id, TripInfo info, int[] stopIdx, int start, int[] offsets, double km) {}

    private record Group(String number, String operator, String label, int[] stopIdx, List<Trip> trips, Set<String> routeIds,
                         String color, String textColor) {}

    private static final class TimedStops {
        int size;
        int[] seq = new int[32];
        int[] stop = new int[32];
        int[] time = new int[32];

        void add(int s, int st, int t) {
            if (size == seq.length) {
                seq = Arrays.copyOf(seq, size * 2);
                stop = Arrays.copyOf(stop, size * 2);
                time = Arrays.copyOf(time, size * 2);
            }
            seq[size] = s;
            stop[size] = st;
            time[size++] = t;
        }
    }

    private record Key(int[] values) {
        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && Arrays.equals(values, k.values);
        }

        @Override
        public int hashCode() {
            return Arrays.hashCode(values);
        }
    }

    public static FeedData load(Path zipPath, NumberRule rule) throws IOException {
        try (ZipFile zip = new ZipFile(zipPath.toFile())) {
            String[] timezone = {"Asia/Kolkata"};
            LocalDate[] validTo = {null};

            readOptional(zip, "agency.txt", r -> {
                String tz = get(r, "agency_timezone");
                if (!tz.isEmpty()) {
                    timezone[0] = tz;
                }
            });

            Map<String, Integer> stopIndex = new HashMap<>();
            List<Stop> stops = new ArrayList<>();
            read(zip, "stops.txt", r -> {
                String lat = get(r, "stop_lat"), lon = get(r, "stop_lon");
                if (!lat.isEmpty() && !lon.isEmpty()) {
                    String id = get(r, "stop_id"), name = get(r, "stop_name");
                    stopIndex.put(id, stops.size());
                    stops.add(new Stop(id, name, normalize(name), Double.parseDouble(lat), Double.parseDouble(lon),
                            get(r, "platform_code")));
                }
            });

            Map<String, Route> routes = new HashMap<>();
            read(zip, "routes.txt", r -> routes.put(get(r, "route_id"),
                    new Route(get(r, "agency_id"), get(r, "route_short_name"), get(r, "route_long_name"),
                            get(r, "route_color"), get(r, "route_text_color"))));

            Map<String, Integer> weekdays = new HashMap<>();
            readOptional(zip, "calendar.txt", r -> {
                int mask = 0;
                for (int d = 0; d < WEEKDAYS.length; d++) {
                    if ("1".equals(get(r, WEEKDAYS[d]))) {
                        mask |= 1 << d;
                    }
                }
                weekdays.put(get(r, "service_id"), mask);
                validTo[0] = latest(validTo[0], get(r, "end_date"));
            });

            Map<String, TripInfo> tripInfo = new HashMap<>();
            read(zip, "trips.txt", r -> {
                String name = get(r, "trip_short_name");
                tripInfo.put(get(r, "trip_id"), new TripInfo(get(r, "route_id"), get(r, "service_id"),
                        name.isEmpty() ? get(r, "trip_headsign") : name));
            });

            Map<String, TimedStops> timed = new LinkedHashMap<>();
            read(zip, "stop_times.txt", r -> {
                Integer stop = stopIndex.get(get(r, "stop_id"));
                if (stop != null) {
                    String t = get(r, "departure_time");
                    timed.computeIfAbsent(get(r, "trip_id"), k -> new TimedStops())
                            .add(Integer.parseInt(get(r, "stop_sequence")), stop,
                                    parseTime(t.isEmpty() ? get(r, "arrival_time") : t));
                }
            });

            return assemble(rule, timezone[0], validTo[0], stops, routes, weekdays, tripInfo, timed);
        }
    }

    private static FeedData assemble(NumberRule rule, String timezone, LocalDate validTo, List<Stop> stops,
                                     Map<String, Route> routes, Map<String, Integer> weekdays,
                                     Map<String, TripInfo> tripInfo, Map<String, TimedStops> timed) {
        List<Draft> drafts = new ArrayList<>(timed.size());
        Map<Key, double[]> kmCache = new HashMap<>();
        for (var e : timed.entrySet()) {
            TripInfo info = tripInfo.get(e.getKey());
            TimedStops t = e.getValue();
            if (info == null || t.size < 2) {
                continue;
            }
            sortBySequence(t);
            int[] times = fillBlanks(Arrays.copyOf(t.time, t.size));
            if (times == null) {
                continue;
            }
            int[] stopIdx = Arrays.copyOf(t.stop, t.size);
            int[] offsets = new int[t.size];
            for (int i = 1; i < t.size; i++) {
                // Max guards against a stop timed earlier than the one before it.
                offsets[i] = Math.max(offsets[i - 1], times[i] - times[0]);
            }
            double[] km = kmCache.computeIfAbsent(new Key(stopIdx), k -> cumulativeKm(k.values(), stops));
            drafts.add(new Draft(e.getKey(), info, stopIdx, times[0] % DAY_SEC, offsets, km[km.length - 1]));
        }

        // Trips on a calendar that never runs carry no real times (see FeedData.Service.timetabled).
        boolean repaired = TimingRepair.isNeeded(drafts.stream()
                .filter(d -> weekdays.getOrDefault(d.info().serviceId(), EVERY_DAY) != 0)
                .map(d -> new TimingRepair.Sample(d.km(), d.offsets())).toList());

        Map<String, Group> groups = new LinkedHashMap<>();
        Map<Key, int[]> sharedOffsets = new HashMap<>();
        Map<String, Trip> tripById = new HashMap<>(drafts.size() * 2);
        for (Draft d : drafts) {
            Route route = routes.getOrDefault(d.info().routeId(), new Route("", "", d.info().routeId(), "", ""));
            String number = busNumber(rule, d.info().name(), route.shortName(), route.longName(), d.info().routeId());
            // Operators in one feed reuse numbers (BEST, TMT and KDMT each have a route 1).
            String id = serviceId(route.agency() + "|" + number, d.stopIdx(), stops);
            Group group = groups.computeIfAbsent(id, k -> new Group(number, route.agency(),
                    d.info().name().isEmpty() ? route.longName() : d.info().name(), d.stopIdx(), new ArrayList<>(), new HashSet<>(),
                    route.color(), route.textColor()));
            group.routeIds().add(d.info().routeId());
            int[] offsets = sharedOffsets.computeIfAbsent(
                    new Key(repaired ? TimingRepair.repair(d.offsets()) : d.offsets()), Key::values);
            Trip trip = new Trip(d.id(), id, d.start(), offsets,
                    weekdays.getOrDefault(d.info().serviceId(), EVERY_DAY));
            group.trips().add(trip);
            tripById.put(trip.id(), trip);
        }

        List<Service> services = new ArrayList<>(groups.size());
        Map<String, Service> serviceById = new HashMap<>(groups.size() * 2);
        Map<String, StopName> stopNames = new HashMap<>();
        groups.forEach((id, g) -> {
            g.trips().sort((a, b) -> Integer.compare(a.startSec(), b.startSec()));
            List<Stop> serviceStops = Arrays.stream(g.stopIdx()).mapToObj(stops::get).toList();
            Service service = new Service(id, g.number(), g.operator(), g.label(), serviceStops,
                    kmCache.get(new Key(g.stopIdx())), List.copyOf(g.trips()), Set.copyOf(g.routeIds()), g.color(), g.textColor());
            services.add(service);
            serviceById.put(id, service);
            serviceStops.forEach(s -> stopNames.computeIfAbsent(s.key(),
                    k -> new StopName(s.name(), s.lat(), s.lon())));
        });

        return new FeedData(ZoneId.of(timezone), validTo, repaired, Instant.now(), services,
                serviceById, tripById, List.copyOf(stops), stopNames);
    }

    /** Lowercase letters and digits only, so "L.B. Nagar" and "LB Nagar" compare equal. */
    public static String normalize(String s) {
        return NON_ALPHANUMERIC.matcher(s.toLowerCase(Locale.ROOT)).replaceAll("");
    }

    static String busNumber(NumberRule rule, String tripName, String routeShort, String routeLong, String routeId) {
        if (rule == NumberRule.TRIP_NAME_PREFIX) {
            // Route IDs can't be trusted here: TGSRTC's route 219 contains trips named 5K, 217C and others.
            int dash = tripName.indexOf('-');
            String prefix = (dash > 0 ? tripName.substring(0, dash) : tripName).trim();
            // Prefixes starting with a letter are depot codes (HCU, CNT, MYP2) rather than bus numbers.
            if (!prefix.isEmpty() && Character.isDigit(prefix.charAt(0))) {
                return prefix.toUpperCase(Locale.ROOT);
            }
        }
        String name = !routeShort.isEmpty() ? routeShort : !routeLong.isEmpty() ? routeLong : routeId;
        return DIRECTION_SUFFIX.matcher(name.trim()).replaceFirst("").toUpperCase(Locale.ROOT);
    }

    private static String serviceId(String number, int[] stopIdx, List<Stop> stops) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(number.getBytes(StandardCharsets.UTF_8));
            for (int i : stopIdx) {
                md.update(stops.get(i).id().getBytes(StandardCharsets.UTF_8));
                md.update((byte) 0);
            }
            return HexFormat.of().formatHex(md.digest(), 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static double[] cumulativeKm(int[] stopIdx, List<Stop> stops) {
        double[] km = new double[stopIdx.length];
        for (int i = 1; i < stopIdx.length; i++) {
            Stop a = stops.get(stopIdx[i - 1]), b = stops.get(stopIdx[i]);
            km[i] = km[i - 1] + Geo.km(a.lat(), a.lon(), b.lat(), b.lon());
        }
        return km;
    }

    private static void sortBySequence(TimedStops t) {
        Integer[] order = new Integer[t.size];
        boolean sorted = true;
        for (int i = 0; i < t.size; i++) {
            order[i] = i;
            sorted &= i == 0 || t.seq[i - 1] <= t.seq[i];
        }
        if (sorted) {
            return;
        }
        Arrays.sort(order, (a, b) -> Integer.compare(t.seq[a], t.seq[b]));
        int[] stop = new int[t.size], time = new int[t.size], seq = new int[t.size];
        for (int i = 0; i < t.size; i++) {
            seq[i] = t.seq[order[i]];
            stop[i] = t.stop[order[i]];
            time[i] = t.time[order[i]];
        }
        t.seq = seq;
        t.stop = stop;
        t.time = time;
    }

    /** GTFS allows blank times between timed stops. Returns null when the ends themselves are blank. */
    private static int[] fillBlanks(int[] t) {
        if (t[0] < 0 || t[t.length - 1] < 0) {
            return null;
        }
        for (int i = 1; i < t.length; i++) {
            if (t[i] < 0) {
                int next = i;
                while (t[next] < 0) {
                    next++;
                }
                int steps = next - i + 1;
                for (int j = i; j < next; j++) {
                    t[j] = t[i - 1] + (t[next] - t[i - 1]) * (j - i + 1) / steps;
                }
            }
        }
        return t;
    }

    /** Parses HH:MM:SS where hours may pass 24. Returns -1 when blank. */
    static int parseTime(String s) {
        if (s.isEmpty()) {
            return -1;
        }
        int first = s.indexOf(':'), second = s.indexOf(':', first + 1);
        return Integer.parseInt(s.substring(0, first).trim()) * 3600
                + Integer.parseInt(s.substring(first + 1, second)) * 60
                + Integer.parseInt(s.substring(second + 1).trim());
    }

    private static LocalDate latest(LocalDate current, String yyyymmdd) {
        if (yyyymmdd.isEmpty()) {
            return current;
        }
        LocalDate d = LocalDate.parse(yyyymmdd, GTFS_DATE);
        return current == null || d.isAfter(current) ? d : current;
    }

    private static String get(CSVRecord r, String column) {
        return r.isMapped(column) && r.isSet(column) ? r.get(column).trim() : "";
    }

    private static void read(ZipFile zip, String file, Consumer<CSVRecord> each) throws IOException {
        if (!readOptional(zip, file, each)) {
            throw new IOException("Feed is missing " + file);
        }
    }

    private static boolean readOptional(ZipFile zip, String file, Consumer<CSVRecord> each) throws IOException {
        ZipEntry entry = find(zip, file);
        if (entry == null) {
            return false;
        }
        try (InputStream in = zip.getInputStream(entry);
             Reader reader = skipBom(new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8)));
             CSVParser csv = CSVFormat.RFC4180.builder().setHeader().setSkipHeaderRecord(true)
                     .setIgnoreEmptyLines(true).get().parse(reader)) {
            csv.forEach(each);
        }
        return true;
    }

    private static Reader skipBom(BufferedReader reader) throws IOException {
        reader.mark(1);
        if (reader.read() != '﻿') {
            reader.reset();
        }
        return reader;
    }

    private static ZipEntry find(ZipFile zip, String file) {
        ZipEntry direct = zip.getEntry(file);
        if (direct != null) {
            return direct;
        }
        // Some publishers wrap the files in a single folder.
        Enumeration<? extends ZipEntry> all = zip.entries();
        while (all.hasMoreElements()) {
            ZipEntry e = all.nextElement();
            if (e.getName().endsWith("/" + file)) {
                return e;
            }
        }
        return null;
    }
}
