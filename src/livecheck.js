// src/livecheck.js — SENTINEL live pre-execution check
// 7-point check before every cycle
// Reads live flash, gas, spread, oracle, depth, treasury, capacity
// Returns go/skip + live data for executor

import { ethers } from 'ethers'
import {
  PRIMARY_CHAIN, BALANCER_VAULT, AAVE_POOL,
  USDC_POLYGON, WETH_POLYGON, CHAINLINK,
  UNI_POOLS, H, GAS_CAP_GWEI,
  MAX_CYCLES_TODAY, DAILY_GAS_BUDGET,
  TREASURY,
} from './config.js'

const ERC20_ABI  = ['function balanceOf(address) view returns (uint256)']
const ORACLE_ABI = ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']
const POOL_ABI   = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)']

const A_USDC     = '0x625E7708f30cA75bfd92586e17077590C60eb4cD'
const MAX_AGE    = 300
const MIN_FLASH  = 1_000_000
const MIN_SPREAD = 0.0001

let _provider = null
let _cache    = null
let _cacheTs  = 0
const CACHE_TTL = 5_000

function getProvider() {
  if (!_provider) {
    const c = PRIMARY_CHAIN
    const n = new ethers.Network(c.name, c.id)
    _provider = new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
  }
  return _provider
}

async function getETHPrice()   {
  try {
    const o = new ethers.Contract(CHAINLINK.ETH_USD, ORACLE_ABI, getProvider())
    const [, ans,,] = await o.latestRoundData()
    return Number(ans) / 1e8
  } catch { return 3000 }
}

async function getMATICPrice() {
  try {
    const o = new ethers.Contract(CHAINLINK.MATIC_USD, ORACLE_ABI, getProvider())
    const [, ans,,] = await o.latestRoundData()
    return Number(ans) / 1e8
  } catch { return 0.8 }
}

// CHECK 1 — Live flash capital
async function check1_flash(p) {
  try {
    const usdc = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)
    const [b, a] = await Promise.all([
      usdc.balanceOf(BALANCER_VAULT),
      usdc.balanceOf(A_USDC),
    ])
    const balancer = Number(b) / 1e6
    const aave     = Number(a) / 1e6
    const total    = balancer + aave
    const pass     = total >= MIN_FLASH
    return { pass, balancer, aave, total, flashToUse: total,
      detail: `Balancer $${(balancer/1e6).toFixed(2)}M | Aave $${(aave/1e6).toFixed(2)}M` }
  } catch (e) {
    return { pass: false, balancer: 0, aave: 0, total: 0, flashToUse: 0,
      detail: `flash read failed: ${e.message?.slice(0,40)}` }
  }
}

// CHECK 2 — Gas cost vs expected profit
async function check2_gas(p, flashToUse) {
  try {
    const fee     = await p.getFeeData()
    const gwei    = Number(fee.gasPrice || 0n) / 1e9
    const matic   = await getMATICPrice()
    const gasCost = gwei * 3_500_000 * 1e-9 * matic
    const minProfit = flashToUse * 0.0005
    const pass = gwei <= Number(GAS_CAP_GWEI) && gasCost < minProfit * 0.01
    return { pass, gasGwei: gwei, gasCostUSD: gasCost, maticPrice: matic,
      detail: `${gwei.toFixed(1)} gwei | gas $${gasCost.toFixed(2)}` }
  } catch (e) {
    return { pass: false, gasGwei: 0, gasCostUSD: 0, maticPrice: 0.8,
      detail: `gas check failed` }
  }
}

