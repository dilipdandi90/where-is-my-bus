package in.whereismybus.gtfs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.whereismybus.gtfs.FeedProperties.NumberRule;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConnectionsTest {
    private static final int MONDAY = 1;
    private static final int NINE_AM = 9 * 3600;

    @TempDir
    Path dir;

    private FeedData feed;

    /** One bus from Hinjawadi to the Moledina Stand, which is next to the Moledina Road stop. */
    @BeforeEach
    void load() throws IOException {
        Path zip = dir.resolve("feed.zip");
        try (var out = new ZipOutputStream(Files.newOutputStream(zip))) {
            Map<String, String> files = Map.of(
                    "stops.txt", """
                            stop_id,stop_name,stop_lat,stop_lon
                            hin,Bank Of Maharashtra Hinjawadi,18.5940,73.7319
                            mid,Shivaji Nagar,18.5300,73.8500
                            stand,Pune Station Moledina Stand,18.5280,73.8730
                            road,Pune Station Moledina Road,18.5276,73.8732
                            far,Katraj,18.4500,73.8600
                            """,
                    "routes.txt", "route_id,agency_id,route_short_name,route_long_name\n115,PMPML,115,x\n",
                    "trips.txt", "route_id,service_id,trip_id\n115,d,morning\n115,d,evening\n",
                    "stop_times.txt", """
                            trip_id,stop_sequence,stop_id,departure_time,arrival_time
                            morning,1,hin,08:00:00,08:00:00
                            morning,2,mid,08:40:00,08:40:00
                            morning,3,stand,09:00:00,09:00:00
                            evening,1,hin,18:00:00,18:00:00
                            evening,2,mid,18:40:00,18:40:00
                            evening,3,stand,19:00:00,19:00:00
                            """);
            for (var f : files.entrySet()) {
                out.putNextEntry(new ZipEntry(f.getKey()));
                out.write(f.getValue().getBytes(StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        feed = GtfsLoader.load(zip, NumberRule.ROUTE_NAME);
    }

    private List<Connections.Connection> find(String from, String to, int nowSec) {
        return Connections.find(feed, from, to, MONDAY, nowSec, Connections.WALKABLE_KM);
    }

    @Test
    void findsABusStoppingBesideTheNamedStop() {
        var found = find("Bank Of Maharashtra Hinjawadi", "Pune Station Moledina Road", NINE_AM);
        var evening = found.get(1);
        assertEquals("evening", evening.trip().id());
        assertEquals("Pune Station Moledina Stand", evening.service().stops.get(evening.alightStopIndex()).name());
        assertFalse(evening.tomorrow());
    }

    @Test
    void listsTheWholeDayIncludingBusesAlreadyGone() {
        var found = find("Hinjawadi", "Moledina", NINE_AM);
        assertEquals(List.of("morning", "evening"), found.stream().map(c -> c.trip().id()).toList());
        assertTrue(found.getFirst().boardSec() < NINE_AM, "the 08:00 has gone but is still listed");
    }

    @Test
    void aCityWideRadiusFindsBusesToOtherStandsInTheSameCity() {
        // Katraj is about 9 km from the Moledina stops: too far to walk, but the same city.
        assertTrue(find("Bank Of Maharashtra Hinjawadi", "Katraj", NINE_AM).isEmpty());
        assertFalse(Connections.find(feed, "Bank Of Maharashtra Hinjawadi", "Moledina", MONDAY, NINE_AM, 10).isEmpty());
    }

    @Test
    void wrongDirectionIsNotAConnection() {
        assertTrue(find("Pune Station Moledina Road", "Bank Of Maharashtra Hinjawadi", NINE_AM).isEmpty());
    }

    @Test
    void placesOutOfWalkingDistanceDoNotCount() {
        assertTrue(find("Bank Of Maharashtra Hinjawadi", "Katraj", NINE_AM).isEmpty());
    }

    @Test
    void partOfANameIsEnough() {
        assertEquals(2, find("Hinjawadi", "Moledina", NINE_AM).size());
    }

    @Test
    void afterTheLastBusTomorrowsBusesFollowTodays() {
        var found = find("Hinjawadi", "Moledina", 20 * 3600);
        assertEquals(4, found.size());
        assertFalse(found.get(1).tomorrow());
        assertTrue(found.get(2).tomorrow());
        assertEquals("morning", found.get(2).trip().id());
    }

    @Test
    void unknownPlaceFindsNothing() {
        assertTrue(find("Nowhere", "Moledina", NINE_AM).isEmpty());
    }
}
