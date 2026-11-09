export function NumberPlate({ number, large = false }) {
  return (
    <span
      className={`inline-block max-w-40 truncate rounded-lg bg-road font-extrabold tracking-tight text-ink ${
        large ? 'px-2.5 py-0.5 text-2xl' : 'px-2.5 py-0.5 text-base'
      }`}
    >
      {number}
    </span>
  )
}

export function Message({ title, children }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm text-ink-soft">{children}</p>}
    </div>
  )
}

/** Shows a failure in words people can act on, with a way to try again. */
export function ErrorMessage({ title = 'Something went wrong', error, onRetry }) {
  return (
    <div role="alert" className="m-4 rounded-2xl border border-line bg-card px-5 py-7 text-center shadow-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{error?.message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-paper">
          Try again
        </button>
      )}
    </div>
  )
}

export function BusIcon({ className = 'size-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M5 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a2 2 0 0 1-1 1.73V21a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.27A2 2 0 0 1 5 18V4Zm2 2v6h10V6H7Zm1.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
    </svg>
  )
}

function Stroke({ className, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function BellIcon({ filled, className = 'size-5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a2 2 0 0 0 3.4 0" />
    </svg>
  )
}

export const ReloadIcon = ({ className = 'size-5' }) => (
  <Stroke className={className}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Stroke>
)

export const SearchIcon = ({ className = 'size-5' }) => (
  <Stroke className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Stroke>
)

export const PinIcon = ({ className = 'size-5' }) => (
  <Stroke className={className}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </Stroke>
)

export const SwapIcon = ({ className = 'size-5' }) => (
  <Stroke className={className}>
    <path d="M7 4v16m0 0-3-3m3 3 3-3" />
    <path d="M17 20V4m0 0-3 3m3-3 3 3" />
  </Stroke>
)

export const ChevronIcon = ({ className = 'size-5' }) => (
  <Stroke className={className}>
    <path d="m6 9 6 6 6-6" />
  </Stroke>
)

export const CheckIcon = ({ className = 'size-5' }) => (
  <Stroke className={className}>
    <path d="m5 12 5 5L20 7" />
  </Stroke>
)
