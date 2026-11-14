// Reads every timetable page of TAG 2026: downloads each page image once, reads it with a few workers
// in parallel, corrects it with the page's exact text, and saves one JSON per page. Safe to re-run:
// pages already saved are skipped.
import Tesseract from 'tesseract.js'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { correctWithText, readPage } from './read-page.mjs'

// Downloaded pages, the book's text and intermediate results. Not committed (see .gitignore).
const R = fileURLToPath(new URL('./work/', import.meta.url))
const BOOK = 'https://www.irctctourism.com/packageImage/TagBook/2026/English/files/page/'
const WORKERS = 7
mkdirSync(R + 'img', { recursive: true })
mkdirSync(R + 'out', { recursive: true })

const pages = JSON.parse(readFileSync(R + 'pages.json', 'utf8'))
const todo = pages.map((text, i) => (/Train\s+Number/.test(text) ? i + 1 : null)).filter(Boolean)
console.log(`timetable pages: ${todo.length}`)

async function download(n) {
  const file = `${R}img/${n}.jpg`
  if (existsSync(file)) return file
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BOOK}${n}.jpg`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      // A short pause between downloads, so the book's server isn't hammered.
      await new Promise((r) => setTimeout(r, 400))
      return file
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
}

let next = 0
let done = 0
const started = Date.now()
const totals = { fixed: 0, unconfirmed: 0, missing: 0, failed: 0 }

async function run() {
  const worker = await Tesseract.createWorker('eng')
  while (next < todo.length) {
    const n = todo[next++]
    const outFile = `${R}out/p${n}.json`
    if (existsSync(outFile)) {
      done++
      continue
    }
    try {
      const file = await download(n)
      const page = await readPage(worker, file)
      const check = correctWithText(page.stations, pages[n - 1])
      writeFileSync(outFile, JSON.stringify({ page: n, ...page, check }))
      totals.fixed += check.fixed
      totals.unconfirmed += check.unconfirmed.length
      totals.missing += check.missing.length
    } catch (e) {
      totals.failed++
      writeFileSync(`${R}out/p${n}.error.txt`, String(e?.stack ?? e))
    }
    done++
    if (done % 10 === 0) {
      const rate = (Date.now() - started) / done
      console.log(`${done}/${todo.length} pages | ~${Math.round(((todo.length - done) * rate) / 60000)} min left | fixed ${totals.fixed}, unconfirmed ${totals.unconfirmed}, missing ${totals.missing}, failed ${totals.failed}`)
    }
  }
  await worker.terminate()
}

await Promise.all(Array.from({ length: WORKERS }, run))
console.log(`DONE ${done}/${todo.length} in ${Math.round((Date.now() - started) / 60000)} min | fixed ${totals.fixed}, unconfirmed ${totals.unconfirmed}, missing ${totals.missing}, failed ${totals.failed}`)
