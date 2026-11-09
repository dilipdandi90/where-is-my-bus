import { Capacitor, registerPlugin } from '@capacitor/core'
import { api } from './api.js'

const CellTower = registerPlugin('CellTower')

/** Only the Android app can read towers. Browsers don't expose them to web pages. */
export const canReadTowers = () => Capacitor.isNativePlatform()

export async function readCells() {
  const { cells } = await CellTower.getCells()
  return cells
}

// Earlier answers, so towers already seen on this journey still work if the network drops.
const answers = new Map()

export async function locateTowers(cells) {
  const key = cells.map((c) => `${c.mcc}-${c.mnc}-${c.lac}-${c.cid}`).sort().join('|')
  try {
    const answer = await api.locateCells(cells)
    if (answer.found) answers.set(key, answer)
    return answer
  } catch {
    return answers.get(key) ?? { found: false }
  }
}
