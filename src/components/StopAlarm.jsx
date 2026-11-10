import { ALARM_DISTANCES_KM } from '../lib/alarm.js'
import { formatDistance } from '../lib/time.js'

/** The red bar across the top while the alarm rings. */
export function AlarmBanner({ stop, onDismiss }) {
  return (
    <div role="alert" className="flex items-center gap-3 bg-late px-4 py-3 font-semibold text-white">
      <p className="flex-1">{stop.name} is coming up. Get ready!</p>
      <button onClick={onDismiss} className="rounded-md bg-white/20 px-3 py-1.5 text-sm">
        OK
      </button>
    </div>
  )
}

/**
 * Shows which stop the alarm is set for, how far there is still to go, and lets the rider choose how
 * early it rings.
 *
 * @param estimated whether the bus's position comes from the timetable, so the alarm may be off
 * @param estimateHint what to say when the position is only estimated
 */
export function AlarmNote({ stop, alarmKm, onChangeKm, remainingKm, estimated, estimateHint }) {
  return (
    <div className="mx-4 mt-2 rounded-xl bg-tint px-3 py-2.5 text-xs">
      <p>
        Alarm before <span className="font-semibold">{stop.name}</span>
        {remainingKm != null && <> · {formatDistance(remainingKm)} to go</>}. Keep this page open.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Ring this far before the stop">
        <span className="text-ink-soft">Ring at</span>
        {ALARM_DISTANCES_KM.map((km) => (
          <button
            key={km}
            role="radio"
            aria-checked={km === alarmKm}
            onClick={() => onChangeKm(km)}
            className={`rounded-full border px-2.5 py-1 font-semibold ${km === alarmKm ? 'border-road-dark bg-road-dark text-white' : 'border-line bg-card text-ink-soft'}`}
          >
            {km < 1 ? `${km * 1000} m` : `${km} km`}
          </button>
        ))}
      </div>
      {estimated && <p className="mt-2 text-ink-soft">{estimateHint}</p>}
    </div>
  )
}
