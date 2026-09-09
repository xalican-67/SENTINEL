// src/mempool.js — SENTINEL mempool scanner (Worker)
// Runs as isolated worker thread — 60MB cap
// Detects qualifying pending swaps for MEV targeting

import { workerData, parentPort } from 'worker_threads'
import { ethers }                 from 'ethers'
import { PRIMARY_CHAIN }          from './config.js'

const SAB = workerData.SAB

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider = makeProvider()
const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
const SWAP_SELECTOR  = '0x414bf389'
const MIN_VALUE_ETH  = 0.1

async function scan() {
  try {
    const pending = await provider.send('txpool_content', [])
    if (!pending?.pending) return
    for (const [, txs] of Object.entries(pending.pending)) {
      for (const [, tx] of Object.entries(txs)) {
        if (
          tx.to?.toLowerCase() === UNISWAP_ROUTER.toLowerCase() &&
          tx.input?.startsWith(SWAP_SELECTOR) &&
          Number(tx.value || 0) / 1e18 >= MIN_VALUE_ETH
        ) {
          parentPort?.postMessage({ type: 'swap', hash: tx.hash })
        }
      }
    }
  } catch {}
}

setInterval(scan, 1_000)
