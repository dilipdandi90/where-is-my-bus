import { useEffect, useState } from 'react'
import BusScreen from './components/BusScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Home from './components/Home.jsx'
import Insights from './components/Insights.jsx'
import UsageConsent from './components/UsageConsent.jsx'
import { api } from './lib/api.js'
import { shareArea } from './lib/usage.js'

const FEEDS_POLL_MS = 3000
const SAVED_FEEDS_KEY = 'wimb.feeds'

function readSavedFeeds() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_FEEDS_KEY))
  } catch {
    return null
  }
}

function saveFeeds(list) {
  try {
    localStorage.setItem(SAVED_FEEDS_KEY, JSON.stringify(list))
  } catch {
    // Private browsing can refuse storage, which only means waiting next time.
  }
}

function parseHash() {
  if (window.location.hash === '#/insights') return { insights: true }
  const [, feedId, kind, serviceId, trip] = window.location.hash.split('/')
  // The trip is there when a particular departure was tapped, as in the between-stops timetable.
  return kind === 'bus' && serviceId ? { feedId, serviceId, tripId: trip ? decodeURIComponent(trip) : null } : null
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  // The list from the last visit shows at once, so the app doesn't sit on "Connecting…" while a
  // sleeping server wakes up. Saved searches and buses then show from cache too.
  const [feeds, setFeeds] = useState(readSavedFeeds)
  const [feedsFailed, setFeedsFailed] = useState(false)

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  // Feeds load one after another when the server starts, and failed ones are retried, so keep
  // asking until they're all ready.
  useEffect(() => {
    let timer
    let stopped = false
    const poll = async () => {
      let allReady = false
      try {
        const list = await api.feeds()
        if (stopped) return
        setFeeds(list)
        // Only a fully loaded list is worth showing next time, not one caught mid-startup.
        if (list.every((f) => f.status === 'READY')) saveFeeds(list)
        setFeedsFailed(false)
        allReady = list.every((f) => f.status === 'READY')
      } catch {
        if (!stopped) setFeedsFailed(true)
      }
      if (!stopped && !allReady) timer = setTimeout(poll, FEEDS_POLL_MS)
    }
    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    shareArea()
  }, [])

  const feed = route && feeds?.find((f) => f.id === route.feedId)

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-paper sm:shadow-xl">
      <ErrorBoundary>
        {/* Keyed per screen so each one fades in. Opacity only: a transform here would pin the
            fixed refresh button to this box instead of the window while it animated. */}
        <div key={route?.insights ? 'insights' : (route ? `${route.serviceId}/${route.tripId ?? ''}` : 'home')} className="screen-fade">
          {route?.insights ? (
            <Insights />
          ) : route ? (
            <BusScreen feedId={route.feedId} feed={feed} serviceId={route.serviceId} initialTripId={route.tripId} />
          ) : (
            <Home feeds={feeds} failed={feedsFailed} />
          )}
        </div>
      </ErrorBoundary>
      {!route?.insights && <UsageConsent />}
    </div>
  )
}
