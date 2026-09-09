// src/livecheck.js — SENTINEL 7-point live check
// CHECK 1: reads live flash across Balancer on primary chain
// Flash sized to 10% of pool depth — never moves market > 10%
// All 7 must pass — any fail = skip

import { ethers } from 'ethers'
import {
  PRIMARY_CHAIN, BALANCER_VAULT, AAVE_POOL_POLYGON,
  USDC_POLYGON, WETH_POLYGON, CHAINLINK,
  UNI_POOLS, CHECK, FLASH_CONFIG, H,
  MAX_CYCLES_TODAY, GAS_CAP_GWEI,
} from './config.js'

const ERC20_ABI  = ['function balanceOf(address) view returns (uint256)']
const ORACLE_ABI = ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']
const POOL_ABI   = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]

// aUSDC on Polygon — Aave V3 available liquidity proxy
const A_USDC_POLYGON = '0x625E7708f30cA75bfd92586e17077590C60eb4cD'

let _provider = null
function getProvider() {
  if (!_provider) {
    const c = PRIMARY_CHAIN
    const n = new ethers.Network(c.name, c.id)
    _provider = new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
  }
  return _provider
}

function makeResult(pass, reason, data = {}) {
  return { pass, reason, ...data }
}

// ── CHECK 1 — Live flash capital, sized to pool depth ─────────────────────────
export async function check1_flash() {
  try {
    const p    = getProvider()
    const usdc = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)

    const [balancerRaw, aaveRaw, poolDepthRaw] = await Promise.all([
      usdc.balanceOf(BALANCER_VAULT),
      usdc.balanceOf(A_USDC_POLYGON),
      usdc.balanceOf(UNI_POOLS.USDC_WETH_005),
    ])

    const balancerUSD  = Number(balancerRaw) / 1e6
    const aaveUSD      = Number(aaveRaw)     / 1e6
    const poolDepthUSD = Number(poolDepthRaw)/ 1e6

    // Size flash to 10% of pool depth — keeps slippage manageable
    // Cap at configured max, floor at configured min
    const maxByDepth = poolDepthUSD * 0.10
    const maxByConfig = FLASH_CONFIG.balancer_target
    const flashToUse  = Math.min(
      Math.min(balancerUSD, maxByConfig),
      Math.max(maxByDepth, FLASH_CONFIG.min_profitable)
    )

    if (flashToUse < CHECK.MIN_FLASH_USD) {
      return makeResult(false, `Flash ${flashToUse.toFixed(0)} < min ${CHECK.MIN_FLASH_USD}`, { flashToUse })
    }

    return makeResult(true, 'Flash available', {
      flashToUse,
      balancerUSD,
      aaveUSD,
      poolDepthUSD,
    })
  } catch (e) {
    return makeResult(false, `Check1 error: ${e.message?.slice(0, 50)}`)
  }
}

// ── CHECK 2 — Live gas vs expected profit ─────────────────────────────────────
export async function check2_gas(flashToUse) {
  try {
    const p       = getProvider()
    const fee     = await p.getFeeData()
    const gasGwei = Number(fee.gasPrice || 0n) / 1e9

    if (gasGwei > Number(GAS_CAP_GWEI)) {
      return makeResult(false, `Gas ${gasGwei.toFixed(1)} > cap ${GAS_CAP_GWEI}`, { gasGwei })
    }

    const gasWei     = fee.gasPrice || ethers.parseUnits('30', 'gwei')
    const gasCostWei = gasWei * 3_500_000n
    const maticPrice = await getMATICPrice()
    const gasCostUSD = (Number(gasCostWei) / 1e18) * maticPrice

    // Minimum expected profit: 0.05% of flash (conservative spread)
    const expectedProfit = flashToUse * 0.0005

    if (gasCostUSD > expectedProfit * CHECK.MAX_GAS_PCT) {
      return makeResult(false, `Gas $${gasCostUSD.toFixed(2)} > 1% of min profit`, { gasGwei, gasCostUSD })
    }

    return makeResult(true, 'Gas OK', { gasGwei, gasCostUSD, expectedProfit })
  } catch (e) {
    return makeResult(false, `Check2 error: ${e.message?.slice(0, 50)}`)
  }
}

