package in.whereismybus.gtfs;

/** Distances and projection of a position onto a route drawn through its stops. */
public final class Geo {
    private static final double EARTH_KM = 6371.0;
    /** Roads wander from the straight line between stops, more so across long gaps between towns. */
    private static final double ROAD_WANDER_PER_KM = 0.15;

    private Geo() {}

    public static double km(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double h = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
    }

    /** Where a position falls along a route: distance travelled, and how far outside the route's corridor it is. */
    public record Snap(double km, double offRouteKm) {}

    public static Snap snap(double lat, double lon, double[] lats, double[] lons, double[] cumKm) {
        double cos = Math.cos(Math.toRadians(lat));
        double nearest = Double.MAX_VALUE;
        double nearestKm = 0;
        double leastOutside = Double.MAX_VALUE;
        for (int i = 0; i + 1 < lats.length; i++) {
            // Flat projection is accurate enough across a single gap between stops.
            double ax = (lons[i] - lon) * cos, ay = lats[i] - lat;
            double bx = (lons[i + 1] - lon) * cos, by = lats[i + 1] - lat;
            double dx = bx - ax, dy = by - ay;
            double len = dx * dx + dy * dy;
            double t = len == 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
            double px = ax + t * dx, py = ay + t * dy;
            double distance = Math.sqrt(px * px + py * py) * Math.toRadians(1) * EARTH_KM;
            leastOutside = Math.min(leastOutside, Math.max(0, distance - ROAD_WANDER_PER_KM * (cumKm[i + 1] - cumKm[i])));
            if (distance < nearest) {
                nearest = distance;
                nearestKm = cumKm[i] + t * (cumKm[i + 1] - cumKm[i]);
            }
        }
        return new Snap(nearestKm, leastOutside);
    }
}
