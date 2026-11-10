import { lazy, Suspense } from 'react'
import { useSessionState } from '../lib/hooks.js'
import Timeline from './Timeline.jsx'
import { Message } from './ui.jsx'

// The map library is large, so it's only downloaded when someone opens the map.
const RouteMap = lazy(() => import('./RouteMap.jsx'))

const VIEWS = [
  ['stops', 'Stops'],
  ['map', 'Map'],
]

/**
 * The journey as a list of stops or on a map, with a switch between them that's remembered for the
 * visit. Props other than defaultView and storageKey go to the timeline.
 */
export default function JourneyView({ defaultView = 'stops', storageKey = 'wimb.view', stopsLabel = 'Stops', lineColor, ...timeline }) {
  const [view, setView] = useSessionState(storageKey, defaultView)

  return (
    <>
      <div role="tablist" aria-label="Show the journey as" className="mx-4 mt-3 mb-1 grid grid-cols-2 rounded-xl bg-line/70 p-1 text-sm font-semibold">
        {VIEWS.map(([id, label]) => [id, id === 'stops' ? stopsLabel : label]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`rounded-lg py-1.5 ${view === id ? 'bg-card shadow-sm' : 'text-ink-soft'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'map' ? (
        <div className="mt-2">
          <Suspense fallback={<Message title="Loading map…" />}>
            <RouteMap stops={timeline.stops} journey={timeline.journey} lineColor={lineColor} />
          </Suspense>
        </div>
      ) : (
        <Timeline {...timeline} train={Boolean(lineColor)} />
      )}
    </>
  )
}
