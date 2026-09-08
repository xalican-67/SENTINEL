// src/scheduler.js — SENTINEL block cadence coordinator
// Manages execution timing across 20 chains
// Prevents overlapping cycles

import { CHAINS, H, TOTAL_BLOCKS_DAY } from './config.js'

let totalBlocksToday = 0
let lastReset = Date.now()

export function recordBlock(chain, HOT) {
  totalBlocksToday++
  return totalBlocksToday
}

export function resetDaily(HOT) {
  totalBlocksToday = 0
  lastReset = Date.now()
}

export function getBlockStats(HOT) {
  const elapsed = (Date.now() - lastReset) / 1000 / 3600
  const rate    = elapsed > 0 ? totalBlocksToday / elapsed : 0
  return {
    totalToday:  totalBlocksToday,
    ratePerHour: Math.round(rate),
    maxPerDay:   TOTAL_BLOCKS_DAY,
    utilizationPct: Math.min(100, (totalBlocksToday / (TOTAL_BLOCKS_DAY / 24 * elapsed)) * 100),
  }
}
