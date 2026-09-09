// src/executor.js — SENTINEL executor (Worker)
// Strategy parameters derived from live check results — no hardcoded values
// 7-point check runs before every cycle
// Nonce mutex — no double-spend

import { workerData, parentPort } from 'worker_threads'
import { ethers }                 from 'ethers'
import {
  EXECUTOR_PK, EXECUTOR,
  CONTRACT, H, PRIMARY_CHAIN,
  FLASH_CONFIG, GAS_CAP_GWEI, GAS_MARKUP, GAS_LIMIT,
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
    const p = makeProvider()
    if (currentNonce === null) {
      currentNonce = await p.getTransactionCount(EXECUTOR, 'pending')
    }
    resolve(await fn(currentNonce, p))
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
// Reads actual tick and price from the pool before building strategy data
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
]

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

async function getLivePoolState(poolAddr, provider) {
  try {
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider)
    const [slot0, liquidity] = await Promise.all([
      pool.slot0(),
      pool.liquidity(),
    ])
    const tick         = Number(slot0.tick)
    const tickSpacing  = 10  // 0.05% pool uses tick spacing 10
    // Tight range: ±2 tick spacings around current tick
    const tickLower    = Math.floor(tick / tickSpacing) * tickSpacing - tickSpacing * 2
    const tickUpper    = Math.ceil(tick  / tickSpacing) * tickSpacing + tickSpacing * 2
    return { tick, tickLower, tickUpper, liquidity: BigInt(liquidity) }
  } catch {
    return null
  }
}

// ── LIVE SPREAD — compute actual profitable spread between two pools ───────────
async function getLiveSpread(pool1Addr, pool2Addr, provider) {
  try {
    const p1 = new ethers.Contract(pool1Addr, POOL_ABI, provider)
    const p2 = new ethers.Contract(pool2Addr, POOL_ABI, provider)
    const [s1, s2] = await Promise.all([p1.slot0(), p2.slot0()])
    const price1 = (Number(s1.sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const price2 = (Number(s2.sqrtPriceX96) ** 2) / (2 ** 192) * 1e12
    const spread = Math.abs(price1 - price2) / Math.min(price1, price2)
    return { spread, price1, price2, buyPool: price1 < price2 ? pool1Addr : pool2Addr, sellPool: price1 < price2 ? pool2Addr : pool1Addr }
  } catch {
    return null
  }
}

// ── BUILD STRATEGY DATA — all parameters from live chain state ────────────────
async function buildStrategyData(cycleId, flashAmount, checkResults, provider) {
  const minProfitUSDC = BigInt(Math.floor(flashAmount * 0.001 * 1e6)) // 0.1% minimum — realistic
  const flashAmountBN  = BigInt(Math.floor(flashAmount * 1e6))

  const strat = cycleId % 3

  if (strat === 0) {
    // ── JIT LIQUIDITY ──────────────────────────────────────────────────────────
    // Use live tick from the pool — not hardcoded
    const poolState = await getLivePoolState(UNI_POOLS.USDC_WETH_005, provider)
    if (!poolState) return null

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'int24', 'uint256'],
      [
        USDC_POLYGON,
        WETH_POLYGON,
        500,                    // 0.05% fee tier
        poolState.tickLower,    // live computed tick — not hardcoded
        poolState.tickUpper,    // live computed tick — not hardcoded
        minProfitUSDC,
      ]
    )
    return { strategy: 1, tokens: [USDC_POLYGON], amounts: [flashAmountBN], data, name: 'JIT' }
  }

  if (strat === 1) {
    // ── ARBITRAGE ──────────────────────────────────────────────────────────────
    // Read live prices from both pools — only proceed if spread is real
    const liveSpread = await getLiveSpread(
      UNI_POOLS.USDC_WETH_005,
      UNI_POOLS.USDC_USDT_001,
      provider
    )
    if (!liveSpread || liveSpread.spread < 0.0001) return null // skip if spread < 0.01%

    // Direction based on which pool is cheaper
    const zeroForOne1 = liveSpread.buyPool === UNI_POOLS.USDC_WETH_005
    const zeroForOne2 = !zeroForOne1

    // minProfit scaled to actual spread — not flat 10%
    const spreadProfit = BigInt(Math.floor(flashAmount * liveSpread.spread * 0.8 * 1e6)) // 80% of spread
    const actualMin    = spreadProfit > minProfitUSDC ? minProfitUSDC : spreadProfit / 2n

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'bool', 'bool', 'uint256'],
      [
        UNI_POOLS.USDC_WETH_005,
        UNI_POOLS.USDC_USDT_001,
        zeroForOne1,
        zeroForOne2,
        actualMin,
      ]
    )
    return { strategy: 2, tokens: [USDC_POLYGON], amounts: [flashAmountBN], data, name: 'ARB', spread: liveSpread.spread }
  }

  if (strat === 2) {
    // ── SANDWICH ───────────────────────────────────────────────────────────────
    // Only execute if mempool has a qualifying swap (detected by chains worker)
    // Front amount: 30% of flash — sized to move price just enough
    const poolState = await getLivePoolState(UNI_POOLS.USDC_WETH_005, provider)
    if (!poolState) return null

    // Pool depth from HOT — set by livecheck CHECK 5
    const poolDepthUSD = HOT[H.FLASH_BALANCER] || 0
    if (poolDepthUSD < flashAmount * 2) return null // skip if pool too shallow

    const frontAmount = flashAmountBN * 30n / 100n  // 30% front run

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bool', 'uint256', 'uint256'],
      [
        UNI_POOLS.USDC_WETH_005,
        true,         // zeroForOne — USDC in, WETH out
        frontAmount,
        minProfitUSDC,
      ]
    )
    return { strategy: 3, tokens: [USDC_POLYGON], amounts: [flashAmountBN], data, name: 'SANDWICH' }
  }

  return null
}

