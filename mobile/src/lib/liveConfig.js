// The same limits as the website (src/components/BusScreen.jsx).
export const config = {
  pollMs: 15_000,
  // A live bus moving back along the route by more than this has started a new run, not wobbled.
  restartKm: 1,
  // Fastest a city or state bus plausibly travels, plus slack for GPS wobble.
  maxBusKmh: 80,
  jumpAllowanceKm: 0.5,
  shareEveryMs: 15_000,
}
