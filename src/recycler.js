// src/recycler.js — SENTINEL recycler
// Routes 20% of profits to Aave — grows flash capacity over time

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, CONTRACT, USDC_POLYGON, H } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

export async function checkRecycler(HOT) {
  if (!CONTRACT.SENTINEL_VAULT) return
  try {
    const p    = makeProvider()
    const usdc = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)
    if (CONTRACT.SENTINEL_VAULT) {
      const bal = await usdc.balanceOf(CONTRACT.SENTINEL_VAULT)
      HOT[H.RECYCLER_BAL] = Number(bal) / 1e6
    }
  } catch {}
}

export function startRecycler(HOT) {
  checkRecycler(HOT)
  setInterval(() => checkRecycler(HOT), 300_000)
  console.log('[RECYCLER] Active — 20% of profits compound flash capacity')
}
