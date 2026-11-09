package in.whereismybus.cell;

/** The ID that identifies one cell tower. {@code lac} holds the tac on LTE and 5G. */
public record Tower(int mcc, int mnc, int lac, long cid) {

    public boolean isValid() {
        return mcc >= 1 && mcc <= 999 && mnc >= 0 && mnc <= 999 && lac > 0 && cid > 0;
    }

    String key() {
        return mcc + "-" + mnc + "-" + lac + "-" + cid;
    }

    /** Where a tower is, and roughly how far from it a phone can be while connected. */
    public record Position(double lat, double lon, double rangeM, String source) {}
}
