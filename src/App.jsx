import { useEffect, useState } from 'react'
import BusScreen from './components/BusScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Home from './components/Home.jsx'
import { api } from './lib/api.js'

const FEEDS_POLL_MS = 3000

function parseHash() {
  const [, feedId, kind, serviceId] = window.location.hash.split('/')
  return kind === 'bus' && serviceId ? { feedId, serviceId } : null
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const [feeds, setFeeds] = useState(null)
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

  const feed = route && feeds?.find((f) => f.id === route.feedId)

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-paper sm:shadow-xl">
      <ErrorBoundary>
        {route ? (
          <BusScreen key={route.serviceId} feedId={route.feedId} feed={feed} serviceId={route.serviceId} />
        ) : (
          <Home feeds={feeds} failed={feedsFailed} />
        )}
      </ErrorBoundary>
    </div>
  )
}
