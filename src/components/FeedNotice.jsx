/** Tells users where a feed's data comes from and what's wrong with it, wherever that data is shown. */
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
      <p>
        <span className="font-semibold">{feed.official ? 'Government data' : 'Unofficial data, not from the operator'}</span>
        {': '}
        <a href={feed.sourceUrl} target="_blank" rel="noreferrer" className="underline">
          {feed.source}
        </a>
      </p>
      {feed.hasLiveBuses && (
        <p className="mt-1">
          <span className="font-semibold">Live bus positions</span> come from an unofficial community feed that doesn't cover every bus.
        </p>
      )}
    </div>
  )
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
