// Finds the timetable grid on a TAG page image: the blue lines between cells.
import jpeg from 'jpeg-js'
import { readFileSync } from 'node:fs'

export function loadPage(file) {
  return jpeg.decode(readFileSync(file), { useTArray: true })
}

// The table's border and cell lines are a saturated sky blue.
const isLine = (r, g, b) => b > 140 && r < 140 && b - r > 60 && g > 100

/** Groups neighbouring positions (a line is 1-3 px thick) into their centres. */
function centres(hits) {
  const out = []
  let run = []
  for (const x of hits) {
    if (run.length && x - run[run.length - 1] > 2) {
      out.push(Math.round(run.reduce((a, b) => a + b, 0) / run.length))
      run = []
    }
    run.push(x)
  }
  if (run.length) out.push(Math.round(run.reduce((a, b) => a + b, 0) / run.length))
  return out
}

/**
 * The table's vertical and horizontal lines. A position is a line when most of its length within the
 * table is line-coloured. Returns {xs, ys} sorted.
 */
export function findGrid(img) {
  const { width: W, height: H, data } = img
  const line = (x, y) => {
    const i = (y * W + x) * 4
    return isLine(data[i], data[i + 1], data[i + 2])
  }
  // Rough table bounds: rows and columns with many line pixels.
  const colCount = new Array(W).fill(0)
  const rowCount = new Array(H).fill(0)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (line(x, y)) {
    colCount[x]++
    rowCount[y]++
  }
  const tallest = Math.max(...colCount)
  const widest = Math.max(...rowCount)
  const xs = centres(colCount.map((c, x) => (c > tallest * 0.35 ? x : -1)).filter((x) => x >= 0))
  const ys = centres(rowCount.map((c, y) => (c > widest * 0.35 ? y : -1)).filter((y) => y >= 0))
  return { xs, ys, tallest, widest }
}

if (process.argv[2]) {
  const g = findGrid(loadPage(process.argv[2]))
  console.log('vertical lines', g.xs.length, g.xs.join(' '))
  console.log('horizontal lines', g.ys.length, g.ys.join(' '))
}
