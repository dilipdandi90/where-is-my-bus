import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { setUsageChoice, usageChoice } from '../lib/usage.js'

/**
 * Asks once whether usage can be recorded. Only appears when a database is set up to hold it.
 * The area checkbox starts unticked, so sharing it is a separate decision from the rest.
 */
export default function UsageConsent() {
  const [show, setShow] = useState(false)
  const [shareArea, setShareArea] = useState(false)

  useEffect(() => {
    if (usageChoice()) return
    api.usageStatus().then((s) => setShow(s.enabled)).catch(() => {})
  }, [])

  if (!show) return null

  const choose = (choice) => {
    setUsageChoice(choice)
    setShow(false)
  }

  return (
    <div role="dialog" aria-label="Help improve this app" className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl p-3">
      <div className="rounded-2xl border border-line bg-card p-4 shadow-xl">
        <p className="font-semibold">Help us improve the app?</p>
        <p className="mt-1 text-sm text-ink-soft">
          With your OK, we record what you search for and which buses you open, using a random ID that isn't linked to your
          name or number. We keep it for up to a year, and you can turn it off and delete it at any time.
        </p>
        <label className="mt-3 flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={shareArea} onChange={(e) => setShareArea(e.target.checked)} className="mt-0.5 size-5 accent-ink" />
          <span>Also share my approximate area (about 11 km), never my exact location</span>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => choose('none')} className="rounded-xl border border-line py-2.5 text-sm font-semibold">
            No thanks
          </button>
          <button onClick={() => choose(shareArea ? 'all' : 'usage')} className="rounded-xl bg-ink py-2.5 text-sm font-semibold text-paper">
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
