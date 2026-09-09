// src/deployer.js — SENTINEL deployer
// Compiler runs in isolated subprocess — 250MB hard cap
// Sequential compilation — one contract at a time
// Main process never loads solc — stays clean

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { fork }          from 'child_process'
import { ethers }        from 'ethers'
import { fileURLToPath } from 'url'
import path              from 'path'
import {
  EXECUTOR_PK, EXECUTOR, TREASURY,
  CONTRACT, H, PRIMARY_CHAIN,
} from './config.js'

const __dir     = path.dirname(fileURLToPath(import.meta.url))
const ADDR_PATH = '/data/sentinel_contracts.json'
const COMP_PATH = '/data/sentinel_compiled.json'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}
function makeSigner() { return new ethers.Wallet(EXECUTOR_PK, makeProvider()) }

function loadAddresses() {
  try {
    if (!existsSync(ADDR_PATH)) return null
    const d = JSON.parse(readFileSync(ADDR_PATH, 'utf8'))
    return d.Sentinel && ethers.isAddress(d.Sentinel) ? d : null
  } catch { return null }
}

function loadCompiled() {
  try {
    if (!existsSync(COMP_PATH)) return null
    return JSON.parse(readFileSync(COMP_PATH, 'utf8'))
  } catch { return null }
}

function saveAddresses(data) {
  try {
    if (!existsSync('/data')) mkdirSync('/data', { recursive: true })
    writeFileSync(ADDR_PATH, JSON.stringify(data, null, 2))
  } catch {}
}

function inject(addrs) {
  const map = {
    SENTINEL:        'Sentinel',
    SENTINEL_VAULT:  'SentinelVault',
    SENTINEL_GUARD:  'SentinelGuard',
    SENTINEL_ORACLE: 'SentinelOracle',
    SENTINEL_SIGNAL: 'SentinelSignal',
    SENTINEL_FLASH:  'SentinelFlash',
  }
  for (const [env, key] of Object.entries(map)) {
    const val = addrs[key]
    if (val && ethers.isAddress(val)) {
      process.env[env] = val
      CONTRACT[env]    = val
    }
  }
}

// ── FORK COMPILER — 250MB isolated subprocess ─────────────────────────────────
function runCompiler() {
  return new Promise((resolve, reject) => {
    console.log('[DEPLOYER] Forking compiler (250MB isolated)...')

    const child = fork(
      path.join(__dir, 'compile.js'),
      [],
      {
        execArgv: [
          '--max-old-space-size=250',
          '--expose-gc',
          '--gc-interval=50',
        ],
        silent: false,
      }
    )

    child.on('message', msg => {
      switch (msg.type) {
        case 'start':
          console.log(`[DEPLOYER] Compiling ${msg.count} contracts sequentially (250MB cap)...`)
          break
        case 'compiled':
          console.log(`[DEPLOYER] + ${msg.name}`)
          break
        case 'missing':
          console.log(`[DEPLOYER] Missing: ${msg.name}`)
          break
        case 'error':
          console.log(`[DEPLOYER] ${msg.name}: ${msg.msg}`)
          break
        case 'critical_fail':
          console.log(`[DEPLOYER] CRITICAL FAIL: ${msg.name}`)
          break
        case 'done':
          console.log(`[DEPLOYER] Compiled ${msg.count}/6: ${msg.names.join(', ')}`)
          break
        case 'written':
          console.log(`[DEPLOYER] Artifacts written (${msg.count}) — compiler exiting`)
          break
        case 'already_deployed':
          console.log('[DEPLOYER] Existing deployment found — skipping compile')
          resolve({ alreadyDeployed: true, data: msg.data })
          break
        case 'fatal':
          console.log(`[DEPLOYER] FATAL: ${msg.msg}`)
          break
      }
    })

    child.on('exit', code => {
      if (code === 0) {
        const compiled = loadCompiled()
        if (compiled) {
          console.log('[DEPLOYER] Compiler exited — memory freed — artifacts loaded')
          resolve({ compiled })
        } else {
          reject(new Error('Compiler exited 0 but no artifacts at ' + COMP_PATH))
        }
      } else {
        reject(new Error(`Compiler subprocess exited with code ${code}`))
      }
    })

    child.on('error', e => reject(e))
  })
}

// ── DEPLOY ONE ────────────────────────────────────────────────────────────────
async function deployOne(compiled, name, args = []) {
  const c = compiled[name]
  if (!c) { console.log(`[DEPLOYER] ${name} not compiled — skipping`); return null }

  const provider = makeProvider()
  const signer   = makeSigner()
  const feeData  = await provider.getFeeData()
  const rawGas   = feeData.gasPrice || ethers.parseUnits('30', 'gwei')
  const capGas   = ethers.parseUnits('1000', 'gwei')
  const gasPrice = (rawGas > capGas ? capGas : rawGas) * 130n / 100n

  const factory  = new ethers.ContractFactory(c.abi, c.bytecode, signer)
  const contract = await factory.deploy(...args, { gasLimit: 3_000_000, gasPrice })
  const receipt  = await contract.deploymentTransaction().wait(2)
  const address  = await contract.getAddress()

  if (!receipt?.status) throw new Error(`${name} reverted`)

  if (compiled[name]) compiled[name].bytecode = ''

  console.log(`[DEPLOYER] ${name} → ${address.slice(0, 14)}...`)
  return address
}

