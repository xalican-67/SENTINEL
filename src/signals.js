// src/signals.js — SENTINEL signal tracker

import { H } from './config.js'

const log = []
const MAX_LOG = 500

export function recordSignal(cycleId, profit, strategy, txHash) {
  log.unshift({ cycleId, profit, strategy, txHash, ts: Date.now() })
  if (log.length > MAX_LOG) log.pop()
}

export function recordSkip(cycleId, reason, checkFailed) {
  log.unshift({ cycleId, skipped: true, reason, checkFailed, ts: Date.now() })
  if (log.length > MAX_LOG) log.pop()
}

export function getSignalLog(limit = 50) {
  return log.slice(0, limit)
}
