// src/gas.js — SENTINEL gas tracker

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, GAS_CAP_GWEI, H } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider = makeProvider()

export async function updateGas(HOT) {
  try {
    const fee  = await provider.getFeeData()
    const gwei = Number(fee.gasPrice || 0n) / 1e9
    HOT[H.GAS_PRICE] = gwei
    HOT[H.GAS_OK]    = gwei <= Number(GAS_CAP_GWEI) ? 1 : 0
  } catch {}
}

export function startGas(HOT) {
  updateGas(HOT)
  setInterval(() => updateGas(HOT), 10_000)
}
