// src/oracle.js — SENTINEL oracle reader
// Reads Chainlink prices live
// Updates HOT for dashboard display

import { ethers } from 'ethers'
import { PRIMARY_CHAIN, CHAINLINK, H } from './config.js'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider = makeProvider()
const ORACLE_ABI = ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']

async function readPrice(addr) {
  try {
    const oracle = new ethers.Contract(addr, ORACLE_ABI, provider)
    const [, answer, , updatedAt,] = await oracle.latestRoundData()
    return { price: Number(answer) / 1e8, updatedAt: Number(updatedAt) }
  } catch { return { price: 0, updatedAt: 0 } }
}

export async function updateOracles(HOT) {
  const [eth, btc, matic] = await Promise.all([
    readPrice(CHAINLINK.ETH_USD),
    readPrice(CHAINLINK.BTC_USD),
    readPrice(CHAINLINK.MATIC_USD),
  ])
  HOT[H.ORACLE_ETH]   = eth.price
  HOT[H.ORACLE_BTC]   = btc.price
  HOT[H.ORACLE_MATIC] = matic.price
}

export function startOracle(HOT) {
  updateOracles(HOT)
  setInterval(() => updateOracles(HOT), 60_000)
  console.log('[ORACLE] Chainlink feeds active — ETH/BTC/MATIC/USDC')
}
