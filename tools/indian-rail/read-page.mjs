// Reads one TAG timetable page into rows and columns: the grid from the image, each cell read on its
// own, then every time corrected and verified against the page's exact text.
import jpeg from 'jpeg-js'
import { findGrid, loadPage } from './grid.mjs'

const SCALE = 3
const PAD = 3

const isInk = (r, g, b) => Math.max(r, g, b) < 135 && Math.max(r, g, b) - Math.min(r, g, b) < 75
// Junctions and terminals are printed in magenta-red, so station names accept that too.
const isRedInk = (r, g, b) => r > 150 && g < 90 && b < 170

/**
 * Dark printed text only, enlarged, as a JPEG ready for OCR, or null for an empty cell. The boxes
 * drawn around a train's first and last times are removed first, as they confuse the reader: they
 * are rows and columns of ink that run most of the way across the cell.
 */
function cellImage(img, x0, y0, x1, y1, red = false) {
  const left = x0 + PAD, top = y0 + PAD, w = x1 - x0 - 2 * PAD, h = y1 - y0 - 2 * PAD
  if (w < 4 || h < 4) return null
  const ink = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((top + y) * img.width + (left + x)) * 4
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]
    ink[y * w + x] = isInk(r, g, b) || (red && isRedInk(r, g, b)) ? 1 : 0
  }
  // Box edges: long horizontal runs of ink, then the vertical ends between them.
  for (let y = 0; y < h; y++) {
    let run = 0, best = 0
    for (let x = 0; x < w; x++) {
      run = ink[y * w + x] ? run + 1 : 0
      best = Math.max(best, run)
    }
    if (best > 28) for (let x = 0; x < w; x++) ink[y * w + x] = 0
  }
  for (let x = 0; x < w; x++) {
    let run = 0, best = 0
    for (let y = 0; y < h; y++) {
      run = ink[y * w + x] ? run + 1 : 0
      best = Math.max(best, run)
    }
    if (best > 15) for (let y = 0; y < h; y++) ink[y * w + x] = 0
  }
  let count = 0
  for (const v of ink) count += v
  if (count < 12) return null
  const W = w * SCALE + 20, H = h * SCALE + 20
  const out = Buffer.alloc(W * H * 4, 255)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink[y * w + x]) continue
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const o = ((10 + y * SCALE + dy) * W + (10 + x * SCALE + dx)) * 4
      out[o] = out[o + 1] = out[o + 2] = 0
    }
  }
  return jpeg.encode({ data: out, width: W, height: H }, 92).data
}

async function read(worker, buf, mode) {
  const whitelist = mode === 'time' ? '0123456789.:' : mode === 'int' ? '0123456789' : ''
  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: whitelist })
  const { data } = await worker.recognize(buf)
  return data.text.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** "17.50", "1750" or "17:50" to "17.50"; a run of dots to "..."; anything else to null. */
