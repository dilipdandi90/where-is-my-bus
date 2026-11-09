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
 * Finds direct buses between two places. People name a place, not a pole: "Pune Station Moledina Road"
 * and "Pune Station Moledina Stand" are next to each other, and a bus using either one will do. So a
 * bus counts if it calls within walking distance of each named stop, in that order.
 */
public final class Connections {
    static final double WALKABLE_KM = 0.5;
    private static final int DAY_SEC = 86400;
    private static final int MAX_NAMED_STOPS = 50;

    /**
     * @param boardStopIndex where to get on, within the service's stops
     * @param alightStopIndex where to get off
     * @param tomorrow true when nothing else runs today, so {@code trip} is tomorrow's first
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
     * @return soonest first, with tomorrow's after all of today's
     */
    public static List<Connection> find(FeedData feed, String from, String to, int isoWeekday, int nowSec) {
        Map<Stop, Double> nearFrom = stopsNear(feed, GtfsLoader.normalize(from));
        Map<Stop, Double> nearTo = stopsNear(feed, GtfsLoader.normalize(to));
        if (nearFrom.isEmpty() || nearTo.isEmpty()) {
            return List.of();
        }
        List<Connection> found = new ArrayList<>();
        for (Service service : feed.services()) {
            int[] pair = bestPair(service, nearFrom, nearTo);
            if (pair != null) {
                Connection connection = nextConnection(service, pair[0], pair[1], isoWeekday, nowSec);
                if (connection != null) {
                    found.add(connection);
                }
            }
        }
        found.sort(Comparator.comparing(Connection::tomorrow).thenComparingInt(Connection::boardSec));
        return found;
    }

    /** Every stop within walking distance of a named place, with how far away it is. */
    private static Map<Stop, Double> stopsNear(FeedData feed, String key) {
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
                if (km <= WALKABLE_KM) {
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

    private static Connection nextConnection(Service service, int board, int alight, int isoWeekday, int nowSec) {
        Trip nextToday = null;
        Trip firstTomorrow = null;
        int tomorrow = isoWeekday % 7 + 1;
        for (Trip trip : service.trips) {
            int boardSec = trip.startSec() + trip.offsets()[board];
            if (trip.runsOn(isoWeekday) && boardSec >= nowSec && boardSec < DAY_SEC
                    && (nextToday == null || boardSec < nextToday.startSec() + nextToday.offsets()[board])) {
                nextToday = trip;
            }
            if (trip.runsOn(tomorrow)
                    && (firstTomorrow == null || boardSec < firstTomorrow.startSec() + firstTomorrow.offsets()[board])) {
                firstTomorrow = trip;
            }
        }
        if (nextToday != null) {
            return new Connection(service, nextToday, board, alight, false);
        }
        return firstTomorrow == null ? null : new Connection(service, firstTomorrow, board, alight, true);
    }
}