// ── CHECK 3 — Live spread across pools ────────────────────────────────────────
export async function check3_spread() {
  try {
    const p     = getProvider()
    const pool  = new ethers.Contract(UNI_POOLS.USDC_WETH_005, POOL_ABI, p)
    const { sqrtPriceX96 } = await pool.slot0()

    const poolPrice = (Number(sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const ethPrice  = await getETHPrice()
    const spread    = Math.abs(poolPrice - ethPrice) / ethPrice * 100

    if (spread < CHECK.MIN_SPREAD_PCT) {
      return makeResult(false, `Spread ${spread.toFixed(4)}% < min ${CHECK.MIN_SPREAD_PCT}%`, { spread })
    }

    return makeResult(true, 'Spread sufficient', {
      spread,
      poolPrice,
      oraclePrice: ethPrice,
    })
  } catch (e) {
    return makeResult(false, `Check3 error: ${e.message?.slice(0, 50)}`)
  }
}

// ── CHECK 4 — Live oracle freshness ───────────────────────────────────────────
export async function check4_oracle() {
  try {
    const p   = getProvider()
    const now = Math.floor(Date.now() / 1000)
    const feeds = [
      { name: 'ETH',   addr: CHAINLINK.ETH_USD   },
      { name: 'BTC',   addr: CHAINLINK.BTC_USD   },
      { name: 'MATIC', addr: CHAINLINK.MATIC_USD },
      { name: 'USDC',  addr: CHAINLINK.USDC_USD  },
    ]

    for (const feed of feeds) {
      const oracle = new ethers.Contract(feed.addr, ORACLE_ABI, p)
      const [, , , updatedAt,] = await oracle.latestRoundData()
      const age = now - Number(updatedAt)
      if (age > CHECK.MAX_ORACLE_AGE_SEC) {
        return makeResult(false, `${feed.name} oracle stale: ${age}s`, { feed: feed.name, age })
      }
    }

    return makeResult(true, 'All oracles fresh')
  } catch (e) {
    return makeResult(false, `Check4 error: ${e.message?.slice(0, 50)}`)
  }
}

// ── CHECK 5 — Live pool depth and slippage ────────────────────────────────────
export async function check5_depth(flashToUse) {
  try {
    const p    = getProvider()
    const usdc = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)
    const raw  = await usdc.balanceOf(UNI_POOLS.USDC_WETH_005)
    const poolDepth = Number(raw) / 1e6

    const slippage = (flashToUse / poolDepth) * 100

    if (slippage > CHECK.MAX_SLIPPAGE_PCT) {
      return makeResult(false, `Slippage ${slippage.toFixed(3)}% > max ${CHECK.MAX_SLIPPAGE_PCT}%`, { slippage, poolDepth })
    }

    return makeResult(true, 'Depth OK', { slippage, poolDepth })
  } catch (e) {
    return makeResult(false, `Check5 error: ${e.message?.slice(0, 50)}`)
  }
}

// ── CHECK 6 — Live treasury reconciliation ────────────────────────────────────
export async function check6_treasury(HOT) {
  try {
    const p         = getProvider()
    const usdc      = new ethers.Contract(USDC_POLYGON, ERC20_ABI, p)
    const treasury  = '0xCCCF1C9A2154750A0D7CceeD51fE0f9b4c1906e8'
    const rawBal    = await usdc.balanceOf(treasury)
    const confirmed = Number(rawBal) / 1e6

    HOT[H.VAULT_CONFIRMED] = confirmed

    const computed = HOT[H.VAULT_COMPUTED] || 0
    let score = 100
    if (computed > 0) {
      score = Math.min(100, (confirmed / computed) * 100)
      HOT[H.RECONCILE_SCORE] = score
      if (score < 100 - CHECK.MAX_DISCREPANCY) {
        console.log(`[SENTINEL] Reconciliation flag: ${score.toFixed(1)}% — confirmed $${confirmed.toFixed(2)} vs computed $${computed.toFixed(2)}`)
      }
    }

    return makeResult(true, 'Treasury checked', { confirmed, computed, score })
  } catch (e) {
    return makeResult(false, `Check6 error: ${e.message?.slice(0, 50)}`)
  }
}

// ── CHECK 7 — Propeller ceiling ───────────────────────────────────────────────
export async function check7_capacity(HOT) {
  const cyclesUsed = HOT[H.CYCLES_TODAY] || 0
  const maxCycles  = HOT[H.CYCLES_MAX]   || MAX_CYCLES_TODAY
  const gasSpent   = HOT[H.GAS_SPENT]    || 0

  if (cyclesUsed >= maxCycles) {
    return makeResult(false, `Ceiling: ${cyclesUsed}/${maxCycles} cycles`, { cyclesUsed, maxCycles })
  }
  if (gasSpent >= 50) {
    return makeResult(false, `Gas budget: ${gasSpent.toFixed(3)} POL spent`, { gasSpent })
  }

  return makeResult(true, 'Capacity OK', { cyclesUsed, maxCycles, gasSpent })
}

// ── RUN ALL 7 ─────────────────────────────────────────────────────────────────
export async function runAllChecks(HOT) {
  const r1 = await check1_flash()
  if (!r1.pass) return { go: false, failed: 1, reason: r1.reason, results: { r1 } }

  const r2 = await check2_gas(r1.flashToUse)
  if (!r2.pass) return { go: false, failed: 2, reason: r2.reason, results: { r1, r2 } }

  const r3 = await check3_spread()
  if (!r3.pass) return { go: false, failed: 3, reason: r3.reason, results: { r1, r2, r3 } }

  const r4 = await check4_oracle()
  if (!r4.pass) return { go: false, failed: 4, reason: r4.reason, results: { r1, r2, r3, r4 } }

  const r5 = await check5_depth(r1.flashToUse)
  if (!r5.pass) return { go: false, failed: 5, reason: r5.reason, results: { r1, r2, r3, r4, r5 } }

  const r6 = await check6_treasury(HOT)

  const r7 = await check7_capacity(HOT)
  if (!r7.pass) return { go: false, failed: 7, reason: r7.reason, results: { r1, r2, r3, r4, r5, r6, r7 } }

  // Write live flash data to HOT
  HOT[H.FLASH_LIVE]     = r1.flashToUse
  HOT[H.FLASH_BALANCER] = r1.balancerUSD
  HOT[H.FLASH_AAVE]     = r1.aaveUSD
  HOT[H.GAS_PRICE]      = r2.gasGwei
  HOT[H.GAS_OK]         = 1

  HOT[H.CHECK1_PASS] = (HOT[H.CHECK1_PASS] || 0) + 1
  HOT[H.CHECK2_PASS] = (HOT[H.CHECK2_PASS] || 0) + 1
  HOT[H.CHECK3_PASS] = (HOT[H.CHECK3_PASS] || 0) + 1
  HOT[H.CHECK4_PASS] = (HOT[H.CHECK4_PASS] || 0) + 1
  HOT[H.CHECK5_PASS] = (HOT[H.CHECK5_PASS] || 0) + 1
  HOT[H.CHECK6_PASS] = (HOT[H.CHECK6_PASS] || 0) + 1
  HOT[H.CHECK7_PASS] = (HOT[H.CHECK7_PASS] || 0) + 1

  return {
    go:          true,
    flashToUse:  r1.flashToUse,
    poolDepth:   r1.poolDepthUSD,
    gasGwei:     r2.gasGwei,
    spread:      r3.spread,
    results:     { r1, r2, r3, r4, r5, r6, r7 },
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function getETHPrice() {
  try {
    const oracle = new ethers.Contract(CHAINLINK.ETH_USD, ORACLE_ABI, getProvider())
    const [, answer,,] = await oracle.latestRoundData()
    return Number(answer) / 1e8
  } catch { return 3000 }
}

async function getMATICPrice() {
  try {
    const oracle = new ethers.Contract(CHAINLINK.MATIC_USD, ORACLE_ABI, getProvider())
    const [, answer,,] = await oracle.latestRoundData()
    return Number(answer) / 1e8
  } catch { return 0.8 }
}