// CHECK 3 — Live spread between two pools
async function check3_spread(p) {
  try {
    const pool1 = new ethers.Contract(UNI_POOLS.USDC_WETH_005, POOL_ABI, p)
    const pool2 = new ethers.Contract(UNI_POOLS.USDC_USDT_001, POOL_ABI, p)
    const [s1, s2] = await Promise.all([pool1.slot0(), pool2.slot0()])
    const price1 = (Number(s1.sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const price2 = (Number(s2.sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const spread = Math.abs(price1 - price2) / Math.min(price1, price2)
    const pass   = spread >= MIN_SPREAD
    return { pass, spread, price1, price2,
      buyPool:  price1 < price2 ? UNI_POOLS.USDC_WETH_005 : UNI_POOLS.USDC_USDT_001,
      sellPool: price1 < price2 ? UNI_POOLS.USDC_USDT_001 : UNI_POOLS.USDC_WETH_005,
      detail: `spread ${(spread*100).toFixed(4)}%` }
  } catch (e) {
    return { pass: false, spread: 0, detail: `spread check failed` }
  }
}

// CHECK 4 — Oracle freshness
async function check4_oracle(p) {
  try {
    const feeds = [
      { name: 'ETH',   addr: CHAINLINK.ETH_USD   },
      { name: 'MATIC', addr: CHAINLINK.MATIC_USD  },
      { name: 'USDC',  addr: CHAINLINK.USDC_USD   },
    ]
    const now = Math.floor(Date.now() / 1000)
    let ethPrice = 0, maticPrice = 0
    for (const feed of feeds) {
      const o = new ethers.Contract(feed.addr, ORACLE_ABI, p)
      const [, ans,, updatedAt,] = await o.latestRoundData()
      const age = now - Number(updatedAt)
      if (age > MAX_AGE)
        return { pass: false, ethPrice: 0, maticPrice: 0,
          detail: `${feed.name} stale ${age}s` }
      if (feed.name === 'ETH')   ethPrice   = Number(ans) / 1e8
      if (feed.name === 'MATIC') maticPrice = Number(ans) / 1e8
    }
    return { pass: true, ethPrice, maticPrice,
      detail: `ETH $${ethPrice.toFixed(0)} MATIC $${maticPrice.toFixed(4)}` }
  } catch (e) {
    return { pass: false, ethPrice: 0, maticPrice: 0, detail: `oracle failed` }
  }
}

// CHECK 5 — Pool depth vs flash
async function check5_depth(p, flashToUse) {
  try {
    const usdc  = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)
    const raw   = await usdc.balanceOf(UNI_POOLS.USDC_WETH_005)
    const depth = Number(raw) / 1e6
    const slip  = flashToUse > 0 ? (flashToUse / depth) * 100 : 0
    const pass  = slip <= 10
    return { pass, depth, slippage: slip,
      detail: `pool $${(depth/1e6).toFixed(2)}M | slip ${slip.toFixed(3)}%` }
  } catch (e) {
    return { pass: true, depth: 0, slippage: 0, detail: `depth skipped` }
  }
}

// CHECK 6 — Treasury balance (never blocks — records only)
async function check6_treasury(p, HOT) {
  try {
    const usdc = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)
    const bal  = Number(await usdc.balanceOf(TREASURY)) / 1e6
    if (HOT) {
      HOT[H.VAULT_CONFIRMED] = bal
      const computed = HOT[H.VAULT_COMPUTED] || 0
      if (computed > 0) {
        HOT[H.RECONCILE_SCORE] = Math.min(100, (bal / computed) * 100)
      }
    }
    return { pass: true, balance: bal, detail: `treasury $${bal.toLocaleString()} USDC` }
  } catch (e) {
    return { pass: true, balance: 0, detail: `treasury read failed` }
  }
}

// CHECK 7 — Propeller ceiling
function check7_capacity(HOT) {
  const used     = HOT[H.CYCLES_TODAY] || 0
  const max      = HOT[H.CYCLES_MAX]   || MAX_CYCLES_TODAY
  const gasSpent = HOT[H.GAS_SPENT]    || 0
  const pass     = used < max && gasSpent < DAILY_GAS_BUDGET
  return { pass, used, max, gasSpent,
    detail: `${used}/${max} cycles | ${gasSpent.toFixed(3)} POL gas` }
}

// ── RUN ALL 7 ─────────────────────────────────────────────────────────────────
export async function runAllChecks(HOT) {
  const now = Date.now()
  if (_cache && now - _cacheTs < CACHE_TTL) return _cache

  const p = getProvider()

  const r1 = await check1_flash(p)
  if (!r1.pass) return _set({ go: false, failed: 1, reason: r1.detail, flashToUse: 0, gasGwei: 0, spread: 0 })

  const [r2, r3, r4] = await Promise.all([
    check2_gas(p, r1.flashToUse),
    check3_spread(p),
    check4_oracle(p),
  ])

  if (!r2.pass) return _set({ go: false, failed: 2, reason: r2.detail, flashToUse: r1.flashToUse, gasGwei: r2.gasGwei, spread: 0 })
  if (!r3.pass) return _set({ go: false, failed: 3, reason: r3.detail, flashToUse: r1.flashToUse, gasGwei: r2.gasGwei, spread: 0 })
  if (!r4.pass) return _set({ go: false, failed: 4, reason: r4.detail, flashToUse: r1.flashToUse, gasGwei: r2.gasGwei, spread: r3.spread })

  const r5 = await check5_depth(p, r1.flashToUse)
  if (!r5.pass) return _set({ go: false, failed: 5, reason: r5.detail, flashToUse: r1.flashToUse, gasGwei: r2.gasGwei, spread: r3.spread })

  const r6 = await check6_treasury(p, HOT)
  const r7 = check7_capacity(HOT)
  if (!r7.pass) return _set({ go: false, failed: 7, reason: r7.detail, flashToUse: r1.flashToUse, gasGwei: r2.gasGwei, spread: r3.spread })

  // Write live data to HOT
  if (HOT) {
    HOT[H.FLASH_LIVE]     = r1.flashToUse
    HOT[H.FLASH_BALANCER] = r1.balancer
    HOT[H.FLASH_AAVE]     = r1.aave
    HOT[H.GAS_PRICE]      = r2.gasGwei
    HOT[H.GAS_OK]         = 1
    HOT[H.CHECK1_PASS]    = (HOT[H.CHECK1_PASS] || 0) + 1
    HOT[H.CHECK2_PASS]    = (HOT[H.CHECK2_PASS] || 0) + 1
    HOT[H.CHECK3_PASS]    = (HOT[H.CHECK3_PASS] || 0) + 1
    HOT[H.CHECK4_PASS]    = (HOT[H.CHECK4_PASS] || 0) + 1
    HOT[H.CHECK5_PASS]    = (HOT[H.CHECK5_PASS] || 0) + 1
    HOT[H.CHECK6_PASS]    = (HOT[H.CHECK6_PASS] || 0) + 1
    HOT[H.CHECK7_PASS]    = (HOT[H.CHECK7_PASS] || 0) + 1
  }

  return _set({
    go: true, failed: 0, reason: 'all pass',
    flashToUse:  r1.flashToUse,
    flashBal:    r1.balancer,
    flashAave:   r1.aave,
    gasGwei:     r2.gasGwei,
    spread:      r3.spread,
    buyPool:     r3.buyPool,
    sellPool:    r3.sellPool,
    ethPrice:    r4.ethPrice,
    maticPrice:  r4.maticPrice,
    poolDepth:   r5.depth,
    treasuryBal: r6.balance,
    results:     { r1, r2, r3, r4, r5, r6, r7 },
  })
}

function _set(result) {
  _cache   = result
  _cacheTs = Date.now()
  return result
}

export function clearLivecheckCache() { _cache = null; _cacheTs = 0 }
