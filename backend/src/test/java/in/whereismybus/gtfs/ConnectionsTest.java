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
        return Connections.find(feed, from, to, MONDAY, nowSec);
    }

    @Test
    void findsABusStoppingBesideTheNamedStop() {
        var found = find("Bank Of Maharashtra Hinjawadi", "Pune Station Moledina Road", NINE_AM);
        assertEquals(1, found.size());
        var connection = found.getFirst();
        assertEquals("evening", connection.trip().id());
        assertEquals("Pune Station Moledina Stand", connection.service().stops.get(connection.alightStopIndex()).name());
        assertFalse(connection.tomorrow());
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
        assertEquals(1, find("Hinjawadi", "Moledina", NINE_AM).size());
    }

    @Test
    void afterTheLastBusItOffersTomorrowsFirst() {
        var connection = find("Hinjawadi", "Moledina", 20 * 3600).getFirst();
        assertTrue(connection.tomorrow());
        assertEquals("morning", connection.trip().id());
    }

    @Test
    void unknownPlaceFindsNothing() {
        assertTrue(find("Nowhere", "Moledina", NINE_AM).isEmpty());
    }
}
