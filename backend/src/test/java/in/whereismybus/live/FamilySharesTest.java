package in.whereismybus.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class FamilySharesTest {
    private final FamilyShares shares = new FamilyShares();
    private final Instant t0 = Instant.parse("2026-01-01T10:00:00Z");

    @Test
    void onlyTheRiderWithTheKeyCanMoveTheBus() {
        var created = shares.create("msrtc", "svc", "trip", t0);
        assertNotEquals(created.token(), created.key());
        assertEquals(FamilyShares.Result.WRONG_KEY, shares.update(created.token(), "guess", 5, true, t0));
        assertNull(shares.get(created.token(), t0).km());
        assertEquals(FamilyShares.Result.OK, shares.update(created.token(), created.key(), 5, true, t0));
        assertEquals(5.0, shares.get(created.token(), t0).km());
    }

    @Test
    void updatesTooCloseTogetherAreRefused() {
        var c = shares.create("msrtc", "svc", "trip", t0);
        shares.update(c.token(), c.key(), 5, true, t0);
        assertEquals(FamilyShares.Result.TOO_SOON, shares.update(c.token(), c.key(), 6, true, t0.plusSeconds(1)));
        assertEquals(FamilyShares.Result.OK, shares.update(c.token(), c.key(), 6, true, t0.plusSeconds(5)));
    }

    @Test
    void anEndedShareStaysVisibleButTakesNoMorePositions() {
        var c = shares.create("msrtc", "svc", "trip", t0);
        assertEquals(FamilyShares.Result.OK, shares.end(c.token(), c.key(), t0));
        assertTrue(shares.get(c.token(), t0).ended());
        assertEquals(FamilyShares.Result.NOT_FOUND, shares.update(c.token(), c.key(), 5, true, t0));
    }

    @Test
    void sharesExpireByThemselves() {
        var c = shares.create("msrtc", "svc", "trip", t0);
        assertNull(shares.get(c.token(), t0.plus(FamilyShares.LASTS_FOR).plusSeconds(1)));
        assertNull(shares.get("not-a-token", t0));
    }
}
