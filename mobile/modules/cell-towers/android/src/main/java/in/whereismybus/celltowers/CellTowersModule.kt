package `in`.whereismybus.celltowers

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.CellIdentityGsm
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityNr
import android.telephony.CellIdentityWcdma
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellSignalStrength
import android.telephony.TelephonyManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the cell towers the phone can hear, reduced to the fields needed to look them up (mcc, mnc,
 * lac or tac, and cell id). Phones don't let web pages see these, which is why this needs the app.
 *
 * Location permission must already be granted (the app asks with expo-location first), because
 * Android treats tower IDs as location data.
 */
class CellTowersModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CellTowers")

    AsyncFunction("getCells") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("unavailable", "The app isn't ready yet", null)
        return@AsyncFunction
      }
      if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
        context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
      ) {
        promise.reject("denied", "Location permission is needed to read cell towers", null)
        return@AsyncFunction
      }
      val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      if (telephony == null) {
        promise.reject("unavailable", "This device has no cell radio", null)
        return@AsyncFunction
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          // getAllCellInfo alone can return stale data on newer Android versions.
          telephony.requestCellInfoUpdate(context.mainExecutor, object : TelephonyManager.CellInfoCallback() {
            override fun onCellInfo(cells: MutableList<CellInfo>) {
              promise.resolve(toMaps(cells))
            }

            override fun onError(errorCode: Int, detail: Throwable?) {
              try {
                promise.resolve(toMaps(telephony.allCellInfo))
              } catch (e: SecurityException) {
                promise.reject("denied", "Location permission is needed to read cell towers", e)
              }
            }
          })
        } else {
          promise.resolve(toMaps(telephony.allCellInfo))
        }
      } catch (e: SecurityException) {
        promise.reject("denied", "Location permission is needed to read cell towers", e)
      }
    }
  }

  private fun toMaps(infos: List<CellInfo>?): List<Map<String, Any>> =
    (infos ?: emptyList()).mapNotNull(::toCell)
      // Neighbouring towers often report no ID, which makes them impossible to look up.
      .filter { it["mcc"] as Int > 0 && it["lac"] as Int > 0 && it["cid"] as Long > 0 }

  private fun toCell(info: CellInfo): Map<String, Any>? {
    val serving = info.isRegistered
    return when {
      info is CellInfoLte -> {
        val id: CellIdentityLte = info.cellIdentity
        cell("lte", mcc(id.mccString, id.mcc), mnc(id.mncString, id.mnc), id.tac, id.ci.toLong(), info.cellSignalStrength, serving)
      }
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && info is CellInfoNr -> {
        val id = info.cellIdentity as CellIdentityNr
        cell("nr", id.mccString, id.mncString, id.tac, id.nci, info.cellSignalStrength, serving)
      }
      info is CellInfoWcdma -> {
        val id: CellIdentityWcdma = info.cellIdentity
        cell("wcdma", mcc(id.mccString, id.mcc), mnc(id.mncString, id.mnc), id.lac, id.cid.toLong(), info.cellSignalStrength, serving)
      }
      info is CellInfoGsm -> {
        val id: CellIdentityGsm = info.cellIdentity
        cell("gsm", mcc(id.mccString, id.mcc), mnc(id.mncString, id.mnc), id.lac, id.cid.toLong(), info.cellSignalStrength, serving)
      }
      else -> null
    }
  }

  // The string forms arrived in Android 9; older versions only have the deprecated numbers.
  @Suppress("DEPRECATION")
  private fun mcc(text: String?, number: Int): String? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) text else number.toString()

  @Suppress("DEPRECATION")
  private fun mnc(text: String?, number: Int): String? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) text else number.toString()

  private fun cell(
    radio: String,
    mcc: String?,
    mnc: String?,
    lac: Int,
    cid: Long,
    strength: CellSignalStrength,
    serving: Boolean,
  ): Map<String, Any>? {
    // Android reports missing fields as null, or as Int.MAX_VALUE and Long.MAX_VALUE.
    if (mcc == null || mnc == null || lac == Int.MAX_VALUE || cid == Int.MAX_VALUE.toLong() || cid == Long.MAX_VALUE) {
      return null
    }
    return try {
      mapOf(
        "radio" to radio,
        "mcc" to mcc.toInt(),
        "mnc" to mnc.toInt(),
        "lac" to lac,
        "cid" to cid,
        "dbm" to strength.dbm,
        "serving" to serving,
      )
    } catch (e: NumberFormatException) {
      null
    }
  }
}
