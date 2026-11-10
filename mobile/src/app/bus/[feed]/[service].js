import { useLocalSearchParams } from 'expo-router'
import BusScreen from '../../../components/BusScreen.js'

/** One bus or metro line. `trip` is set when a particular departure was tapped. */
export default function BusRoute() {
  const { feed, service, trip } = useLocalSearchParams()
  return <BusScreen key={`${feed}/${service}/${trip ?? ''}`} feedId={feed} serviceId={service} initialTripId={trip} />
}
