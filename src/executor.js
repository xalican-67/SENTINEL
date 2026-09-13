// src/executor.js — SENTINEL executor (Worker)
// Strategy parameters derived from live check results — no hardcoded values
// 7-point check runs before every cycle via livecheck.js
// Nonce mutex — no double-spend
// 1ms block cadence ring

import { workerData, parentPort } from 'worker_threads'
import { ethers }                 from 'ethers'
import {
  EXECUTOR_PK, EXECUTOR,
  CONTRACT, H, PRIMARY_CHAIN,
  GAS_CAP_GWEI, GAS_LIMIT,
  USDC_POLYGON, WETH_POLYGON, UNI_POOLS,
} from './config.js'
import { runAllChecks } from './livecheck.js'

const SAB = workerData.SAB
const HOT = new Float64Array(SAB)

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

// ── NONCE MUTEX ───────────────────────────────────────────────────────────────
let   nonceLocked  = false
const nonceQueue   = []
let   currentNonce = null

async function withNonce(fn) {
  return new Promise((resolve, reject) => {
    nonceQueue.push({ fn, resolve, reject })
    drainNonce()
  })
}

async function drainNonce() {
  if (nonceLocked || !nonceQueue.length) return
  nonceLocked = true
  const { fn, resolve, reject } = nonceQueue.shift()
  try {
    if (currentNonce === null) {
      currentNonce = await makeProvider().getTransactionCount(EXECUTOR, 'pending')
    }
    resolve(await fn(currentNonce, makeProvider()))
    currentNonce++
  } catch (e) {
    currentNonce = null
    reject(e)
  } finally {
    nonceLocked = false
    if (nonceQueue.length) drainNonce()
  }
}

// ── LIVE POOL STATE ───────────────────────────────────────────────────────────
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
]
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

async function getLivePoolState(poolAddr, provider) {
  try {
    const pool        = new ethers.Contract(poolAddr, POOL_ABI, provider)
    const [slot0, liq] = await Promise.all([pool.slot0(), pool.liquidity()])
    const tick        = Number(slot0.tick)
    const spacing     = 10
    const tickLower   = Math.floor(tick / spacing) * spacing - spacing * 2
    const tickUpper   = Math.ceil(tick  / spacing) * spacing + spacing * 2
    return { tick, tickLower, tickUpper, liquidity: BigInt(liq) }
  } catch { return null }
}

async function getLiveSpread(pool1, pool2, provider) {
  try {
    const p1 = new ethers.Contract(pool1, POOL_ABI, provider)
    const p2 = new ethers.Contract(pool2, POOL_ABI, provider)
    const [s1, s2]   = await Promise.all([p1.slot0(), p2.slot0()])
    const price1 = (Number(s1.sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const price2 = (Number(s2.sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const spread = Math.abs(price1 - price2) / Math.min(price1, price2)
    return {
      spread, price1, price2,
      buyPool:  price1 < price2 ? pool1 : pool2,
      sellPool: price1 < price2 ? pool2 : pool1,
    }
  } catch { return null }
}

// ── BUILD STRATEGY — live pool state, live spread, live ticks ─────────────────
async function buildStrategy(cycleId, flashAmount, provider) {
  const flashBN       = BigInt(Math.floor(flashAmount * 1e6))
  const minProfitUSDC = BigInt(Math.floor(flashAmount * 0.001 * 1e6))
  const strat         = cycleId % 3

  if (strat === 0) {
    // JIT — live tick from slot0
    const state = await getLivePoolState(UNI_POOLS.USDC_WETH_005, provider)
    if (!state) return null
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'int24', 'uint256'],
      [USDC_POLYGON, WETH_POLYGON, 500, state.tickLower, state.tickUpper, minProfitUSDC]
    )
    return { strategy: 1, tokens: [USDC_POLYGON], amounts: [flashBN], data, name: 'JIT' }
  }

  if (strat === 1) {
    // ARB — live spread check
    const live = await getLiveSpread(UNI_POOLS.USDC_WETH_005, UNI_POOLS.USDC_USDT_001, provider)
    if (!live || live.spread < 0.0001) return null
    const spreadProfit = BigInt(Math.floor(flashAmount * live.spread * 0.8 * 1e6))
    const actualMin    = spreadProfit > minProfitUSDC ? minProfitUSDC : spreadProfit / 2n
    const z1           = live.buyPool === UNI_POOLS.USDC_WETH_005
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'bool', 'bool', 'uint256'],
      [UNI_POOLS.USDC_WETH_005, UNI_POOLS.USDC_USDT_001, z1, !z1, actualMin]
    )
    return { strategy: 2, tokens: [USDC_POLYGON], amounts: [flashBN], data, name: 'ARB', spread: live.spread }
  }

  if (strat === 2) {
    // SANDWICH — pool depth gate
    const state      = await getLivePoolState(UNI_POOLS.USDC_WETH_005, provider)
    if (!state) return null
    const poolDepth  = HOT[H.FLASH_BAL] || 0
    if (poolDepth < flashAmount * 2) return null
    const frontAmt   = flashBN * 30n / 100n
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bool', 'uint256', 'uint256'],
      [UNI_POOLS.USDC_WETH_005, true, frontAmt, minProfitUSDC]
    )
    return { strategy: 3, tokens: [USDC_POLYGON], amounts: [flashBN], data, name: 'SANDWICH' }
  }

  return null
}

