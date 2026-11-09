package in.whereismybus.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.transit.realtime.GtfsRealtime;
import com.sun.net.httpserver.HttpServer;
import in.whereismybus.gtfs.FeedProperties;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class LiveVehiclesTest {
    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private static GtfsRealtime.FeedEntity bus(String plate, String route, long secondsAgo) {
        return GtfsRealtime.FeedEntity.newBuilder().setId(plate).setVehicle(GtfsRealtime.VehiclePosition.newBuilder()
                .setTrip(GtfsRealtime.TripDescriptor.newBuilder().setRouteId(route))
                .setVehicle(GtfsRealtime.VehicleDescriptor.newBuilder().setId(plate).setLicensePlate(plate))
                .setPosition(GtfsRealtime.Position.newBuilder().setLatitude(18.5f).setLongitude(73.8f))
                .setTimestamp(Instant.now().getEpochSecond() - secondsAgo)).build();
    }

    private static byte[] feed(GtfsRealtime.FeedEntity... buses) {
        var message = GtfsRealtime.FeedMessage.newBuilder().setHeader(
                GtfsRealtime.FeedHeader.newBuilder().setGtfsRealtimeVersion("2.0"));
        for (var b : buses) {
            message.addEntity(b);
        }
        return message.build().toByteArray();
    }

    private LiveVehicles client(String url) {
        var feed = new FeedProperties.Feed("pune", "Pune", "Maharashtra", "PMPML", "http://unused", "s", "u", false,
                FeedProperties.NumberRule.ROUTE_NAME, null, false, url, null);
        return new LiveVehicles(new FeedProperties("./data", 24, List.of(feed)));
    }

    private String serve(byte[] body, int status, AtomicInteger calls) throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/rt.pb", exchange -> {
            calls.incrementAndGet();
            exchange.sendResponseHeaders(status, body.length == 0 ? -1 : body.length);
            if (body.length > 0) {
                exchange.getResponseBody().write(body);
            }
            exchange.close();
        });
        server.start();
        return "http://localhost:" + server.getAddress().getPort() + "/rt.pb";
    }

    @Test
    void returnsFreshBusesOnTheRouteWithTheirRegistrationNumbers() throws IOException {
        var calls = new AtomicInteger();
        var live = client(serve(feed(bus("MH12SX5185", "902", 60), bus("MH12SX0001", "45", 60)), 200, calls));

        var buses = live.onRoute("pune", "902");

        assertEquals(1, buses.size());
        assertEquals("MH12SX5185", buses.getFirst().plate());
    }

    @Test
    void oldPositionsAreLeftOut() throws IOException {
        var live = client(serve(feed(bus("MH12SX5185", "902", 3600)), 200, new AtomicInteger()));
        assertTrue(live.onRoute("pune", "902").isEmpty());
    }

    @Test
    void askingAgainSoonDoesNotFetchAgain() throws IOException {
        var calls = new AtomicInteger();
        var live = client(serve(feed(bus("MH12SX5185", "902", 60)), 200, calls));
        live.onRoute("pune", "902");
        live.onRoute("pune", "45");
        assertEquals(1, calls.get());
    }

    @Test
    void aSourceThatIsDownMeansNoBusesRatherThanAnError() throws IOException {
        var live = client(serve(new byte[0], 503, new AtomicInteger()));
        assertTrue(live.onRoute("pune", "902").isEmpty());
    }

    @Test
    void feedsWithoutALiveSourceHaveNoBuses() {
        assertTrue(client(null).onRoute("pune", "902").isEmpty());
    }

    @Test
    void entriesMissingARouteOrPositionAreSkipped() throws IOException {
        byte[] body = GtfsRealtime.FeedMessage.newBuilder()
                .setHeader(GtfsRealtime.FeedHeader.newBuilder().setGtfsRealtimeVersion("2.0"))
                .addEntity(GtfsRealtime.FeedEntity.newBuilder().setId("x").setVehicle(GtfsRealtime.VehiclePosition.newBuilder()
                        .setTimestamp(Instant.now().getEpochSecond())))
                .build().toByteArray();
        assertTrue(LiveVehicles.parse(body).isEmpty());
    }
}
