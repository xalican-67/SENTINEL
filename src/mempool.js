// src/mempool.js — SENTINEL mempool scanner
// Detects pending transactions for MEV targeting
// Feeds opportunity queue to executor

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, H } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider = makeProvider()

const UNISWAP_ROUTER   = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
const SWAP_SELECTOR    = '0x414bf389'  // exactInputSingle
const MIN_VALUE_USD    = 100_000       // $100K minimum for MEV targeting

export async function scanMempool(HOT) {
  try {
    const pending = await provider.send('txpool_content', [])
    if (!pending?.pending) return []

    const opportunities = []
    for (const [, txs] of Object.entries(pending.pending)) {
      for (const [, tx] of Object.entries(txs)) {
        if (
          tx.to?.toLowerCase() === UNISWAP_ROUTER.toLowerCase() &&
          tx.input?.startsWith(SWAP_SELECTOR)
        ) {
          const value = Number(tx.value || 0) / 1e18
          if (value >= 0.1) { // 0.1 ETH minimum
            opportunities.push({
              hash:     tx.hash,
              from:     tx.from,
              value,
              gasPrice: Number(tx.gasPrice || 0) / 1e9,
            })
          }
        }
      }
    }
    return opportunities
  } catch { return [] }
}

export function startMempool(HOT) {
  setInterval(async () => {
    const opps = await scanMempool(HOT)
    if (opps.length > 0) {
      HOT[H.NATURAL_TODAY] = (HOT[H.NATURAL_TODAY] || 0) + opps.length
    }
  }, 1_000)
  console.log('[MEMPOOL] Scanner active — targeting Uniswap V3 swaps')
}
