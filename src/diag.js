// src/diag.js — SENTINEL diagnostic logger

import { H, SYSTEM, VERSION, EXECUTOR, PROPELLER, ACTIVE_PROPELLER } from './config.js'

function fmtRev(n) {
  if (!n) return '$0'
  if (n >= 1e12) return `$${(n/1e12).toFixed(3)}T`
  if (n >= 1e9)  return `$${(n/1e9).toFixed(3)}B`
  if (n >= 1e6)  return `$${(n/1e6).toFixed(3)}M`
  if (n >= 1e3)  return `$${(n/1e3).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

export function startDiag(SAB) {
  const HOT = new Float64Array(SAB)
  let tick = 0

  setInterval(() => {
    tick++
    const upSec = HOT[H.UPTIME] | 0
    const h = Math.floor(upSec/3600), m = Math.floor((upSec%3600)/60), s = upSec%60

    const succ  = HOT[H.SUCCESS_TODAY] | 0
    const fail  = HOT[H.FAIL_TODAY]    | 0
    const skip  = HOT[H.SKIP_TODAY]    | 0
    const total = succ + fail + skip
    const rate  = total > 0 ? Math.round(succ/total*100) : 0

    const pl  = 'P' + (HOT[H.PROPELLER] | 0 || 10)
    const max = HOT[H.CYCLES_MAX] | 0

    console.log(`\n[DIAG #${tick}] ${SYSTEM} ${VERSION} | ${new Date().toTimeString().slice(0,8)} | up: ${h}h ${m}m ${s}s`)
    console.log('─'.repeat(64))
    console.log(`[MEM]   ${HOT[H.MB]|0}MB heap`)
    console.log(`[CTRS]  ${HOT[H.DEPLOYMENT]===1 ? `${HOT[H.CONTRACTS]|0} deployed` : `Awaiting 0.1 POL → ${EXECUTOR.slice(0,20)}...`}`)
    console.log(`[CHN]   ${HOT[H.CHAIN_COUNT]|0}/20 connected`)
    console.log(`[FLASH] live: ${fmtRev(HOT[H.FLASH_LIVE])} | balancer: ${fmtRev(HOT[H.FLASH_BALANCER])} | aave: ${fmtRev(HOT[H.FLASH_AAVE])}`)
    console.log(`[GAS]   ${HOT[H.GAS_OK]===1 ? `✓ ${(HOT[H.GAS_PRICE]||0).toFixed(1)} gwei` : `⚠ PAUSED ${(HOT[H.GAS_PRICE]||0).toFixed(1)} gwei`}`)
    console.log(`[EXEC]  cycles: ${HOT[H.CYCLES_TODAY]|0}/${max} | success: ${succ} | fail: ${fail} | skip: ${skip} | rate: ${rate}%`)
    console.log(`[REV]   today: ${fmtRev(HOT[H.REV_TODAY])} | confirmed: $${(HOT[H.VAULT_CONFIRMED]||0).toFixed(2)} | score: ${(HOT[H.RECONCILE_SCORE]||100).toFixed(1)}%`)
    console.log(`[PROP]  ${pl} | ${PROPELLER[pl]?.label || 'P10'} | ceiling: ${(HOT[H.CYCLES_MAX]|0).toLocaleString()} cycles`)
    console.log(`[7PT]   C1:${HOT[H.CHECK1_PASS]|0} C2:${HOT[H.CHECK2_PASS]|0} C3:${HOT[H.CHECK3_PASS]|0} C4:${HOT[H.CHECK4_PASS]|0} C5:${HOT[H.CHECK5_PASS]|0} C6:${HOT[H.CHECK6_PASS]|0} C7:${HOT[H.CHECK7_PASS]|0}`)
  }, 300_000)

  console.log('[DIAG] Active | 5 min interval')
}
