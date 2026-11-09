package in.whereismybus.app;

import android.os.Build;
import android.telephony.CellIdentityGsm;
import android.telephony.CellIdentityLte;
import android.telephony.CellIdentityNr;
import android.telephony.CellIdentityWcdma;
import android.telephony.CellInfo;
import android.telephony.CellInfoGsm;
import android.telephony.CellInfoLte;
import android.telephony.CellInfoNr;
import android.telephony.CellInfoWcdma;
import android.telephony.CellSignalStrength;
import java.util.ArrayList;
import java.util.List;

/** Reduces what Android reports about nearby towers to the fields needed to look them up. */
final class CellReader {
    /** One tower. The ID is mcc, mnc, lac (tac on LTE and 5G) and cid. */
    static final class Cell {
        final String radio;
        final int mcc;
        final int mnc;
        final int lac;
        final long cid;
        final int dbm;
        final boolean serving;

        Cell(String radio, int mcc, int mnc, int lac, long cid, int dbm, boolean serving) {
            this.radio = radio;
            this.mcc = mcc;
            this.mnc = mnc;
            this.lac = lac;
            this.cid = cid;
            this.dbm = dbm;
            this.serving = serving;
        }
    }

    private CellReader() {}

    static List<Cell> read(List<CellInfo> infos) {
        List<Cell> cells = new ArrayList<>();
        if (infos == null) {
            return cells;
        }
        for (CellInfo info : infos) {
            Cell cell = toCell(info);
            // Neighbouring towers often report no ID, which makes them impossible to look up.
            if (cell != null && cell.mcc > 0 && cell.lac > 0 && cell.cid > 0) {
                cells.add(cell);
            }
        }
        return cells;
    }

    private static Cell toCell(CellInfo info) {
        boolean serving = info.isRegistered();
        if (info instanceof CellInfoLte) {
            CellInfoLte lte = (CellInfoLte) info;
            CellIdentityLte id = lte.getCellIdentity();
            String mcc = null, mnc = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                mcc = id.getMccString();
                mnc = id.getMncString();
            } else {
                mcc = String.valueOf(id.getMcc());
                mnc = String.valueOf(id.getMnc());
            }
            return cell("lte", mcc, mnc, id.getTac(), id.getCi(), lte.getCellSignalStrength(), serving);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && info instanceof CellInfoNr) {
            CellIdentityNr id = (CellIdentityNr) ((CellInfoNr) info).getCellIdentity();
            return cell("nr", id.getMccString(), id.getMncString(), id.getTac(), id.getNci(),
                    ((CellInfoNr) info).getCellSignalStrength(), serving);
        }
        if (info instanceof CellInfoWcdma) {
            CellInfoWcdma wcdma = (CellInfoWcdma) info;
            CellIdentityWcdma id = wcdma.getCellIdentity();
            String mcc = null, mnc = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                mcc = id.getMccString();
                mnc = id.getMncString();
            } else {
                mcc = String.valueOf(id.getMcc());
                mnc = String.valueOf(id.getMnc());
            }
            return cell("wcdma", mcc, mnc, id.getLac(), id.getCid(), wcdma.getCellSignalStrength(), serving);
        }
        if (info instanceof CellInfoGsm) {
            CellInfoGsm gsm = (CellInfoGsm) info;
            CellIdentityGsm id = gsm.getCellIdentity();
            String mcc = null, mnc = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                mcc = id.getMccString();
                mnc = id.getMncString();
            } else {
                mcc = String.valueOf(id.getMcc());
                mnc = String.valueOf(id.getMnc());
            }
            return cell("gsm", mcc, mnc, id.getLac(), id.getCid(), gsm.getCellSignalStrength(), serving);
        }
        return null;
    }

    private static Cell cell(String radio, String mcc, String mnc, int lac, long cid,
                             CellSignalStrength strength, boolean serving) {
        // Android reports missing fields as null, or as Integer.MAX_VALUE and Long.MAX_VALUE.
        if (mcc == null || mnc == null || lac == Integer.MAX_VALUE || cid == Integer.MAX_VALUE || cid == Long.MAX_VALUE) {
            return null;
        }
        try {
            return new Cell(radio, Integer.parseInt(mcc), Integer.parseInt(mnc), lac, cid, strength.getDbm(), serving);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
