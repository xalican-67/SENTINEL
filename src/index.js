// src/index.js — SENTINEL boot

import { Worker }        from 'worker_threads'
import { fileURLToPath } from 'url'
import path              from 'path'
import {
  SAB_SIZE, H, SYSTEM, VERSION, EXECUTOR, PORT,
  CHAINS, PROPELLER, TOTAL_BLOCKS_DAY,
} from './config.js'
import { startDeployer }   from './deployer.js'
import { startTreasury }   from './treasury.js'
import { startOracle }     from './oracle.js'
import { startGas }        from './gas.js'
import { startRecycler }   from './recycler.js'
import { startReconciler } from './reconciler.js'
import { startMempool }    from './mempool.js'
import { startDiag }       from './diag.js'
import { startDashboard }  from './dashboard.js'

export const SAB = new SharedArrayBuffer(SAB_SIZE)
export const HOT = new Float64Array(SAB)

// Boot defaults — P10 active
HOT[H.GAS_OK]       = 1
HOT[H.PROPELLER]    = 10
HOT[H.DAILY_TARGET] = PROPELLER.P10.target
HOT[H.CYCLES_MAX]   = PROPELLER.P10.maxCycles
HOT[H.RECONCILE_SCORE] = 100

console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║                  S E N T I N E L                          ║')
console.log(`║   Version: ${VERSION}  |  20 chains  |  1,526,682 blocks/day    ║`)
console.log(`║   Executor: ${EXECUTOR.slice(0,20)}...                 ║`)
console.log('║   Treasury: 0xCCCF1C9A2154... (classified)                ║')
console.log('║   Engine:   MEV + Swaps + Block cadence                   ║')
console.log('║   Algorithm: 7-point live check — every cycle             ║')
console.log(`║   P10 active — ${TOTAL_BLOCKS_DAY.toLocaleString()} block ceiling/day               ║`)
console.log('╚════════════════════════════════════════════════════════════╝')

const __dir = path.dirname(fileURLToPath(import.meta.url))

// Core services
startDeployer(SAB)
startTreasury(HOT)
startOracle(HOT)
startGas(HOT)
startRecycler(HOT)
startReconciler(HOT)
startMempool(HOT)
startDiag(SAB)
startDashboard(SAB)

// Chains worker — 20 WS connections, block + swap detection
const chainsWorker = new Worker(path.join(__dir, 'chains.js'), {
  workerData: { SAB },
  resourceLimits: { maxOldGenerationSizeMb: 150 },
})
chainsWorker.on('message', msg => {
  if (msg.type === 'block') {
    execWorker.postMessage({ type: 'block' })
  }
})
chainsWorker.on('error', e => console.log(`[CHAINS] ${e.message?.slice(0,60)}`))

// Executor worker
const execWorker = new Worker(path.join(__dir, 'executor.js'), {
  workerData: { SAB },
  resourceLimits: { maxOldGenerationSizeMb: 150 },
})
execWorker.on('message', msg => {
  if (msg.type === 'cycle') {
    HOT[H.REV_TODAY]   = (HOT[H.REV_TODAY]   || 0) + (msg.profit || 0)
    HOT[H.CYCLES_TODAY]= (HOT[H.CYCLES_TODAY] || 0) + 1
  }
  if (msg.type === 'skip') {
    HOT[H.SKIP_TODAY]  = (HOT[H.SKIP_TODAY]   || 0) + 1
  }
})
execWorker.on('error', e => console.log(`[EXECUTOR] ${e.message?.slice(0,60)}`))

// Uptime + memory
setInterval(() => {
  HOT[H.UPTIME]++
  HOT[H.MB] = process.memoryUsage().heapUsed / 1024 / 1024 | 0
}, 1_000)

// Midnight reset
const scheduleMidnight = () => {
  const nx = new Date()
  nx.setUTCHours(0,0,0,0); nx.setUTCDate(nx.getUTCDate() + 1)
  setTimeout(() => {
    ;[
      H.CYCLES_TODAY, H.REV_TODAY, H.NET_TODAY, H.SKIP_TODAY,
      H.SUCCESS_TODAY, H.FAIL_TODAY, H.GAS_SPENT, H.PROGRESS,
      H.MEV_JIT, H.MEV_ARB, H.MEV_SANDWICH, H.MEV_LIQ,
      H.CHECK1_PASS, H.CHECK2_PASS, H.CHECK3_PASS, H.CHECK4_PASS,
      H.CHECK5_PASS, H.CHECK6_PASS, H.CHECK7_PASS,
    ].forEach(i => { HOT[i] = 0 })
    scheduleMidnight()
  }, nx - Date.now())
}
scheduleMidnight()

process.on('uncaughtException',  e => console.log(`[SENTINEL] ${e.message?.slice(0,100)}`))
process.on('unhandledRejection', r => console.log(`[SENTINEL] ${String(r).slice(0,100)}`))
process.on('SIGTERM', () => process.exit(0))

console.log(`[SENTINEL] Operational :${PORT} | Send 0.1 POL to ${EXECUTOR.slice(0,20)}... to deploy`)