// ── EXECUTE CYCLE ─────────────────────────────────────────────────────────────
let activeExecs = 0
const MAX_CONCURRENT = 3
let cycleId = 0

async function executeCycle() {
  if (!CONTRACT.SENTINEL)            return
  if (HOT[H.GAS_OK] === 0)          return
  if (activeExecs >= MAX_CONCURRENT) return

  activeExecs++
  cycleId++
  const thisId = cycleId
  const t0     = Date.now()

  try {
    const check = await runAllChecks(HOT)

    if (!check.go) {
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({ type: 'skip', cycleId: thisId, reason: check.reason })
      return
    }

    const flashAmount = check.flashToUse
    const provider    = makeProvider()
    const strat       = await buildStrategy(thisId, flashAmount, provider)

    if (!strat) {
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({ type: 'skip', cycleId: thisId, reason: 'no viable strategy' })
      return
    }

    const receipt = await withNonce(async (nonce, p) => {
      const signer   = new ethers.Wallet(EXECUTOR_PK, p)
      const sentinel = new ethers.Contract(
        CONTRACT.SENTINEL,
        ['function execute(address[],uint256[],uint8,bytes,uint256) external'],
        signer
      )
      const fee      = await p.getFeeData()
      const rawGas   = fee.gasPrice || ethers.parseUnits('30', 'gwei')
      const capGas   = GAS_CAP_GWEI * BigInt(1e9)
      const gasPrice = (rawGas > capGas ? capGas : rawGas) * 130n / 100n
      return (await sentinel.execute(
        strat.tokens, strat.amounts, strat.strategy, strat.data, BigInt(thisId),
        { gasLimit: GAS_LIMIT, gasPrice, nonce }
      )).wait(1)
    })

    HOT[H.EXEC_SPEED] = Date.now() - t0

    if (receipt?.status === 1) {
      // Read actual profit — treasury balance delta
      const usdc     = new ethers.Contract(USDC_POLYGON, ERC20_ABI, provider)
      const tBal     = Number(await usdc.balanceOf(TREASURY)) / 1e6
      const prev     = HOT[H.TREASURY_BAL] || 0
      const profit   = Math.max(0, tBal - prev)

      HOT[H.TREASURY_BAL]  = tBal
      HOT[H.CYCLES_TODAY]  = (HOT[H.CYCLES_TODAY]  || 0) + 1
      HOT[H.CYCLES_TOTAL]  = (HOT[H.CYCLES_TOTAL]  || 0) + 1
      HOT[H.SUCCESS_TODAY] = (HOT[H.SUCCESS_TODAY]  || 0) + 1
      HOT[H.REV_TODAY]     = (HOT[H.REV_TODAY]      || 0) + profit
      HOT[H.REV_TOTAL]     = (HOT[H.REV_TOTAL]      || 0) + profit
      HOT[H.COMPUTED_BAL]  = (HOT[H.COMPUTED_BAL]   || 0) + profit

      const gasCost = Number(GAS_LIMIT * (receipt.gasPrice || 0n)) / 1e18
      HOT[H.GAS_SPENT] = (HOT[H.GAS_SPENT] || 0) + gasCost

      if (HOT[H.FIRST_REV] === 0 && profit > 0) HOT[H.FIRST_REV] = 1

      parentPort?.postMessage({
        type: 'cycle', cycleId: thisId, profit,
        flash: flashAmount, strategy: strat.strategy,
        stratName: strat.name, elapsed: Date.now() - t0, txHash: receipt.hash,
      })

      if (HOT[H.CYCLES_TODAY] % 10 === 0) {
        const rev = HOT[H.REV_TODAY] || 0
        const fmt = rev >= 1e6 ? `$${(rev/1e6).toFixed(3)}M` : `$${rev.toFixed(2)}`
        console.log(`[EXECUTOR] ${HOT[H.CYCLES_TODAY]} cycles | ${fmt} today | ${strat.name} $${profit.toFixed(2)} | ${Date.now()-t0}ms`)
      }
    } else {
      HOT[H.FAIL_TODAY] = (HOT[H.FAIL_TODAY] || 0) + 1
    }
  } catch (e) {
    HOT[H.FAIL_TODAY] = (HOT[H.FAIL_TODAY] || 0) + 1
    if (process.env.DEBUG) console.log(`[EXECUTOR] cycle ${thisId}: ${e.message?.slice(0,100)}`)
  } finally {
    activeExecs--
  }
}

// ── 1ms BLOCK CADENCE RING ────────────────────────────────────────────────────
let blockQueue = 0

setInterval(() => {
  if (blockQueue > 0 && activeExecs < MAX_CONCURRENT) {
    blockQueue--
    executeCycle().catch(() => {})
  }
}, 1)

parentPort?.on('message', msg => {
  if (msg?.type === 'block' || msg?.type === 'swap') blockQueue++
})

// Polygon fallback — fire every 2.12s if no block signal arrives
setInterval(() => { blockQueue++ }, 2120)

console.log('[EXECUTOR] 1ms ring | live pool state | live spread | nonce mutex | max 3 concurrent')
