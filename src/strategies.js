// src/strategies.js — SENTINEL strategy router
// Selects optimal strategy per cycle based on live conditions

import { FLASH_CONFIG, H } from './config.js'

export function selectOptimalStrategy(cycleId, flashAmount, spread, gasPrice) {
  const minProfit = flashAmount * FLASH_CONFIG.extraction_rate

  // High spread — arbitrage is most profitable
  if (spread > 0.3) {
    return { name: 'ARB', id: 2, minProfit, priority: 1 }
  }

  // Low gas — sandwich is cost-effective
  if (gasPrice < 50) {
    return { name: 'SANDWICH', id: 3, minProfit, priority: 2 }
  }

  // Default — JIT liquidity (safest, consistent)
  if (cycleId % 3 === 0) {
    return { name: 'COMBINED', id: 5, minProfit, priority: 3 }
  }

  return { name: 'JIT', id: 1, minProfit, priority: 4 }
}

export function getStrategyStats(HOT) {
  return {
    jit:      HOT[H.MEV_JIT]      || 0,
    arb:      HOT[H.MEV_ARB]      || 0,
    sandwich: HOT[H.MEV_SANDWICH] || 0,
    liq:      HOT[H.MEV_LIQ]      || 0,
  }
}
