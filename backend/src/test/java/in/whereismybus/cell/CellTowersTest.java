package in.whereismybus.cell;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import in.whereismybus.gtfs.FeedProperties;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CellTowersTest {
    private static final Tower TOWER = new Tower(404, 20, 1234, 56789);

    @TempDir
    Path dir;

    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private LearnedTowers learned() {
        return new LearnedTowers(new FeedProperties(dir.toString(), 24, List.of()));
    }

    private OpenCellIdClient stub(AtomicReference<String> body, AtomicInteger calls) throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/cell/get", exchange -> {
            calls.incrementAndGet();
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        return new OpenCellIdClient("test-key", "http://localhost:" + server.getAddress().getPort() + "/cell/get");
    }

    @Test
    void towerIsOnlyTrustedAfterSeveralSamples() {
        LearnedTowers towers = learned();
        towers.learn(TOWER, 18.50, 73.85, 10);
        towers.learn(TOWER, 18.51, 73.85, 10);
        assertNull(towers.find(TOWER));
        towers.learn(TOWER, 18.52, 73.85, 10);
        var position = towers.find(TOWER);
        assertEquals(18.51, position.lat(), 0.0001);
        assertTrue(position.rangeM() > 1000 && position.rangeM() < 2500, "range reflects how far apart riders have been");
    }

    @Test
    void imprecisePositionsAndImpossibleOnesAreNotLearned() {
        LearnedTowers towers = learned();
        assertFalse(towers.learn(TOWER, 18.5, 73.85, 500));
        assertTrue(towers.learn(TOWER, 18.5, 73.85, 10));
        assertFalse(towers.learn(TOWER, 19.5, 73.85, 10), "over 100 km from the other samples");
    }

    @Test
    void learnedTowersSurviveARestart() {
        LearnedTowers first = learned();
        for (int i = 0; i < 3; i++) {
            first.learn(TOWER, 18.5, 73.85, 10);
        }
        first.save();
        LearnedTowers second = learned();
        second.load();
        assertNotNull(second.find(TOWER));
    }

    @Test
    void locateWeightsTheConnectedTowerAndPrefersLearnedPositions() throws IOException {
        LearnedTowers towers = learned();
        for (int i = 0; i < 3; i++) {
            towers.learn(TOWER, 18.0, 73.0, 10);
        }
        var body = new AtomicReference<>("{\"lat\":19.0,\"lon\":73.0,\"range\":1000}");
        var calls = new AtomicInteger();
        var controller = new CellController(towers, stub(body, calls));

        var learnedOnly = controller.locate(new CellController.LocateRequest(List.of(
                new CellController.Cell(404, 20, 1234, 56789, -80, true))));
        assertTrue(learnedOnly.found());
        assertEquals("learned", learnedOnly.source());
        assertEquals(0, calls.get(), "no rate-limited lookup when the tower is already mapped");

        var both = controller.locate(new CellController.LocateRequest(List.of(
                new CellController.Cell(404, 20, 1234, 56789, -80, true),
                new CellController.Cell(404, 20, 1234, 99999, -80, false))));
        assertEquals("mixed", both.source());
        assertEquals(18.2, both.lat(), 0.001, "the connected tower counts four times as much");
    }

    @Test
    void unknownTowersReportNotFoundSoTheAppCanFallBack() {
        var controller = new CellController(learned(), new OpenCellIdClient("", "http://unused"));
        var result = controller.locate(new CellController.LocateRequest(List.of(
                new CellController.Cell(404, 20, 1234, 56789, -80, true))));
        assertFalse(result.found());
    }

    @Test
    void towersWithMissingIdsAreIgnored() {
        var controller = new CellController(learned(), new OpenCellIdClient("", "http://unused"));
        controller.learn(new CellController.LearnRequest(List.of(
                new CellController.Cell(0, 0, 0, 0, null, true)), 18.5, 73.85, 10));
        assertFalse(controller.locate(new CellController.LocateRequest(List.of(
                new CellController.Cell(0, 0, 0, 0, null, true)))).found());
    }

    @Test
    void onlyTheConnectedTowerIsLearned() {
        LearnedTowers towers = learned();
        var controller = new CellController(towers, new OpenCellIdClient("", "http://unused"));
        for (int i = 0; i < 3; i++) {
            controller.learn(new CellController.LearnRequest(List.of(
                    new CellController.Cell(404, 20, 1234, 56789, -80, false)), 18.5, 73.85, 10));
        }
        assertNull(towers.find(TOWER));
    }

    @Test
    void openCellIdAnswersAreCachedIncludingUnknownTowers() throws IOException {
        var body = new AtomicReference<>("{\"lat\":18.5,\"lon\":73.85,\"range\":1500}");
        var calls = new AtomicInteger();
        OpenCellIdClient client = stub(body, calls);

        assertEquals(18.5, client.find(TOWER).lat());
        assertEquals(1500, client.find(TOWER).rangeM());
        assertEquals(1, calls.get());

        body.set("{\"error\":\"Cell not found\",\"code\":1}");
        Tower other = new Tower(404, 20, 1234, 11111);
        assertNull(client.find(other));
        assertNull(client.find(other));
        assertEquals(2, calls.get());
    }

    @Test
    void outageIsNotRememberedAsAnUnknownTower() throws IOException {
        var body = new AtomicReference<>("{\"error\":\"Daily limit exceeded\",\"code\":7}");
        var calls = new AtomicInteger();
        OpenCellIdClient client = stub(body, calls);

        assertNull(client.find(TOWER));
        body.set("{\"lat\":18.5,\"lon\":73.85}");
        var position = client.find(TOWER);
        assertEquals(2000, position.rangeM(), "a default when the range isn't given");
    }
}
