package in.whereismybus.app;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import android.telephony.CellInfo;
import android.telephony.TelephonyManager;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

/** Lets the web app read nearby cell towers, which browsers don't expose. */
@CapacitorPlugin(
    name = "CellTower",
    permissions = {
        @Permission(alias = "location", strings = {Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION})
    }
)
public class CellTowerPlugin extends Plugin {

    @PluginMethod
    public void getCells(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onPermission");
            return;
        }
        read(call);
    }

    @PermissionCallback
    private void onPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            read(call);
        } else {
            call.reject("Location permission denied", "denied");
        }
    }

    private void read(PluginCall call) {
        TelephonyManager telephony = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
        if (telephony == null) {
            call.reject("This device has no cell radio", "unavailable");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // getAllCellInfo alone can return stale data on newer Android versions.
                telephony.requestCellInfoUpdate(getContext().getMainExecutor(), new TelephonyManager.CellInfoCallback() {
                    @Override
                    public void onCellInfo(@NonNull List<CellInfo> cells) {
                        resolve(call, cells);
                    }

                    @Override
                    public void onError(int errorCode, Throwable detail) {
                        try {
                            resolve(call, telephony.getAllCellInfo());
                        } catch (SecurityException e) {
                            call.reject("Location permission denied", "denied");
                        }
                    }
                });
            } else {
                resolve(call, telephony.getAllCellInfo());
            }
        } catch (SecurityException e) {
            call.reject("Location permission denied", "denied");
        }
    }

    private void resolve(PluginCall call, List<CellInfo> infos) {
        JSArray cells = new JSArray();
        for (CellReader.Cell c : CellReader.read(infos)) {
            JSObject cell = new JSObject();
            cell.put("radio", c.radio);
            cell.put("mcc", c.mcc);
            cell.put("mnc", c.mnc);
            cell.put("lac", c.lac);
            cell.put("cid", c.cid);
            cell.put("dbm", c.dbm);
            cell.put("serving", c.serving);
            cells.put(cell);
        }
        JSObject result = new JSObject();
        result.put("cells", cells);
        call.resolve(result);
    }
}