export function asTime(s) {
  const t = s.replace(/[^0-9.:]/g, '')
  if (/^[.:]{2,}$/.test(t)) return '...'
  const m = t.match(/^(\d{1,2})[.:]?(\d{2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  return hh < 24 && mm < 60 ? `${String(hh).padStart(2, '0')}.${m[2]}` : null
}

// Rows above the stations hold these labels, and the stations end at "Days of arrival".
const HEADER = [
  ['name', /TRAIN\s*NAME/i],
  ['number', /ain\s*N|umb[ae]r/i],
  ['classes', /ass\s*of|accom/i],
  // Forgiving, as the labels are often half-read ("ys of arrival at tination station").
  ['fromTable', /From\s*Ta/i],
  ['days', /of\s*dep|originat/i],
  ['arrivalDays', /of\s*arr|arrival|destinat/i],
  ['toTable', /To\s*Ta[bh]/i],
]

/**
 * The page as {columns, header: {name: [...], number: [...], ...}, stations: [{km, name, ad, cells}]}.
 * cells holds each train's lines in that row (one or two: arrival and departure).
 */
export async function readPage(worker, file) {
  const img = loadPage(file)
  const { xs, ys } = findGrid(img)
  const [tableLeft, kmEnd, nameEnd, adEnd, ...edges] = xs
  const bounds = [adEnd, ...edges]
  const cols = bounds.slice(0, -1).map((x, i) => [x, bounds[i + 1]])
  const header = {}
  const stations = []
  for (let r = 0; r + 1 < ys.length; r++) {
    const y0 = ys[r], y1 = ys[r + 1]
    // Dense tables have rows only ~17 px tall, so only slivers between doubled lines are skipped.
    if (y1 - y0 < 9) continue
    const labelBuf = cellImage(img, tableLeft, y0, adEnd, y1)
    const label = labelBuf ? (await read(worker, labelBuf, 'text')).join(' ') : ''
    const kind = HEADER.find(([, re]) => re.test(label))?.[0]
    if (kind) {
      const mode = kind === 'number' ? 'int' : 'text'
      header[kind] = []
      for (const [c0, c1] of cols) {
        const buf = cellImage(img, c0, y0, c1, y1)
        header[kind].push(buf ? (await read(worker, buf, mode)).join(' ') : '')
      }
      continue
    }
    if (!header.number || header.arrivalDays) continue
    const kmBuf = cellImage(img, tableLeft, y0, kmEnd, y1)
    const nameBuf = cellImage(img, kmEnd, y0, nameEnd, y1, true)
    const adBuf = cellImage(img, nameEnd, y0, adEnd, y1)
    const cells = []
    for (const [c0, c1] of cols) {
      const buf = cellImage(img, c0, y0, c1, y1)
      cells.push(buf ? (await read(worker, buf, 'time')).map((t) => asTime(t) ?? `?${t}`) : [])
    }
    stations.push({
      y0,
      y1,
      km: kmBuf ? (await read(worker, kmBuf, 'int')).join('') : '',
      name: nameBuf ? (await read(worker, nameBuf, 'text')).join(' ') : '',
      ad: adBuf ? (await read(worker, adBuf, 'text')).join('').replace(/[^ad]/g, '') : '',
      cells,
    })
  }
  return { columns: cols.length, header, stations }
}

/**
 * Corrects what was read with the page's exact text. Both are lists of the same values in the same
 * order (row by row, left to right, top line first), so a longest-common-subsequence alignment pairs
 * them up: equal values match, and a misread value lines up against the true one, which replaces it.
 * Returns the number of values fixed and those that couldn't be confirmed.
 */
export function correctWithText(stations, pageText) {
  // "..." (passes without stopping) is too faint to read reliably and carries no time, so it's left out.
  const truth = (pageText.match(/\d{1,2}[.:]\d{2}/g) ?? []).map((t) => asTime(t) ?? t)
  // The cells' values in reading order, with where each came from.
  const read = []
  for (const s of stations) s.cells.forEach((lines, c) => lines.forEach((v, l) => v !== '...' && read.push({ v, s, c, l })))
  // Edit distance with a cheaper substitution between two times (a misread digit) than a deletion.
  const n = read.length, m = truth.length
  const cost = (a, b) => (a === b ? 0 : /^\d\d\.\d\d$/.test(a ?? '') && /^\d\d\.\d\d$/.test(b) && digitsApart(a, b) <= 2 ? 1 : 3)
  const D = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = 0; i <= n; i++) D[i][0] = i * 2
  for (let j = 0; j <= m; j++) D[0][j] = j * 2
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i][j] = Math.min(D[i - 1][j - 1] + cost(read[i - 1].v, truth[j - 1]), D[i - 1][j] + 2, D[i][j - 1] + 2)
  }
  let i = n, j = m, fixed = 0
  const unconfirmed = []
  const missing = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + cost(read[i - 1].v, truth[j - 1])) {
      const cell = read[i - 1]
      if (cell.v !== truth[j - 1]) {
        cell.s.cells[cell.c][cell.l] = truth[j - 1]
        fixed++
      }
      i--
      j--
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 2) {
      unconfirmed.push(read[i - 1].v)
      read[i - 1].s.cells[read[i - 1].c][read[i - 1].l] = `?${read[i - 1].v}`
      i--
    } else {
      missing.push(truth[j - 1])
      j--
    }
  }
  return { fixed, unconfirmed, missing }
}

function digitsApart(a, b) {
  let d = 0
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) d++
  return d
}
