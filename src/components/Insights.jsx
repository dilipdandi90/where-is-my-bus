import { useState } from 'react'
import { api } from '../lib/api.js'
import { ErrorMessage } from './ui.jsx'

const SECTIONS = [
  ['regions', 'Users by region', 'Who uses which region'],
  ['areas', 'Where users are', 'Approximate areas, from those who agreed. Tap one to see it on a map.'],
  ['searches', 'Top searches', 'What people look for most'],
  ['noResults', 'Searches with no results', 'What people wanted and couldn’t find'],
  ['routes', 'Top routes', 'Between-stops searches'],
  ['buses', 'Most opened buses', ''],
  ['tracking', 'Tracking method', 'Cell tower or GPS'],
  ['perDay', 'Users per day', 'Latest first'],
]

/** A private page for the app's owner, at #/insights. It only opens with the admin key. */
export default function Insights() {
  const [key, setKey] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      setData(await api.usageSummary(key))
    } catch (failure) {
      setData(null)
      setError(failure)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="app-header flex items-center gap-2 px-2 py-3 text-paper">
        <a href="#/" aria-label="Back to search" className="flex size-10 items-center justify-center rounded-full text-xl">
          ←
        </a>
        <h1 className="text-lg font-bold">Usage insights</h1>
      </header>

      <main className="px-4 py-4">
        <form onSubmit={load} className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Admin key</span>
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Admin key"
              className="w-full rounded-xl border border-line bg-card px-3.5 py-3 outline-none"
            />
          </label>
          <button disabled={!key || loading} className="rounded-xl bg-ink px-5 font-semibold text-paper disabled:opacity-40">
            {loading ? 'Loading…' : 'Open'}
          </button>
        </form>

        {error && <ErrorMessage title="Couldn't open insights" error={error} />}

        {data && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Stat label={`Users, last ${data.days} days`} value={data.users.count} />
              <Stat label="Actions recorded" value={data.users.events} />
            </div>
            {SECTIONS.map(([id, title, hint]) => (
              <Section key={id} title={title} hint={hint} rows={data[id]} isArea={id === 'areas'} />
            ))}
          </>
        )}
      </main>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3.5 shadow-sm">
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  )
}

function Section({ title, hint, rows, isArea }) {
  const top = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section className="mt-5">
      <h2 className="font-bold">{title}</h2>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">Nothing yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
          {rows.map((r) => (
            <li key={r.label} className="px-3.5 py-2">
              <div className="flex justify-between gap-3 text-sm">
                {isArea ? (
                  <a href={`https://www.google.com/maps?q=${r.label}`} target="_blank" rel="noreferrer" className="underline">
                    {r.label}
                  </a>
                ) : (
                  <span className="min-w-0 break-words">{r.label}</span>
                )}
                <span className="shrink-0 font-semibold">{r.count}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-line">
                <div className="h-1 rounded-full bg-road" style={{ width: `${(r.count / top) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
