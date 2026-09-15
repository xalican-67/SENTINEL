// src/executor.js — SENTINEL executor (Worker thread)
// All imports aligned exactly to Sentinel config.js exports
// Live pool state, live spread, nonce mutex
// 1ms block cadence ring
// $100 gas reserve check

import { workerData, parentPort } from 'worker_threads'
import { ethers }                 from 'ethers'
import {
  EXECUTOR_PK,
  EXECUTOR,
  TREASURY,
  CONTRACT,
  H,
  PRIMARY_CHAIN,
  USDC_POLYGON,
  WETH_POLYGON,
  UNI_POOLS,
} from './config.js'
import { runAllChecks, clearLivecheckCache } from './livecheck.js'

const SAB = workerData.SAB
const HOT = new Float64Array(SAB)

// Gas constants — defined here, not imported (Sentinel config uses numbers not BigInt)
const GAS_CAP_GWEI   = 1000        // number
const GAS_CAP_WEI    = 1000n * BigInt(1e9)
const GAS_LIMIT      = 3_500_000n
const GAS_RESERVE_USD = 100

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

// ── GAS RESERVE CHECK — $100 minimum ─────────────────────────────────────────
let maticPriceCache  = 0.8
let lastReserveCheck = 0

async function checkGasReserve() {
  const now = Date.now()
  if (now - lastReserveCheck < 60_000) return HOT[H.RESERVE_OK] === 1
  lastReserveCheck = now
  try {
    const bal    = await makeProvider().getBalance(EXECUTOR)
    const pol    = parseFloat(ethers.formatEther(bal))
    const usdVal = pol * maticPriceCache
    HOT[H.GAS_RESERVE] = usdVal
    if (usdVal < GAS_RESERVE_USD) {
      if (HOT[H.RESERVE_OK] !== 0) {
        console.log(`[EXECUTOR] Gas reserve LOW — $${usdVal.toFixed(2)} < $${GAS_RESERVE_USD}`)
        console.log(`[EXECUTOR] Top up ${EXECUTOR} with POL to resume`)
      }
      HOT[H.RESERVE_OK] = 0
      return false
    }
    if (HOT[H.RESERVE_OK] === 0) {
      console.log(`[EXECUTOR] Gas reserve restored — $${usdVal.toFixed(2)} — resuming`)
    }
    HOT[H.RESERVE_OK] = 1
    return true
  } catch {
    return HOT[H.RESERVE_OK] === 1
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
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider)
    const [slot0, liq] = await Promise.all([pool.slot0(), pool.liquidity()])
    const tick    = Number(slot0.tick)
    const spacing = 10
    return {
      tick,
      tickLower: Math.floor(tick / spacing) * spacing - spacing * 2,
      tickUpper: Math.ceil(tick  / spacing) * spacing + spacing * 2,
      liquidity: BigInt(liq),
    }
  } catch { return null }
}

