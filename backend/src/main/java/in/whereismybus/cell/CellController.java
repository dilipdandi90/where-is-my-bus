package in.whereismybus.cell;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Turns the towers a phone can see into a position. Nothing about the phone is kept. */
@RestController
@RequestMapping("/api/cells")
public class CellController {
    private static final int MAX_CELLS = 8;
    private static final double SERVING_WEIGHT = 4;
    private static final double MIN_ACCURACY_M = 300;

    private final LearnedTowers learned;
    private final OpenCellIdClient openCellId;

    public CellController(LearnedTowers learned, OpenCellIdClient openCellId) {
        this.learned = learned;
        this.openCellId = openCellId;
    }

    public record Cell(int mcc, int mnc, int lac, long cid, Integer dbm, boolean serving) {
        Tower tower() {
            return new Tower(mcc, mnc, lac, cid);
        }
    }

    public record LocateRequest(List<Cell> cells) {}

    public record LocateResult(boolean found, Double lat, Double lon, Double accuracy, String source, int towers) {}

    public record LearnRequest(List<Cell> cells, double lat, double lon, double accuracy) {}

    @PostMapping("/locate")
    public LocateResult locate(@RequestBody LocateRequest request) {
        List<Cell> cells = valid(request.cells());
        double sumWeight = 0, sumLat = 0, sumLon = 0, sumRange = 0;
        int located = 0;
        String source = null;
        for (Cell cell : cells) {
            // The rider's own map comes first: it's free and reflects real coverage along bus routes.
            Tower.Position p = learned.find(cell.tower());
            if (p == null) {
                p = openCellId.find(cell.tower());
            }
            if (p == null) {
                continue;
            }
            double weight = weight(cell);
            sumWeight += weight;
            sumLat += p.lat() * weight;
            sumLon += p.lon() * weight;
            sumRange += p.rangeM() * weight;
            located++;
            source = source == null || source.equals(p.source()) ? p.source() : "mixed";
        }
        if (located == 0) {
            return new LocateResult(false, null, null, null, null, 0);
        }
        return new LocateResult(true, sumLat / sumWeight, sumLon / sumWeight,
                Math.max(MIN_ACCURACY_M, sumRange / sumWeight), source, located);
    }

    @PostMapping("/learn")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void learn(@RequestBody LearnRequest request) {
        if (Math.abs(request.lat()) > 90 || Math.abs(request.lon()) > 180 || !(request.accuracy() >= 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid position");
        }
        // Only the connected tower: a neighbour can be far from the phone, on the edge of its range.
        valid(request.cells()).stream().filter(Cell::serving).forEach(c ->
                learned.learn(c.tower(), request.lat(), request.lon(), request.accuracy()));
    }

    /** Nearer towers count for more. Signal strength is the only hint of distance a phone gets. */
    private static double weight(Cell cell) {
        double fromSignal = cell.dbm() == null ? 1 : Math.pow(10, (cell.dbm() + 100) / 20.0);
        return (cell.serving() ? SERVING_WEIGHT : 1) * Math.max(0.1, Math.min(10, fromSignal));
    }

    private static List<Cell> valid(List<Cell> cells) {
        if (cells == null || cells.size() > MAX_CELLS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid cell list");
        }
        return cells.stream().filter(c -> c.tower().isValid()).toList();
    }
}
