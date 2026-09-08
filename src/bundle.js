// src/bundle.js — SENTINEL Flashbots bundle

import { ethers }        from 'ethers'
import { EXECUTOR_PK, EXECUTOR, FLASHBOTS_RELAY, H } from './config.js'

const signer = new ethers.Wallet(EXECUTOR_PK)
let   bundlesSubmitted = 0
let   bundlesLanded    = 0

export async function submitBundle(txs, provider) {
  bundlesSubmitted++
  try {
    const block  = await provider.getBlockNumber()
    const bundle = {
      jsonrpc: '2.0', method: 'eth_sendBundle',
      params: [{
        txs, blockNumber: '0x' + (block + 1).toString(16),
        minTimestamp: 0, maxTimestamp: Math.floor(Date.now() / 1000) + 30,
        revertingTxHashes: [],
      }],
      id: Date.now(),
    }
    const body = JSON.stringify(bundle)
    const sig  = await signer.signMessage(ethers.getBytes(ethers.id(body)))
    const r    = await fetch(FLASHBOTS_RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Flashbots-Signature': `${EXECUTOR}:${sig}` },
      body, signal: AbortSignal.timeout(2_000),
    })
    const d = await r.json()
    if (d?.result?.bundleHash) { bundlesLanded++; return { ok: true, hash: d.result.bundleHash } }
    return { ok: false, error: d?.error?.message }
  } catch (e) { return { ok: false, error: e.message?.slice(0, 60) } }
}

export function getBundleStats(HOT) {
  HOT[H.BUNDLES_SENT]   = bundlesSubmitted
  HOT[H.BUNDLES_LANDED] = bundlesLanded
  return {
    submitted:   bundlesSubmitted,
    landed:      bundlesLanded,
    landingRate: bundlesSubmitted > 0 ? Math.round(bundlesLanded / bundlesSubmitted * 100) + '%' : '0%',
  }
}
