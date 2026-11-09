package in.whereismybus.usage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class UsageTest {
    private static final String DEVICE = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

    @Test
    void positionsAreRoundedToAboutElevenKilometres() {
        assertEquals(18.5, UsageController.roundToArea(18.5204303, 90));
        assertEquals(73.9, UsageController.roundToArea(73.8567437, 180));
        assertNull(UsageController.roundToArea(null, 90));
        assertNull(UsageController.roundToArea(200.0, 90));
    }

    @Test
    void withoutADatabaseItIsSwitchedOff() {
        var store = new UsageStore("");
        assertFalse(store.enabled());
        assertFalse(new UsageController(store, "key").status().enabled());
    }

    @Test
    void acceptsTheAddressFormatProvidersGive() {
        var c = UsageStore.parse("postgresql://me:se%2Fcret@ep-1.neon.tech:5432/neondb?sslmode=require&channel_binding=require");
        assertEquals("jdbc:postgresql://ep-1.neon.tech:5432/neondb?sslmode=require", c.url());
        assertEquals("me", c.user());
        assertEquals("se/cret", c.password());
    }

    @Test
    void unknownEventsAndBadDevicesAreRefused() {
        var controller = new UsageController(new UsageStore(""), "key");
        var badEvent = new UsageController.EventRequest(DEVICE, "password", null, null, null, null, null, null, null);
        assertThrows(ResponseStatusException.class, () -> controller.event(badEvent));
        var badDevice = new UsageController.EventRequest("x", "search", null, null, null, null, null, null, null);
        assertThrows(ResponseStatusException.class, () -> controller.event(badDevice));
    }

    @Test
    void theSummaryNeedsTheRightKey() {
        var store = new UsageStore("postgresql://u:p@localhost:1/db");
        var controller = new UsageController(store, "right-key");
        assertTrue(store.enabled());
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> controller.summary("wrong")).getStatusCode().value());
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> controller.summary(null)).getStatusCode().value());
    }

    @Test
    void theSummaryStaysHiddenIfNoKeyWasSet() {
        var controller = new UsageController(new UsageStore("postgresql://u:p@localhost:1/db"), "");
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> controller.summary("")).getStatusCode().value());
    }
}
