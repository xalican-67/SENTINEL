// src/treasury.js — SENTINEL treasury reconciliation
// Reads confirmed on-chain USDC every 10 minutes
// Compares to computed cumulative — reconciliation score

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, CONTRACT, H, TREASURY, USDC_POLYGON } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider = makeProvider()
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

export async function reconcile(HOT) {
  try {
    const usdc     = new ethers.Contract(USDC_POLYGON, ERC20_ABI, provider)
    const watchAddr = CONTRACT.SENTINEL_VAULT || TREASURY
    const rawBal   = await usdc.balanceOf(watchAddr)
    const confirmed = Number(rawBal) / 1e6
    HOT[H.VAULT_CONFIRMED] = confirmed

    const computed = HOT[H.VAULT_COMPUTED] || 0
    let score = 100
    if (computed > 0) {
      score = Math.min(100, (confirmed / computed) * 100)
    }
    HOT[H.RECONCILE_SCORE] = score

    if (HOT[H.FIRST_REV] === 0 && confirmed > 0) {
      HOT[H.FIRST_REV] = 1
      console.log(`[TREASURY] First revenue confirmed — $${confirmed.toFixed(2)} USDC on-chain`)
    }

    if (!reconcile._count) reconcile._count = 0
    reconcile._count++
    if (reconcile._count % 2 === 0) {
      const fmt = confirmed >= 1e6
        ? `$${(confirmed/1e6).toFixed(3)}M`
        : `$${confirmed.toFixed(2)}`
      console.log(`[TREASURY] ${fmt} USDC confirmed | computed: $${computed.toFixed(2)} | score: ${score.toFixed(1)}%`)
    }
  } catch (e) {
    if (process.env.DEBUG) console.log(`[TREASURY] ${e.message?.slice(0, 60)}`)
  }
}

export function startTreasury(HOT) {
  reconcile(HOT)
  setInterval(() => reconcile(HOT), 600_000)
  console.log(`[TREASURY] Watching ${CONTRACT.SENTINEL_VAULT || TREASURY}`)
}
