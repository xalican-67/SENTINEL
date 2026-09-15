// src/diag.js — SENTINEL diagnostic logger
// log.js style from JUPITERR
// 5 logs per minute | starts 15s after boot
// Shows live flash, 7-point check counters, revenue, propeller

import { H, SYSTEM, VERSION, EXECUTOR, PROPELLER } from './config.js'

const SEP = '-'.repeat(64)
let diagCount = 0
let diagTimer = null

function fB(n) {
  if (!n || isNaN(n) || n === 0) return '$0'
  const x = Number(n)
  if (x >= 1e12) return '$' + (x/1e12).toFixed(3) + 'T'
  if (x >= 1e9)  return '$' + (x/1e9).toFixed(3)  + 'B'
  if (x >= 1e6)  return '$' + (x/1e6).toFixed(3)  + 'M'
  if (x >= 1e3)  return '$' + (x/1e3).toFixed(2)  + 'K'
  return '$' + x.toFixed(2)
}

function fmtTime(s) {
  s = s | 0
  if (s < 60)   return s + 's'
  if (s < 3600) return (s/60|0) + 'm ' + (s%60) + 's'
  return (s/3600|0) + 'h ' + (s%3600/60|0) + 'm'
}

function runDiag(HOT) {
  diagCount++
  const time   = new Date().toISOString().slice(11, 19)
  const uptime = HOT[H.UPTIME] | 0
  const mem    = process.memoryUsage()
  const heap   = Math.round(mem.heapUsed  / 1024 / 1024)
  const tot    = Math.round(mem.heapTotal / 1024 / 1024)
  const rss    = Math.round(mem.rss       / 1024 / 1024)
  const pct    = Math.round(heap / tot * 100)
  const memWarn = pct > 85

  const deployed  = HOT[H.DEPLOYMENT] === 1
  const contracts = HOT[H.CONTRACTS]  | 0
  const chains    = HOT[H.CHAIN_COUNT]| 0
  const gasOK     = HOT[H.GAS_OK]    === 1
  const gasGwei   = HOT[H.GAS_PRICE]  || 0
  const flashLive = HOT[H.FLASH_LIVE]     || 0
  const flashBal  = HOT[H.FLASH_BALANCER] || 0
  const flashAave = HOT[H.FLASH_AAVE]     || 0
  const succ      = HOT[H.SUCCESS_TODAY]  | 0
  const fail      = HOT[H.FAIL_TODAY]     | 0
  const skip      = HOT[H.SKIP_TODAY]     | 0
  const cycles    = HOT[H.CYCLES_TODAY]   | 0
  const cyclesMax = HOT[H.CYCLES_MAX]     | 0
  const execSpeed = HOT[H.EXEC_SPEED_MS]  || 0
  const revToday  = HOT[H.REV_TODAY]      || 0
  const revTotal  = HOT[H.REV_TOTAL]      || 0
  const confirmed = HOT[H.VAULT_CONFIRMED]|| 0
  const recon     = HOT[H.RECONCILE_SCORE]|| 100
  const propeller = 'P' + (HOT[H.PROPELLER] | 0 || 10)
  const gasSpent  = HOT[H.GAS_SPENT]      || 0
  const reserveOK = HOT[H.RESERVE_OK]    === 1
  const reserve   = HOT[H.GAS_RESERVE]    || 0
  const firstRev  = HOT[H.FIRST_REV]     === 1

  const total = succ + fail
  const rate  = total > 0 ? Math.round(succ / total * 100) : 0

  console.log(`\n[DIAG #${diagCount}] ${SYSTEM} ${VERSION} | ${time} | up: ${fmtTime(uptime)}`)
  console.log(SEP)

  // Memory
  const memStatus = memWarn ? 'WARNING' : pct > 70 ? 'MODERATE' : 'OK'
  console.log(`[MEM]   ${heap}MB/${tot}MB heap (${pct}%) ${memStatus} | rss: ${rss}MB`)

  // Contracts + chains
  if (deployed) {
    console.log(`[CTRS]  ${contracts} contracts deployed | ${chains}/20 chains connected`)
  } else {
    console.log(`[CTRS]  Awaiting 0.1 POL → ${EXECUTOR.slice(0, 20)}... | ${chains}/20 chains`)
  }

  // Flash
  console.log(`[FLASH] live: ${fB(flashLive)} | balancer: ${fB(flashBal)} | aave: ${fB(flashAave)}`)

  // Gas + reserve
  const gasStr = gasOK
    ? `OK (${gasGwei.toFixed(1)} gwei)`
    : `PAUSED (${gasGwei.toFixed(1)} gwei > cap)`
  const resStr = reserveOK
    ? `$${reserve.toFixed(2)} OK`
    : `$${reserve.toFixed(2)} LOW — execution paused`
  console.log(`[GAS]   ${gasStr} | gas spent: ${gasSpent.toFixed(4)} POL | reserve: ${resStr}`)

  // Execution
  console.log(`[EXEC]  cycles: ${cycles.toLocaleString()}/${cyclesMax.toLocaleString()} | success: ${succ} | fail: ${fail} | skip: ${skip} | rate: ${rate}% | speed: ${execSpeed.toFixed(1)}ms`)

  // Revenue
  console.log(`[REV]   today: ${fB(revToday)} | all-time: ${fB(revTotal)} | confirmed: ${fB(confirmed)} | recon: ${recon.toFixed(1)}%`)

  // Propeller
  const propLabel = PROPELLER[propeller]?.label || propeller
  console.log(`[PROP]  ${propeller} | ${propLabel} | ceiling: ${cyclesMax.toLocaleString()} cycles | first rev: ${firstRev ? 'CONFIRMED' : 'pending'}`)

  // 7-point check counters
  console.log(`[7PT]   C1:${HOT[H.CHECK1_PASS]|0} C2:${HOT[H.CHECK2_PASS]|0} C3:${HOT[H.CHECK3_PASS]|0} C4:${HOT[H.CHECK4_PASS]|0} C5:${HOT[H.CHECK5_PASS]|0} C6:${HOT[H.CHECK6_PASS]|0} C7:${HOT[H.CHECK7_PASS]|0}`)

  // Warnings
  if (memWarn)    console.log('[WARN]  Memory above 85% — Railway may restart')
  if (!deployed)  console.log('[WARN]  No contracts deployed — send 0.1 POL')
  if (!gasOK)     console.log('[WARN]  Gas cap exceeded — executor paused')
  if (!reserveOK) console.log('[WARN]  Gas reserve below $100 — top up executor wallet')
  if (recon < 95 && confirmed > 0) console.log(`[WARN]  Reconciliation gap ${(100-recon).toFixed(1)}% — review treasury`)

  console.log(SEP)
}

export function startDiag(SAB) {
  const HOT = new Float64Array(SAB)
  console.log('[DIAG] SENTINEL diagnostics starting in 15s')
  setTimeout(() => {
    console.log(`\n[DIAG] Active | 5/min | ${SYSTEM}`)
    runDiag(HOT)
    diagTimer = setInterval(() => runDiag(HOT), 12_000)
  }, 15_000)
}

export function stopDiag() {
  if (diagTimer) { clearInterval(diagTimer); diagTimer = null }
}
