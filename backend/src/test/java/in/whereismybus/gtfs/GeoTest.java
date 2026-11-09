package in.whereismybus.gtfs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class GeoTest {
    private static final double[] LATS = {18.0, 18.1, 18.2};
    private static final double[] LONS = {73.0, 73.0, 73.0};
    private static final double[] KM = {0, 11.1, 22.2};

    @Test
    void positionOnRouteMapsToDistanceTravelled() {
        Geo.Snap snap = Geo.snap(18.05, 73.0, LATS, LONS, KM);
        assertEquals(5.55, snap.km(), 0.01);
        assertEquals(0, snap.offRouteKm(), 0.01);
    }

    @Test
    void roadsMayWanderFurtherFromTheLineAcrossLongGaps() {
        // About 1 km off the line between stops 11 km apart: within what a road can wander.
        assertEquals(0, Geo.snap(18.05, 73.0095, LATS, LONS, KM).offRouteKm(), 0.01);
    }

    @Test
    void distanceComesFromTheNearestGapEvenWhenAnEarlierOneIsWithinTolerance() {
        // Just past the middle stop, which is also within the first gap's allowance for wandering roads.
        assertEquals(12.21, Geo.snap(18.11, 73.0, LATS, LONS, KM).km(), 0.02);
    }

    @Test
    void positionFarFromRouteIsReportedOffRoute() {
        assertTrue(Geo.snap(18.05, 73.5, LATS, LONS, KM).offRouteKm() > 40);
    }
}
