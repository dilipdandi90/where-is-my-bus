package in.whereismybus.gtfs;

import java.util.Arrays;
import java.util.List;

/**
 * Detects and undoes a publishing bug in which each stop's time offset was summed from
 * already-cumulative travel times, so gaps between stops keep growing along the trip.
 *
 * In the TGSRTC feed of Feb 2026 this makes a 26 km city route take 11h47m. Taking the difference
 * between consecutive offsets recovers the real figures: median speed goes from 1.5 to 19.9 km/h.
 *
 * It's detected from the data on every load, not configured, so a corrected feed is left alone.
 */
final class TimingRepair {
    private static final double MIN_TRIP_KM = 3;
    private static final double IMPLAUSIBLY_SLOW_KMH = 5;
    private static final double MIN_RECOVERED_KMH = 8;
    private static final double MAX_RECOVERED_KMH = 45;

    /** One trip's total distance and its offsets in seconds from the first stop. */
    record Sample(double km, int[] offsets) {}

    private TimingRepair() {}

    static boolean isNeeded(List<Sample> trips) {
        double[] published = speeds(trips, false);
        if (published.length == 0) {
            return false;
        }
        double recovered = median(speeds(trips, true));
        return median(published) < IMPLAUSIBLY_SLOW_KMH
                && recovered >= MIN_RECOVERED_KMH && recovered <= MAX_RECOVERED_KMH;
    }

    static int[] repair(int[] offsets) {
        int[] out = new int[offsets.length];
        for (int i = 1; i < offsets.length; i++) {
            // Clamped because a later stop can't be reached before the one ahead of it.
            out[i] = Math.max(out[i - 1], offsets[i] - offsets[i - 1]);
        }
        return out;
    }

    private static double[] speeds(List<Sample> trips, boolean recovered) {
        return trips.stream()
                .filter(t -> t.km() >= MIN_TRIP_KM && t.offsets().length >= 6)
                .mapToDouble(t -> {
                    int[] o = recovered ? repair(t.offsets()) : t.offsets();
                    return t.km() / (Math.max(1, o[o.length - 1]) / 3600.0);
                })
                .toArray();
    }

    private static double median(double[] values) {
        Arrays.sort(values);
        return values[values.length / 2];
    }
}
