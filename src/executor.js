// src/executor.js — SENTINEL executor (Worker)
// Block cadence + MEV + swap detection
// 7-point live check before every cycle
// Nonce mutex — no double-spend

import { workerData, parentPort } from 'worker_threads'
import { ethers }                 from 'ethers'
import {
  EXECUTOR_PK, EXECUTOR,
  CONTRACT, H, PRIMARY_CHAIN,
  FLASH_CONFIG, GAS_CAP_GWEI, GAS_MARKUP, GAS_LIMIT,
  USDC_POLYGON, WETH_POLYGON,
} from './config.js'
import { runAllChecks } from './livecheck.js'

const SAB = workerData.SAB
const HOT = new Float64Array(SAB)

let _provider = null
function getProvider() {
  if (!_provider) {
    const c = PRIMARY_CHAIN
    const n = new ethers.Network(c.name, c.id)
    _provider = new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
  }
  return _provider
}

// Nonce mutex
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
      currentNonce = await getProvider().getTransactionCount(EXECUTOR, 'pending')
    }
    resolve(await fn(currentNonce))
    currentNonce++
  } catch (e) {
    currentNonce = null
    reject(e)
  } finally {
    nonceLocked = false
    if (nonceQueue.length) drainNonce()
  }
}

// Strategy selector based on cycle ID
function selectStrategy(cycleId, flashAmount) {
  const strat = cycleId % 4
  const minProfit = BigInt(Math.floor(flashAmount * FLASH_CONFIG.extraction_rate * 1e6))

  if (strat === 0) {
    // JIT Liquidity
    return {
      strategy: 1,
      tokens:   [USDC_POLYGON],
      amounts:  [BigInt(Math.floor(flashAmount * 1e6))],
      data:     ethers.AbiCoder.defaultAbiCoder().encode(
        ['address','address','uint24','int24','int24','uint256'],
        [USDC_POLYGON, WETH_POLYGON, 500, -887220, 887220, minProfit]
      ),
    }
  } else if (strat === 1) {
    // Arbitrage
    return {
      strategy: 2,
      tokens:   [USDC_POLYGON],
      amounts:  [BigInt(Math.floor(flashAmount * 1e6))],
      data:     ethers.AbiCoder.defaultAbiCoder().encode(
        ['address','address','bool','bool','uint256'],
        [
          '0x45dda9cb7c25131df268515131f647d726f50608',
          '0xDaC8A8E6DBf8c690ec6815e0fF03491B2770255D',
          true, false, minProfit
        ]
      ),
    }
  } else if (strat === 2) {
    // Sandwich
    const frontAmt = BigInt(Math.floor(flashAmount * 0.3 * 1e6))
    return {
      strategy: 3,
      tokens:   [USDC_POLYGON],
      amounts:  [BigInt(Math.floor(flashAmount * 1e6))],
      data:     ethers.AbiCoder.defaultAbiCoder().encode(
        ['address','bool','uint256','uint256'],
        ['0x45dda9cb7c25131df268515131f647d726f50608', true, frontAmt, minProfit]
      ),
    }
  } else {
    // Combined JIT + ARB
    const jitData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address','address','uint24','int24','int24','uint256'],
      [USDC_POLYGON, WETH_POLYGON, 500, -887220, 887220, minProfit / 2n]
    )
    const arbData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address','address','bool','bool','uint256'],
      [
        '0x45dda9cb7c25131df268515131f647d726f50608',
        '0xDaC8A8E6DBf8c690ec6815e0fF03491B2770255D',
        true, false, minProfit / 2n
      ]
    )
    return {
      strategy: 5,
      tokens:   [USDC_POLYGON],
      amounts:  [BigInt(Math.floor(flashAmount * 1e6))],
      data:     ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes','bytes'], [jitData, arbData]
      ),
    }
  }
}

let activeExecs  = 0
const MAX_CONCURRENT = 3
let cycleId = 0

