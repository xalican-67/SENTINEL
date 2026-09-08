// src/propeller.js — SENTINEL propeller governor
// P1–P10 — hard cycle ceiling per day
// Not a target pointer — an enforced ceiling

import { PROPELLER, H, setPropeller } from './config.js'

export function activatePropeller(level, HOT) {
  const ok = setPropeller(level)
  if (!ok) return false
  HOT[H.PROPELLER]    = parseInt(level.replace('P', ''))
  HOT[H.DAILY_TARGET] = PROPELLER[level].target
  HOT[H.CYCLES_MAX]   = PROPELLER[level].maxCycles
  console.log(`[PROPELLER] ${level} | target: ${PROPELLER[level].label} | ceiling: ${PROPELLER[level].maxCycles} cycles`)
  return true
}

export function getPropellerStats() {
  return Object.entries(PROPELLER).map(([level, data]) => ({
    level,
    target:    data.target,
    label:     data.label,
    maxCycles: data.maxCycles,
  }))
}

export function getProgress(HOT) {
  const target = HOT[H.DAILY_TARGET]
  if (!target || target === Number.MAX_SAFE_INTEGER) {
    return HOT[H.CYCLES_TODAY] > 0 ? 50 : 0
  }
  return Math.min(100, ((HOT[H.REV_TODAY] || 0) / target) * 100)
}

export function getCeilingPct(HOT) {
  const max  = HOT[H.CYCLES_MAX]   || 1
  const used = HOT[H.CYCLES_TODAY] || 0
  return Math.min(100, (used / max) * 100)
}