async function getLiveSpread(pool1, pool2, provider) {
  try {
    const p1 = new ethers.Contract(pool1, POOL_ABI, provider)
    const p2 = new ethers.Contract(pool2, POOL_ABI, provider)
    const [s1, s2] = await Promise.all([p1.slot0(), p2.slot0()])
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
    const state     = await getLivePoolState(UNI_POOLS.USDC_WETH_005, provider)
    if (!state) return null
    const poolDepth = HOT[H.FLASH_BALANCER] || 0
    if (poolDepth < flashAmount * 2) return null
    const frontAmt  = flashBN * 30n / 100n
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
  if (HOT[H.RESERVE_OK] === 0)      return
  if (activeExecs >= MAX_CONCURRENT) return

  const cycles = HOT[H.CYCLES_TODAY] || 0
  const maxCyc = HOT[H.CYCLES_MAX]   || MAX_CYCLES_TODAY || 1_526_682
  if (cycles >= maxCyc)              return

  activeExecs++
  cycleId++
  const thisId = cycleId
  const t0     = Date.now()

  try {
    // Gas reserve check — cached 60s
    const reserveOK = await checkGasReserve()
    if (!reserveOK) {
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({ type: 'skip', cycleId: thisId, reason: 'gas reserve < $100' })
      return
    }

    // 7-point live check
    const check = await runAllChecks(HOT)

    HOT[H.FLASH_LIVE]     = check.flashToUse  || 0
    HOT[H.FLASH_BALANCER] = check.flashBal    || 0
    HOT[H.FLASH_AAVE]     = check.flashAave   || 0
    HOT[H.GAS_PRICE]      = check.gasGwei     || 0
    maticPriceCache       = check.maticPrice  || 0.8

    if (!check.go) {
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({ type: 'skip', cycleId: thisId, reason: check.reason, failed: check.failed })
      return
    }

    const flashAmount = check.flashToUse
    const provider    = makeProvider()
    const strat       = await buildStrategy(thisId, flashAmount, provider)

    if (!strat) {
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({ type: 'skip', cycleId: thisId, reason: 'no viable strategy from live data' })
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
      const gasPrice = (rawGas > GAS_CAP_WEI ? GAS_CAP_WEI : rawGas) * 130n / 100n
      return (await sentinel.execute(
        strat.tokens, strat.amounts, strat.strategy, strat.data, BigInt(thisId),
        { gasLimit: GAS_LIMIT, gasPrice, nonce }
      )).wait(1)
    })

    HOT[H.EXEC_SPEED_MS] = Date.now() - t0

    if (receipt?.status === 1) {
      // Read actual profit from treasury balance delta
      const usdc   = new ethers.Contract(USDC_POLYGON, ERC20_ABI, makeProvider())
      const tBal   = Number(await usdc.balanceOf(TREASURY)) / 1e6
      const prev   = HOT[H.VAULT_CONFIRMED] || 0
      const profit = Math.max(0, tBal - prev)

      HOT[H.VAULT_CONFIRMED] = tBal
      HOT[H.CYCLES_TODAY]    = (HOT[H.CYCLES_TODAY]    || 0) + 1
      HOT[H.CYCLES_TOTAL]    = (HOT[H.CYCLES_TOTAL]    || 0) + 1
      HOT[H.SUCCESS_TODAY]   = (HOT[H.SUCCESS_TODAY]   || 0) + 1
      HOT[H.REV_TODAY]       = (HOT[H.REV_TODAY]       || 0) + profit
      HOT[H.REV_TOTAL]       = (HOT[H.REV_TOTAL]       || 0) + profit
      HOT[H.VAULT_COMPUTED]  = (HOT[H.VAULT_COMPUTED]  || 0) + profit

      const gasCost = Number(GAS_LIMIT * (receipt.gasPrice || 0n)) / 1e18
      HOT[H.GAS_SPENT] = (HOT[H.GAS_SPENT] || 0) + gasCost

      if (strat.strategy === 1) HOT[H.MEV_JIT]       = (HOT[H.MEV_JIT]       || 0) + 1
      else if (strat.strategy === 2) HOT[H.MEV_ARB]  = (HOT[H.MEV_ARB]       || 0) + 1
      else if (strat.strategy === 3) HOT[H.MEV_SANDWICH] = (HOT[H.MEV_SANDWICH] || 0) + 1

      if ((HOT[H.FIRST_REV] || 0) === 0 && profit > 0) HOT[H.FIRST_REV] = 1

      clearLivecheckCache()

      parentPort?.postMessage({
        type:      'cycle',
        cycleId:   thisId,
        profit,
        flash:     flashAmount,
        strategy:  strat.strategy,
        stratName: strat.name,
        elapsed:   Date.now() - t0,
        txHash:    receipt.hash,
      })

      if ((HOT[H.CYCLES_TODAY] || 0) % 10 === 0) {
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

// Polygon fallback — fire every 2.12s if no block signal
setInterval(() => { blockQueue++ }, 2120)

// Reserve check every 60s
setInterval(() => { checkGasReserve().catch(() => {}) }, 60_000)

console.log(`[EXECUTOR] 1ms ring | 7-point live check | gas reserve $${GAS_RESERVE_USD} | live strategy data | max ${MAX_CONCURRENT} concurrent`)