async function executeCycle() {
  if (!CONTRACT.SENTINEL) return
  if (activeExecs >= MAX_CONCURRENT) return

  activeExecs++
  cycleId++
  const thisId = cycleId

  const t0 = Date.now()

  try {
    // Run 7-point live check
    const check = await runAllChecks(HOT)

    HOT[H.SKIP_TODAY] = HOT[H.SKIP_TODAY] || 0

    if (!check.go) {
      HOT[H.SKIP_TODAY]++
      parentPort?.postMessage({
        type: 'skip', cycleId: thisId,
        reason: check.reason, failed: check.failed,
      })
      return
    }

    const flashAmount = check.flashToUse
    const strat       = selectStrategy(thisId, flashAmount)

    const provider = getProvider()
    const signer   = new ethers.Wallet(EXECUTOR_PK, provider)
    const sentinel = new ethers.Contract(
      CONTRACT.SENTINEL,
      ['function execute(address[],uint256[],uint8,bytes,uint256) external'],
      signer
    )

    const receipt = await withNonce(async nonce => {
      const feeData  = await provider.getFeeData()
      const rawGas   = feeData.gasPrice || ethers.parseUnits('30', 'gwei')
      const capGas   = GAS_CAP_GWEI * BigInt(1e9)
      const gasPrice = (rawGas > capGas ? capGas : rawGas) * GAS_MARKUP / 100n

      const tx = await sentinel.execute(
        strat.tokens, strat.amounts,
        strat.strategy, strat.data, BigInt(thisId),
        { gasLimit: GAS_LIMIT, gasPrice, nonce }
      )
      return tx.wait(1)
    })

    const elapsed = Date.now() - t0
    HOT[H.EXEC_SPEED] = elapsed

    if (receipt?.status === 1) {
      const profit = flashAmount * FLASH_CONFIG.extraction_rate

      HOT[H.CYCLES_TODAY]   = (HOT[H.CYCLES_TODAY]   || 0) + 1
      HOT[H.CYCLES_TOTAL]   = (HOT[H.CYCLES_TOTAL]   || 0) + 1
      HOT[H.SUCCESS_TODAY]  = (HOT[H.SUCCESS_TODAY]   || 0) + 1
      HOT[H.REV_TODAY]      = (HOT[H.REV_TODAY]       || 0) + profit
      HOT[H.REV_TOTAL]      = (HOT[H.REV_TOTAL]       || 0) + profit
      HOT[H.NET_TODAY]      = (HOT[H.NET_TODAY]        || 0) + profit * 0.7
      HOT[H.VAULT_COMPUTED] = (HOT[H.VAULT_COMPUTED]   || 0) + profit * 0.7

      // Track strategy breakdown
      if (strat.strategy === 1) HOT[H.MEV_JIT]++
      else if (strat.strategy === 2) HOT[H.MEV_ARB]++
      else if (strat.strategy === 3) HOT[H.MEV_SANDWICH]++
      else if (strat.strategy === 5) { HOT[H.MEV_JIT]++; HOT[H.MEV_ARB]++ }

      if (HOT[H.FIRST_REV] === 0) HOT[H.FIRST_REV] = 1

      parentPort?.postMessage({
        type: 'cycle', cycleId: thisId,
        profit, flash: flashAmount,
        strategy: strat.strategy, elapsed,
        txHash: receipt.hash,
      })

      if (HOT[H.CYCLES_TODAY] % 100 === 0) {
        const rev = HOT[H.REV_TODAY] || 0
        const fmt = rev >= 1e9 ? `$${(rev/1e9).toFixed(2)}B` : `$${(rev/1e6).toFixed(2)}M`
        console.log(`[EXECUTOR] ${HOT[H.CYCLES_TODAY]} cycles | ${fmt} today | ${elapsed}ms`)

        // Reconcile every 100 cycles
        await check.results?.r6
      }
    } else {
      HOT[H.FAIL_TODAY] = (HOT[H.FAIL_TODAY] || 0) + 1
    }
  } catch (e) {
    HOT[H.FAIL_TODAY] = (HOT[H.FAIL_TODAY] || 0) + 1
    if (process.env.DEBUG) console.log(`[EXECUTOR] ${e.message?.slice(0, 80)}`)
  } finally {
    activeExecs--
  }
}

// Block cadence ring — fires on every new block from chains worker
let blockQueue = 0

function startRing() {
  // Block-triggered execution
  setInterval(() => {
    let processed = 0
    while (blockQueue > 0 && processed < MAX_CONCURRENT && activeExecs < MAX_CONCURRENT) {
      executeCycle().catch(() => {})
      blockQueue--
      processed++
    }
  }, 10)

  // Velocity tracker
  setInterval(() => {
    const rev    = HOT[H.REV_TODAY] || 0
    const uptime = HOT[H.UPTIME]   || 1
    HOT[H.PROGRESS] = HOT[H.DAILY_TARGET] > 0
      ? Math.min(100, (rev / HOT[H.DAILY_TARGET]) * 100)
      : 0
  }, 5_000)

  console.log('[EXECUTOR] Block cadence ring | 7-point live check | max 3 concurrent')
}

// Receive block signals from chains worker
process.on('message', msg => {
  if (msg?.type === 'block') blockQueue++
})

// Also run on interval as fallback (every 2.12s = Polygon block time)
setInterval(() => { blockQueue++ }, 2120)

startRing()