// ── DEPLOY ALL 6 ──────────────────────────────────────────────────────────────
async function deployAll(compiled, HOT) {
  const addrs = {}

  const deploy = async (name, args) => {
    for (let i = 1; i <= 3; i++) {
      try {
        const a = await deployOne(compiled, name, args)
        if (a) { addrs[name] = a; return a }
      } catch (e) {
        console.log(`[DEPLOYER] ${name} attempt ${i}/3: ${e.message?.slice(0, 60)}`)
        if (i < 3) await new Promise(r => setTimeout(r, 8_000))
      }
    }
    return null
  }

  await deploy('SentinelVault',  [TREASURY])
  await deploy('SentinelGuard',  [])
  await deploy('SentinelOracle', [])
  await deploy('SentinelSignal', [])
  await deploy('SentinelFlash',  [])

  const sentinelAddr = await deploy('Sentinel', [TREASURY])

  if (!sentinelAddr) {
    console.log('[DEPLOYER] FATAL: Sentinel deploy failed')
    return false
  }

  // Link companions
  if (sentinelAddr) {
    try {
      const s   = makeSigner()
      const c   = new ethers.Contract(
        sentinelAddr,
        ['function setCompanions(address,address,address,address) external'],
        s
      )
      const fee = await makeProvider().getFeeData()
      await (await c.setCompanions(
        addrs.SentinelVault  || ethers.ZeroAddress,
        addrs.SentinelGuard  || ethers.ZeroAddress,
        addrs.SentinelOracle || ethers.ZeroAddress,
        addrs.SentinelSignal || ethers.ZeroAddress,
        { gasLimit: 200_000, gasPrice: fee.gasPrice }
      )).wait(1)
      console.log('[DEPLOYER] Companions linked')
    } catch (e) { console.log(`[DEPLOYER] Link: ${e.message?.slice(0, 60)}`) }
  }

  // Set sentinel on vault
  if (addrs.SentinelVault) {
    try {
      const s   = makeSigner()
      const v   = new ethers.Contract(addrs.SentinelVault, ['function setSentinel(address) external'], s)
      const fee = await makeProvider().getFeeData()
      await (await v.setSentinel(sentinelAddr, { gasLimit: 100_000, gasPrice: fee.gasPrice })).wait(1)
    } catch {}
  }

  // Set sentinel on guard
  if (addrs.SentinelGuard) {
    try {
      const s   = makeSigner()
      const g   = new ethers.Contract(addrs.SentinelGuard, ['function setSentinel(address) external'], s)
      const fee = await makeProvider().getFeeData()
      await (await g.setSentinel(sentinelAddr, { gasLimit: 100_000, gasPrice: fee.gasPrice })).wait(1)
    } catch {}
  }

  inject(addrs)
  saveAddresses({ ...addrs, deployedAt: Date.now(), chain: PRIMARY_CHAIN.name })

  const count = Object.values(addrs).filter(v => typeof v === 'string' && ethers.isAddress(v)).length
  HOT[H.CONTRACTS]  = count
  HOT[H.DEPLOYMENT] = 1

  try { if (existsSync(COMP_PATH)) unlinkSync(COMP_PATH) } catch {}

  console.log(`[DEPLOYER] ${count}/6 deployed | Sentinel: ${sentinelAddr.slice(0, 14)}...`)
  return true
}

// ── WATCH FOR POL ─────────────────────────────────────────────────────────────
function watchForFunds(compiled, HOT) {
  const provider = makeProvider()
  let deploying = false, lastBal = -1

  const iv = setInterval(async () => {
    if (deploying) return
    try {
      const bal = await provider.getBalance(EXECUTOR)
      const pol = parseFloat(ethers.formatEther(bal))
      if (Math.floor(pol * 100) !== lastBal) {
        lastBal = Math.floor(pol * 100)
        if (pol > 0) console.log(`[DEPLOYER] ${pol.toFixed(4)} POL | need 0.1 at ${EXECUTOR}`)
      }
      if (pol >= 0.1) {
        deploying = true
        clearInterval(iv)
        console.log('[DEPLOYER] 0.1 POL received — deploying 6 contracts...')
        const ok = await deployAll(compiled, HOT)
        if (!ok) {
          deploying = false
          setTimeout(() => watchForFunds(compiled, HOT), 60_000)
        }
      }
    } catch {}
  }, 500)

  console.log(`[DEPLOYER] Watching for 0.1 POL at ${EXECUTOR}`)
}

// ── ENTRY ─────────────────────────────────────────────────────────────────────
export function startDeployer(SAB) {
  const HOT = new Float64Array(SAB)

  const existing = loadAddresses()
  if (existing) {
    inject(existing)
    const count = Object.values(existing).filter(v => typeof v === 'string' && ethers.isAddress(v)).length
    HOT[H.CONTRACTS]  = count
    HOT[H.DEPLOYMENT] = 1
    console.log(`[DEPLOYER] Restored ${count} contracts | Sentinel: ${existing.Sentinel?.slice(0, 14)}...`)
    return
  }

  console.log('[DEPLOYER] No existing deployment — forking compiler...')

  setTimeout(async () => {
    let attempts = 0
    const tryCompile = async () => {
      attempts++
      try {
        const result = await runCompiler()
        if (result.alreadyDeployed) {
          inject(result.data)
          const count = Object.values(result.data).filter(v => typeof v === 'string' && ethers.isAddress(v)).length
          HOT[H.CONTRACTS]  = count
          HOT[H.DEPLOYMENT] = 1
          return
        }
        if (result.compiled) {
          watchForFunds(result.compiled, HOT)
        }
      } catch (e) {
        console.log(`[DEPLOYER] Compile attempt ${attempts}/5: ${e.message?.slice(0, 80)}`)
        if (attempts < 5) setTimeout(tryCompile, 30_000)
        else console.log('[DEPLOYER] Compilation failed after 5 attempts')
      }
    }
    tryCompile()
  }, 2_000)
}
