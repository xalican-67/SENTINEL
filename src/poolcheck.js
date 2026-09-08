// src/poolcheck.js — SENTINEL pool depth checker (CHECK 5)

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, UNI_POOLS, USDC_POLYGON, H } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider  = makeProvider()
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

export async function getPoolDepths() {
  try {
    const usdc   = new ethers.Contract(USDC_POLYGON, ERC20_ABI, provider)
    const depths = await Promise.all(
      Object.entries(UNI_POOLS).map(async ([name, addr]) => {
        const bal = await usdc.balanceOf(addr)
        return { name, addr, depthUSD: Number(bal) / 1e6 }
      })
    )
    return depths
  } catch { return [] }
}

export async function computeSlippage(flashAmount, poolDepth) {
  if (poolDepth <= 0) return 100
  return (flashAmount / poolDepth) * 100
}
