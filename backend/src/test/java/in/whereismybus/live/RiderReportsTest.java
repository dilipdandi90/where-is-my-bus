package in.whereismybus.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class RiderReportsTest {
    private final RiderReports reports = new RiderReports();
    private final Instant t0 = Instant.parse("2026-01-01T10:00:00Z");

    @Test
    void oneBadReportCannotMoveTheBus() {
        reports.add("t", "rider-a", 5.0, true, t0);
        reports.add("t", "rider-b", 5.2, true, t0);
        reports.add("t", "rider-c", 40.0, true, t0);
        assertEquals(5.2, reports.consensus("t", t0).km());
    }

    @Test
    void gpsOutranksCellPositions() {
        reports.add("t", "rider-a", 5.0, true, t0);
        reports.add("t", "rider-b", 9.0, false, t0);
        reports.add("t", "rider-c", 9.5, false, t0);
        var c = reports.consensus("t", t0);
        assertEquals(5.0, c.km());
        assertTrue(c.gps());
        assertEquals(3, c.riders());
    }

    @Test
    void oldReportsAreIgnored() {
        reports.add("t", "rider-a", 5.0, true, t0);
        assertNull(reports.consensus("t", t0.plus(RiderReports.FRESH_FOR).plusSeconds(1)));
    }

    @Test
    void riderCannotFloodReports() {
        assertTrue(reports.add("t", "rider-a", 5.0, true, t0));
        assertFalse(reports.add("t", "rider-a", 6.0, true, t0.plusSeconds(1)));
        assertTrue(reports.add("t", "rider-a", 6.0, true, t0.plusSeconds(4)));
    }
}