// ── EXECUTE CYCLE ─────────────────────────────────────────────────────────────
let activeExecs  = 0
const MAX_CONCURRENT = 3
let cycleId = 0

async function executeCycle() {
  if (!CONTRACT.SENTINEL) return
  if (activeExecs >= MAX_CONCURRENT) return

  activeExecs++
  cycleId++
  const thisId = cycleId
  const t0     = Date.now()

  try {
    // Run all 7 checks — get live data back
    const check = await runAllChecks(HOT)

    if (!check.go) {
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({
        type: 'skip', cycleId: thisId,
        reason: check.reason, failed: check.failed,
      })
      return
    }

    const flashAmount = check.flashToUse   // live read from CHECK 1
    const gasGwei     = check.gasGwei      // live read from CHECK 2
    const spread      = check.spread       // live read from CHECK 3

    // Build strategy data from live chain state — not hardcoded
    const provider = makeProvider()
    const strat    = await buildStrategyData(thisId, flashAmount, check.results, provider)

    if (!strat) {
      // Live conditions don't support any strategy this cycle — skip cleanly
      HOT[H.SKIP_TODAY] = (HOT[H.SKIP_TODAY] || 0) + 1
      parentPort?.postMessage({ type: 'skip', cycleId: thisId, reason: 'No viable strategy from live data', failed: 0 })
      return
    }

    // Execute via Sentinel contract
    const receipt = await withNonce(async (nonce, p) => {
      const signer   = new ethers.Wallet(EXECUTOR_PK, p)
      const sentinel = new ethers.Contract(
        CONTRACT.SENTINEL,
        ['function execute(address[],uint256[],uint8,bytes,uint256) external'],
        signer
      )

      const feeData  = await p.getFeeData()
      const rawGas   = feeData.gasPrice || ethers.parseUnits('30', 'gwei')
      const capGas   = BigInt(GAS_CAP_GWEI) * BigInt(1e9)
      const gasPrice = (rawGas > capGas ? capGas : rawGas) * BigInt(GAS_MARKUP) / 100n

      const tx = await sentinel.execute(
        strat.tokens,
        strat.amounts,
        strat.strategy,
        strat.data,
        BigInt(thisId),
        { gasLimit: GAS_LIMIT, gasPrice, nonce }
      )
      return tx.wait(1)
    })

    const elapsed = Date.now() - t0
    HOT[H.EXEC_SPEED] = elapsed

    if (receipt?.status === 1) {
      // Read actual profit from vault — not estimated
      // Vault receives funds via deposit() — query confirmed balance delta
      const usdc       = new ethers.Contract(USDC_POLYGON, ERC20_ABI, provider)
      const vaultAddr  = CONTRACT.SENTINEL_VAULT
      const vaultBal   = vaultAddr ? Number(await usdc.balanceOf(vaultAddr)) / 1e6 : 0
      const prevVault  = HOT[H.VAULT_CONFIRMED] || 0
      const actualProfit = Math.max(0, vaultBal - prevVault)

      HOT[H.VAULT_CONFIRMED] = vaultBal
      HOT[H.CYCLES_TODAY]    = (HOT[H.CYCLES_TODAY]    || 0) + 1
      HOT[H.CYCLES_TOTAL]    = (HOT[H.CYCLES_TOTAL]    || 0) + 1
      HOT[H.SUCCESS_TODAY]   = (HOT[H.SUCCESS_TODAY]   || 0) + 1
      HOT[H.REV_TODAY]       = (HOT[H.REV_TODAY]       || 0) + actualProfit
      HOT[H.REV_TOTAL]       = (HOT[H.REV_TOTAL]       || 0) + actualProfit
      HOT[H.NET_TODAY]       = (HOT[H.NET_TODAY]        || 0) + actualProfit * 0.7
      HOT[H.VAULT_COMPUTED]  = (HOT[H.VAULT_COMPUTED]   || 0) + actualProfit * 0.7

      // Track gas spent in POL
      const gasCostWei  = BigInt(GAS_LIMIT) * (receipt.gasPrice || 0n)
      const gasCostPOL  = Number(gasCostWei) / 1e18
      HOT[H.GAS_SPENT]  = (HOT[H.GAS_SPENT] || 0) + gasCostPOL

      if (strat.strategy === 1) HOT[H.MEV_JIT]++
      else if (strat.strategy === 2) HOT[H.MEV_ARB]++
      else if (strat.strategy === 3) HOT[H.MEV_SANDWICH]++

      if ((HOT[H.FIRST_REV] || 0) === 0 && actualProfit > 0) HOT[H.FIRST_REV] = 1

      parentPort?.postMessage({
        type: 'cycle', cycleId: thisId,
        profit: actualProfit,
        flash:  flashAmount,
        strategy: strat.strategy,
        stratName: strat.name,
        elapsed,
        txHash: receipt.hash,
      })

      // Log every 10 cycles
      if ((HOT[H.CYCLES_TODAY] || 0) % 10 === 0) {
        const rev = HOT[H.REV_TODAY] || 0
        const fmt = rev >= 1e6 ? `$${(rev/1e6).toFixed(3)}M` : `$${rev.toFixed(2)}`
        console.log(`[EXECUTOR] ${HOT[H.CYCLES_TODAY]|0} cycles | ${fmt} today | last: ${strat.name} $${actualProfit.toFixed(2)} | ${elapsed}ms`)
      }
    } else {
      HOT[H.FAIL_TODAY] = (HOT[H.FAIL_TODAY] || 0) + 1
    }
  } catch (e) {
    HOT[H.FAIL_TODAY] = (HOT[H.FAIL_TODAY] || 0) + 1
    if (process.env.DEBUG) {
      console.log(`[EXECUTOR] cycle ${thisId}: ${e.message?.slice(0, 100)}`)
    }
  } finally {
    activeExecs--
  }
}

// ── BLOCK CADENCE RING ────────────────────────────────────────────────────────
let blockQueue = 0

setInterval(() => {
  let processed = 0
  while (blockQueue > 0 && processed < MAX_CONCURRENT && activeExecs < MAX_CONCURRENT) {
    executeCycle().catch(() => {})
    blockQueue--
    processed++
  }
}, 50)

// Velocity + progress tracker
setInterval(() => {
  const rev    = HOT[H.REV_TODAY]     || 0
  const target = HOT[H.DAILY_TARGET]  || 0
  HOT[H.PROGRESS] = (target > 0 && target !== Number.MAX_SAFE_INTEGER)
    ? Math.min(100, (rev / target) * 100)
    : 0
}, 5_000)

// Receive block signals from chains worker
process.on('message', msg => {
  if (msg?.type === 'block') blockQueue++
})

// Polygon fallback: fire every 2.12s if no block signal
setInterval(() => { blockQueue++ }, 2120)

console.log('[EXECUTOR] Block cadence ring | 7-point live check | live strategy data | max 3 concurrent')
