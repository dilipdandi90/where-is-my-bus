import { useState } from 'react'
import { setUsageChoice, usageChoice } from '../lib/usage.js'

/** Lets people change their mind about usage data, wherever the footer shows. */
function UsageSetting() {
  const [choice, setChoice] = useState(usageChoice)
  if (choice !== 'all' && choice !== 'usage') return null
  return (
    <button
      type="button"
      className="mt-1 underline"
      onClick={() => {
        setUsageChoice('none')
        setChoice('none')
      }}
    >
      Stop sharing usage data and delete it
    </button>
  )
}

/** Tells users what to watch for in a feed's data, wherever that data is shown, and who made the app. */
export default function FeedNotice({ feed }) {
  const warnings = []
  if (feed.expired) {
    warnings.push(`This timetable was only published up to ${formatDate(feed.validTo)}, so real buses may differ.`)
  }
  if (feed.timesRepaired) {
    warnings.push('The published file had a calculation error in its times. We corrected them, so treat them as approximate.')
  }
  if (feed.note) warnings.push(feed.note)

  return (
    <div className="text-xs leading-relaxed text-ink-soft">
      {warnings.map((w) => (
        <p key={w} className="mb-1.5 rounded-xl bg-tint px-2.5 py-1.5 text-ink">
          {w}
        </p>
      ))}
      {feed.hasLiveBuses && <p className="mb-1">Live positions don't cover every bus.</p>}
      <p className="font-semibold">Developed by Dilip Dandi</p>
      <UsageSetting />
    </div>
  )
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
