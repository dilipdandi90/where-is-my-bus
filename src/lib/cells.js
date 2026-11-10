import { api } from './api.js'

/**
 * Browsers never expose nearby cell towers to web pages, so the website uses the phone's network
 * location instead. The mobile app (mobile/) reads towers directly.
 */
export const canReadTowers = () => false

export async function readCells() {
  throw new Error("Browsers can't read cell towers")
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
