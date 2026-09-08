// src/amplifier.js — SENTINEL strategy amplification
// Tracks per-strategy contribution to total revenue

import { H } from './config.js'

const STRATEGIES = {
  1: { name: 'JIT Liquidity',  baseRate: 0.00045 },
  2: { name: 'Arbitrage',      baseRate: 0.002   },
  3: { name: 'Sandwich',       baseRate: 0.0015  },
  4: { name: 'Liquidation',    baseRate: 0.08    },
  5: { name: 'Combined',       baseRate: 0.003   },
  6: { name: 'Principal',      baseRate: 0.10    },
}

export function getStrategyRate(id) {
  return STRATEGIES[id]?.baseRate || 0.001
}

export function getStrategyName(id) {
  return STRATEGIES[id]?.name || 'Unknown'
}

export function computeExpectedProfit(strategyId, flashAmount) {
  return flashAmount * getStrategyRate(strategyId)
}

export function getAmplifierStats() {
  return Object.entries(STRATEGIES).map(([id, s]) => ({
    id:   parseInt(id),
    name: s.name,
    rate: s.baseRate,
    pct:  (s.baseRate * 100).toFixed(4) + '%',
  }))
}
