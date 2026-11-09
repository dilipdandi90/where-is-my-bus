package in.whereismybus.gtfs;

import in.whereismybus.gtfs.FeedData.Service;
import in.whereismybus.gtfs.FeedData.Stop;
import in.whereismybus.gtfs.FeedData.Trip;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Finds direct buses between two places, as a full day's timetable. People name a place, not a pole:
 * "Pune Station Moledina Road" and "Pune Station Moledina Stand" are next to each other, and a bus
 * using either one will do. So a bus counts if it calls near each named stop, in that order. For city
 * buses "near" is walking distance; for buses between cities it's the whole city, since Sambhaji Nagar
 * has several stands kilometres apart and a bus to any of them gets you there.
 */
public final class Connections {
    public static final double WALKABLE_KM = 0.5;
    private static final int MAX_NAMED_STOPS = 50;

    /**
     * One bus on one day.
     *
     * @param boardStopIndex where to get on, within the service's stops
     * @param alightStopIndex where to get off
     * @param tomorrow true for tomorrow's buses, which are listed when none are left today
     */
    public record Connection(Service service, Trip trip, int boardStopIndex, int alightStopIndex, boolean tomorrow) {
        public int boardSec() {
            return trip.startSec() + trip.offsets()[boardStopIndex];
        }

        public int alightSec() {
            return trip.startSec() + trip.offsets()[alightStopIndex];
        }
    }

    private Connections() {}

    /**
     * @param from a stop name, or part of one
     * @param to a stop name, or part of one
     * @param isoWeekday today, from 1 for Monday to 7 for Sunday
     * @param nowSec seconds since midnight
     * @param radiusKm how far from each named stop still counts as that place
     * @return all of today's buses in boarding order, including ones already gone. If none are left
     *         today, tomorrow's follow.
     */
    public static List<Connection> find(FeedData feed, String from, String to, int isoWeekday, int nowSec, double radiusKm) {
        Map<Stop, Double> nearFrom = stopsNear(feed, GtfsLoader.normalize(from), radiusKm);
        Map<Stop, Double> nearTo = stopsNear(feed, GtfsLoader.normalize(to), radiusKm);
        if (nearFrom.isEmpty() || nearTo.isEmpty()) {
            return List.of();
        }
        int tomorrow = isoWeekday % 7 + 1;
        List<Connection> today = new ArrayList<>();
        List<Connection> next = new ArrayList<>();
        for (Service service : feed.services()) {
            int[] pair = bestPair(service, nearFrom, nearTo);
            if (pair == null) {
                continue;
            }
            for (Trip trip : service.trips) {
                if (trip.runsOn(isoWeekday)) {
                    today.add(new Connection(service, trip, pair[0], pair[1], false));
                }
                if (trip.runsOn(tomorrow)) {
                    next.add(new Connection(service, trip, pair[0], pair[1], true));
                }
            }
        }
        List<Connection> found = new ArrayList<>(today);
        if (today.stream().noneMatch(c -> c.boardSec() >= nowSec)) {
            found.addAll(next);
        }
        found.sort(Comparator.comparing(Connection::tomorrow).thenComparingInt(Connection::boardSec));
        return found;
    }

    /** Every stop within the radius of a named place, with how far away it is. */
    private static Map<Stop, Double> stopsNear(FeedData feed, String key, double radiusKm) {
        if (key.isEmpty()) {
            return Map.of();
        }
        List<Stop> named = feed.stops().stream().filter(s -> s.key().equals(key)).toList();
        if (named.isEmpty()) {
            named = feed.stops().stream().filter(s -> s.key().contains(key)).limit(MAX_NAMED_STOPS).toList();
        }
        Map<Stop, Double> near = new HashMap<>();
        for (Stop stop : feed.stops()) {
            for (Stop place : named) {
                double km = Geo.km(stop.lat(), stop.lon(), place.lat(), place.lon());
                if (km <= radiusKm) {
                    near.merge(stop, km, Math::min);
                }
            }
        }
        return near;
    }

    /** The boarding and alighting stops needing the least walking, boarding first. Null if there are none. */
    private static int[] bestPair(Service service, Map<Stop, Double> nearFrom, Map<Stop, Double> nearTo) {
        int[] best = null;
        double bestWalk = Double.MAX_VALUE;
        int board = -1;
        double boardWalk = Double.MAX_VALUE;
        for (int i = 0; i < service.stops.size(); i++) {
            Stop stop = service.stops.get(i);
            Double toWalk = nearTo.get(stop);
            if (toWalk != null && board >= 0 && boardWalk + toWalk < bestWalk) {
                bestWalk = boardWalk + toWalk;
                best = new int[] {board, i};
            }
            Double fromWalk = nearFrom.get(stop);
            if (fromWalk != null && fromWalk < boardWalk) {
                board = i;
                boardWalk = fromWalk;
            }
        }
        return best;
    }
}
