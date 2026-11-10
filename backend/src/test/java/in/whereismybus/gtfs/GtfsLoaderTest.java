package in.whereismybus.gtfs;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.whereismybus.gtfs.FeedProperties.NumberRule;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GtfsLoaderTest {
    private static final String STOPS = """
            stop_id,stop_name,stop_lat,stop_lon
            A,"Alpha, Main",17.00,78.00
            B,Bravo,17.05,78.00
            C,Charlie,17.10,78.00
            """;

    @TempDir
    Path dir;

    @Test
    void busNumberComesFromTripNameBecauseRouteIdsAreUnreliable() {
        assertEquals("5K", GtfsLoader.busNumber(NumberRule.TRIP_NAME_PREFIX, "5K-MEHDIPATNAM-TO-JBS-CNT", "", "219", "219"));
        assertEquals("16A/219", GtfsLoader.busNumber(NumberRule.TRIP_NAME_PREFIX, "16A/219-PATANCHERU-TO-ECIL", "", "16A/219", "x"));
    }

    @Test
    void depotCodePrefixFallsBackToRouteName() {
        assertEquals("219", GtfsLoader.busNumber(NumberRule.TRIP_NAME_PREFIX, "HCU-SOMEWHERE", "", "219", "x"));
        assertEquals("219", GtfsLoader.busNumber(NumberRule.TRIP_NAME_PREFIX, "MYP2-SOMEWHERE", "", "219", "x"));
    }

    @Test
    void directionIsStrippedFromRouteNames() {
        for (var c : Map.of("764MSTLDOWN", "764MSTL", "872UP", "872", "790AUP2", "790A", "807D0WN", "807",
                "419DNVIACL", "419", "GL-23DOWN", "GL-23", "TMS+AL", "TMS+AL").entrySet()) {
            assertEquals(c.getValue(), GtfsLoader.busNumber(NumberRule.ROUTE_NAME, "", "", c.getKey(), "x"));
        }
    }

    @Test
    void shortNameIsPreferredForBusNumber() {
        assertEquals("A-21", GtfsLoader.busNumber(NumberRule.ROUTE_NAME, "Colaba", "A-21", "Colaba ⇆ Bandra", "x"));
    }

    @Test
    void parsesTimesPastMidnight() {
        assertEquals(25 * 3600 + 57 * 60 + 37, GtfsLoader.parseTime("25:57:37"));
        assertEquals(-1, GtfsLoader.parseTime(""));
    }

    @Test
    void repairRecoversCumulativeTimesFromDoubleSummedOnes() {
        assertArrayEquals(new int[] {0, 100, 300, 600}, TimingRepair.repair(new int[] {0, 100, 400, 1000}));
    }

    @Test
    void detectsCorruptTimingButLeavesHealthyTimingAlone() {
        // 26 km over 40 stops at a minute per stop, then summed a second time as the publisher did.
        int[] doubleSummed = new int[41];
        for (int i = 1; i < doubleSummed.length; i++) {
            doubleSummed[i] = doubleSummed[i - 1] + i * 60;
        }
        var corrupt = new TimingRepair.Sample(26, doubleSummed);
        assertTrue(TimingRepair.isNeeded(List.of(corrupt)));
        assertEquals(2400, TimingRepair.repair(doubleSummed)[40], "recovers the true 40 minutes");
        var healthy = new TimingRepair.Sample(17, new int[] {0, 73, 400, 1400, 2400, 3500, 4100});
        assertFalse(TimingRepair.isNeeded(List.of(healthy)));
    }

    @Test
    void loadsFeedAndGroupsTripsIntoServices() throws IOException {
        Path zip = zip(Map.of(
                "agency.txt", "agency_name,agency_timezone\nTest Bus,Asia/Kolkata\n",
                "stops.txt", STOPS,
                "routes.txt", "route_id,agency_id,route_short_name,route_long_name\nr1,BEST,,9XUP\n",
                "calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                        + "wk,1,1,1,1,1,0,0,20200101,20240101\n",
                "trips.txt", "route_id,service_id,trip_id\nr1,wk,late\nr1,wk,early\n",
                "stop_times.txt", """
                        trip_id,stop_sequence,stop_id,departure_time,arrival_time
                        late,2,B,,
                        late,1,A,25:00:00,25:00:00
                        late,3,C,25:20:00,25:20:00
                        early,1,A,06:00:00,06:00:00
                        early,2,B,06:10:00,06:10:00
                        early,3,C,06:20:00,06:20:00
                        """));

        FeedData feed = GtfsLoader.load(zip, NumberRule.ROUTE_NAME);

        assertEquals(1, feed.services().size());
        var service = feed.services().getFirst();
        assertEquals("9X", service.number);
        assertEquals("BEST", service.operator);
        assertEquals("Alpha, Main", service.from());
        assertEquals(11.1, service.totalKm(), 0.1);
        var late = feed.tripById().get("late");
        assertEquals(3600, late.startSec(), "start after midnight wraps round");
        assertEquals(late, service.trips.getFirst(), "trips are ordered by start time");
        assertArrayEquals(new int[] {0, 600, 1200}, late.offsets(), "blank time is interpolated");
        assertTrue(late.runsOn(1));
        assertFalse(late.runsOn(6));
        assertTrue(feed.expired(LocalDate.of(2026, 1, 1)));
        assertFalse(feed.timesRepaired());
    }

    @Test
    void sameNumberFromDifferentOperatorsStaysSeparate() throws IOException {
        Path zip = zip(Map.of(
                "stops.txt", STOPS,
                "routes.txt", "route_id,agency_id,route_short_name,route_long_name\nb1,BEST,1,x\nt1,TMT,1,x\n",
                "trips.txt", "route_id,service_id,trip_id\nb1,d,b\nt1,d,t\n",
                "stop_times.txt", """
                        trip_id,stop_sequence,stop_id,departure_time,arrival_time
                        b,1,A,06:00:00,06:00:00
                        b,2,B,06:10:00,06:10:00
                        t,1,A,07:00:00,07:00:00
                        t,2,B,07:10:00,07:10:00
                        """));

        FeedData feed = GtfsLoader.load(zip, NumberRule.ROUTE_NAME);

        assertEquals(2, feed.services().size());
        assertNotEquals(feed.services().get(0).id, feed.services().get(1).id);
    }

    @Test
    void metroLinesKeepTheirColourPlatformsAndLinesWithoutATimetable() throws IOException {
        Path zip = zip(Map.of(
                "stops.txt", """
                        stop_id,stop_name,stop_lat,stop_lon,platform_code
                        A,District Court,18.528,73.855,1
                        B,Shivaji Nagar,18.531,73.849,
                        C,Khadki,18.563,73.838,
                        """,
                "routes.txt", """
                        route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color
                        1,PM,1,Purple Line,1,800080,FFFFFF
                        3,PM,3,Pink Line,1,F91C91,FFFFFF
                        """,
                "calendar.txt", """
                        service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
                        DAILY,1,1,1,1,1,1,1,20260101,20301231
                        NO_TIMETABLE,0,0,0,0,0,0,0,20260101,20301231
                        """,
                "trips.txt", """
                        route_id,service_id,trip_id,trip_headsign
                        1,DAILY,p1,Purple Line
                        3,NO_TIMETABLE,pink,Pink Line
                        """,
                "stop_times.txt", """
                        trip_id,arrival_time,departure_time,stop_id,stop_sequence
                        p1,06:00:00,06:00:00,A,0
                        p1,06:03:00,06:03:00,B,1
                        pink,00:00:00,00:00:00,B,0
                        pink,00:00:00,00:00:00,C,1
                        """));

        FeedData feed = GtfsLoader.load(zip, NumberRule.ROUTE_NAME);
        var purple = feed.services().stream().filter(s -> s.number.equals("1")).findFirst().orElseThrow();
        var pink = feed.services().stream().filter(s -> s.number.equals("3")).findFirst().orElseThrow();

        assertEquals("800080", purple.color);
        assertEquals("1", purple.stops.getFirst().platform());
        assertEquals("", purple.stops.getLast().platform());
        assertTrue(purple.timetabled);
        assertFalse(pink.timetabled);
        // Searching between its stations still finds the line, marked as having no times.
        var found = Connections.find(feed, "Shivaji Nagar", "Khadki", 1, 0, Connections.WALKABLE_KM);
        assertEquals(1, found.size());
        assertTrue(found.getFirst().untimed());
    }

    @Test
    void searchRanksExactNumberAboveLooserMatches() {
        var stops = List.of(new FeedData.Stop("a", "Colaba", "colaba", 18.9, 72.8, ""),
                new FeedData.Stop("b", "Bandra", "bandra", 19.0, 72.8, ""));
        var service = new FeedData.Service("id", "A-21/219", "BEST", "Colaba", stops, new double[] {0, 10}, List.of(), java.util.Set.of(), "", "");
        assertEquals(0, service.searchRank("a21219"));
        assertEquals(1, service.searchRank("a21"));
        assertEquals(2, service.searchRank("a2"));
        assertEquals(1, service.searchRank("219"));
        assertEquals(3, service.searchRank("1219"));
        assertEquals(4, service.searchRank("bandra"));
        assertEquals(-1, service.searchRank("thane"));
    }

    private Path zip(Map<String, String> files) throws IOException {
        Path p = dir.resolve("feed.zip");
        try (var out = new ZipOutputStream(Files.newOutputStream(p))) {
            for (var f : files.entrySet()) {
                out.putNextEntry(new ZipEntry(f.getKey()));
                out.write(f.getValue().getBytes(StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return p;
    }
}
