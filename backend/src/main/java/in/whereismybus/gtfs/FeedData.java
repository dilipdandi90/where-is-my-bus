package in.whereismybus.gtfs;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** One fully loaded, immutable feed. It's replaced whole when a refresh succeeds. */
public record FeedData(
        ZoneId zone,
        LocalDate validTo,
        boolean timesRepaired,
        Instant loadedAt,
        List<Service> services,
        Map<String, Service> serviceById,
        Map<String, Trip> tripById,
        List<Stop> stops,
        Map<String, StopName> stopNames) {

    /** @param key the name reduced by {@link GtfsLoader#normalize} for matching */
    public record Stop(String id, String name, String key, double lat, double lon) {}

    /** All stops sharing a name, such as the two sides of a road. */
    public record StopName(String name, double lat, double lon) {}

    /** A bus number running one exact sequence of stops. This is what users pick and follow. */
    public static final class Service {
        public final String id;
        public final String number;
        public final String operator;
        public final String label;
        public final List<Stop> stops;
        public final double[] lats;
        public final double[] lons;
        public final double[] km;
        public final List<Trip> trips;
        /** The feed's route IDs for this service, which live positions refer to. */
        public final Set<String> routeIds;
        final String numberKey;
        final String nameKey;

        public Service(String id, String number, String operator, String label, List<Stop> stops, double[] km,
                       List<Trip> trips, Set<String> routeIds) {
            this.id = id;
            this.number = number;
            this.operator = operator;
            this.label = label;
            this.stops = stops;
            this.lats = stops.stream().mapToDouble(Stop::lat).toArray();
            this.lons = stops.stream().mapToDouble(Stop::lon).toArray();
            this.km = km;
            this.trips = trips;
            this.routeIds = routeIds;
            this.numberKey = GtfsLoader.normalize(number);
            this.nameKey = GtfsLoader.normalize(from() + "|" + to() + "|" + label);
        }

        public String from() {
            return stops.getFirst().name();
        }

        public String to() {
            return stops.getLast().name();
        }

        public double totalKm() {
            return km[km.length - 1];
        }

        /** Lower is better: exact number, part of a combined number, prefix, then place names. -1 if no match. */
        public int searchRank(String normalizedQuery) {
            if (numberKey.equals(normalizedQuery)) {
                return 0;
            }
            for (String part : number.split("[/+]")) {
                if (GtfsLoader.normalize(part).equals(normalizedQuery)) {
                    return 1;
                }
            }
            if (numberKey.startsWith(normalizedQuery)) {
                return 2;
            }
            if (numberKey.contains(normalizedQuery)) {
                return 3;
            }
            return nameKey.contains(normalizedQuery) ? 4 : -1;
        }
    }

    /** One scheduled departure of a service. Offsets are seconds from its first stop. */
    public record Trip(String id, String serviceId, int startSec, int[] offsets, int weekdayMask) {
        public int durationSec() {
            return offsets[offsets.length - 1];
        }

        /** @param isoWeekday 1 for Monday to 7 for Sunday */
        public boolean runsOn(int isoWeekday) {
            return (weekdayMask & (1 << (isoWeekday - 1))) != 0;
        }
    }

    public boolean expired(LocalDate today) {
        return validTo != null && validTo.isBefore(today);
    }
}
