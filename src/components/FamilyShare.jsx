import { useState } from 'react'
import { shareUrl } from '../lib/familyShare.js'

/** Sends the link with the phone's own share menu (WhatsApp, SMS…), or copies it where there's none. */
async function sendLink(url, to, words) {
  const text = `Track my ${words.bus} to ${to} live:`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Where Is My Bus', text, url })
      return null
    } catch (e) {
      if (e.name === 'AbortError') return null
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`)
    return 'Link copied. Paste it into WhatsApp or a message.'
  } catch {
    return url
  }
}

export function FamilyShareControl({ family, destination, words }) {
  const { share, start, stop, busy, error } = family
  const [note, setNote] = useState(null)

  const send = async () => {
    const current = share ?? (await start())
    if (current) setNote(await sendLink(shareUrl(current.token), destination, words))
  }

  return (
    <div className="border-b border-line px-4 py-3 text-sm">
      {share ? (
        <>
          <p className="flex items-center gap-2 font-semibold text-ontime">
            <span className="live-dot size-2 rounded-full bg-ontime" />
            Sharing this {words.bus} with family
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">They see where the {words.bus} is on the route, not your exact location. Stops when you tap Stop or get off.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={send} className="press rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper">
              Send link again
            </button>
            <button
              onClick={() => {
                stop()
                setNote(null)
              }}
              className="press rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold"
            >
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <button onClick={send} disabled={busy} className="press flex w-full items-center justify-between gap-3 text-left">
          <span>
            <span className="block font-semibold">Share live location with family</span>
            <span className="block text-xs text-ink-soft">Send a link that shows this {words.bus} moving. No app needed to open it.</span>
          </span>
          <span className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper">{busy ? 'Creating…' : 'Share'}</span>
        </button>
      )}
      {(note || error) && <p className={`mt-2 text-xs break-all ${error ? 'text-late' : 'text-ink-soft'}`}>{error ?? note}</p>}
    </div>
  )
}
