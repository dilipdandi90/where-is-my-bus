package in.whereismybus.gtfs;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("wimb")
public record FeedProperties(String dataDir, int refreshAfterHours, List<Feed> feeds) {

    /**
     * @param official whether the data is published by a government body, rather than rebuilt by a third party
     * @param note a limitation of this feed that users should see
     * @param numbersAreCodes whether its route numbers are data codes passengers wouldn't recognise
     * @param realtimeUrl where to get GTFS-Realtime positions from GPS devices on the buses, if anywhere
     * @param stopRadiusKm how far from a named stop still counts as that place when searching between
     *        stops. Walking distance suits city buses; a whole city suits buses between cities. Null
     *        means walking distance.
     * @param url where to download the GTFS zip, or classpath:path for a feed built into the app
     * @param mode "metro" for trains, so the app talks about lines, stations and trains; otherwise buses
     */
    public record Feed(String id, String name, String region, String operators, String url, String source,
                       String sourceUrl, boolean official, NumberRule numberRule, String note, boolean numbersAreCodes,
                       String realtimeUrl, Double stopRadiusKm, String mode) {
        public boolean builtIn() {
            return url.startsWith("classpath:");
        }
    }

    public enum NumberRule { TRIP_NAME_PREFIX, ROUTE_NAME }
}
