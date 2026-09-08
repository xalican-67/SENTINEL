// src/reconciler.js — SENTINEL on-chain reconciliation
// Every 100 cycles — reads confirmed USDC vs computed
// Flags discrepancies

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, CONTRACT, TREASURY, USDC_POLYGON, H, CHECK } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider  = makeProvider()
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

export async function reconcile(HOT) {
  try {
    const usdc     = new ethers.Contract(USDC_POLYGON, ERC20_ABI, provider)
    const addr     = CONTRACT.SENTINEL_VAULT || TREASURY
    const raw      = await usdc.balanceOf(addr)
    const confirmed = Number(raw) / 1e6
    const computed  = HOT[H.VAULT_COMPUTED] || 0

    HOT[H.VAULT_CONFIRMED] = confirmed

    if (computed > 0) {
      const score = Math.min(100, (confirmed / computed) * 100)
      HOT[H.RECONCILE_SCORE] = score
      if (score < 100 - CHECK.MAX_DISCREPANCY) {
        console.log(`[RECONCILER] ⚠ Gap: confirmed $${confirmed.toFixed(2)} vs computed $${computed.toFixed(2)} | score: ${score.toFixed(1)}%`)
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.log(`[RECONCILER] ${e.message?.slice(0, 60)}`)
  }
}

export function startReconciler(HOT) {
  setInterval(() => reconcile(HOT), 600_000)
  console.log('[RECONCILER] On-chain reconciliation active | every 10 min')
}
