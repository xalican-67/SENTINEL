// src/deployer.js — SENTINEL deployer
// viaIR:true — no stack too deep
// Compiles 6 contracts, deploys on 0.1 POL
// staticNetwork — no localhost:8545

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { ethers }        from 'ethers'
import {
  EXECUTOR_PK, EXECUTOR, TREASURY,
  CONTRACT, H, PRIMARY_CHAIN,
} from './config.js'

const require        = createRequire(import.meta.url)
const CONTRACTS_PATH = '/data/sentinel_contracts.json'

function makeProvider() {
  const c = PRIMARY_CHAIN
  const n = new ethers.Network(c.name, c.id)
  return new ethers.JsonRpcProvider(c.http, n, { staticNetwork: n })
}

const provider = makeProvider()
const signer   = new ethers.Wallet(EXECUTOR_PK, provider)

const SOURCES = {
  Sentinel:       './contracts/Sentinel.sol',
  SentinelVault:  './contracts/SentinelVault.sol',
  SentinelGuard:  './contracts/SentinelGuard.sol',
  SentinelOracle: './contracts/SentinelOracle.sol',
  SentinelSignal: './contracts/SentinelSignal.sol',
}

const compiled = {}
let   ready    = false

function compileSingle(sourcePath, contractName) {
  if (!existsSync(sourcePath)) { console.log(`[DEPLOYER] Missing: ${sourcePath}`); return null }
  if (global.gc) global.gc()
  const solc   = require('solc')
  const source = readFileSync(sourcePath, 'utf8')
  const input  = JSON.stringify({
    language: 'Solidity',
    sources:  { [`${contractName}.sol`]: { content: source } },
    settings: {
      viaIR:           true,
      optimizer:       { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  })
  let out
  try { out = JSON.parse(solc.compile(input)) } catch { return null }
  const fatals = (out.errors || []).filter(e => e.severity === 'error')
  if (fatals.length) {
    fatals.forEach(f => console.log(`[DEPLOYER] ${contractName}: ${f.formattedMessage?.slice(0, 150)}`))
    return null
  }
  const c = out.contracts?.[`${contractName}.sol`]?.[contractName]
  if (!c?.evm?.bytecode?.object) return null
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, name: contractName }
}

function precompile() {
  let ok = true
  for (const [name, path] of Object.entries(SOURCES)) {
    const r = compileSingle(path, name)
    if (!r && name === 'Sentinel') { ok = false; break }
    if (r) compiled[name] = r
  }
  if (ok) console.log(`[DEPLOYER] Compiled: ${Object.keys(compiled).join(', ')} | awaiting 0.1 POL`)
  return ok
}

function load() {
  try {
    if (!existsSync(CONTRACTS_PATH)) return {}
    const d = JSON.parse(readFileSync(CONTRACTS_PATH, 'utf8'))
    return Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v !== 'string' || ethers.isAddress(v)))
  } catch { return {} }
}

function save(data) {
  try {
    if (!existsSync('/data')) mkdirSync('/data', { recursive: true })
    writeFileSync(CONTRACTS_PATH, JSON.stringify(data, null, 2))
  } catch {}
}

function inject(addrs) {
  if (addrs.Sentinel)       { process.env.SENTINEL        = addrs.Sentinel;       CONTRACT.SENTINEL        = addrs.Sentinel       }
  if (addrs.SentinelVault)  { process.env.SENTINEL_VAULT  = addrs.SentinelVault;  CONTRACT.SENTINEL_VAULT  = addrs.SentinelVault  }
  if (addrs.SentinelGuard)  { process.env.SENTINEL_GUARD  = addrs.SentinelGuard;  CONTRACT.SENTINEL_GUARD  = addrs.SentinelGuard  }
  if (addrs.SentinelOracle) { process.env.SENTINEL_ORACLE = addrs.SentinelOracle; CONTRACT.SENTINEL_ORACLE = addrs.SentinelOracle }
  if (addrs.SentinelSignal) { process.env.SENTINEL_SIGNAL = addrs.SentinelSignal; CONTRACT.SENTINEL_SIGNAL = addrs.SentinelSignal }
}

async function deployOne(name, args) {
  const c = compiled[name]
  if (!c) throw new Error(`${name} not compiled`)
  const fee      = await provider.getFeeData()
  const rawGas   = fee.gasPrice || ethers.parseUnits('30', 'gwei')
  const capGas   = ethers.parseUnits('1000', 'gwei')
  const gasPrice = (rawGas > capGas ? capGas : rawGas) * 130n / 100n
  const factory  = new ethers.ContractFactory(c.abi, c.bytecode, signer)
  const contract = await factory.deploy(...args, { gasLimit: 3_000_000, gasPrice })
  const receipt  = await contract.deploymentTransaction().wait(2)
  const address  = await contract.getAddress()
  if (!receipt?.status) throw new Error(`${name} reverted`)
  console.log(`[DEPLOYER] ${name} → ${address}`)
  return { address, contract }
}

async function deployAll(SAB, HOT) {
  const addrs = {}
  const order = [
    { name: 'SentinelVault',  args: [TREASURY] },
    { name: 'SentinelGuard',  args: []         },
    { name: 'SentinelOracle', args: []         },
    { name: 'SentinelSignal', args: []         },
    { name: 'Sentinel',       args: [TREASURY] },
  ]

  for (const { name, args } of order) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { address } = await deployOne(name, args)
        addrs[name] = address
        break
      } catch (e) {
        console.log(`[DEPLOYER] ${name} attempt ${attempt}/3: ${e.message?.slice(0, 80)}`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 8_000))
        else if (name === 'Sentinel') return false
      }
    }
  }

  // Link companions
  if (addrs.Sentinel) {
    try {
      const s   = new ethers.Contract(addrs.Sentinel, compiled.Sentinel.abi, signer)
      const fee = await provider.getFeeData()
      const gp  = fee.gasPrice || ethers.parseUnits('30', 'gwei')
      await (await s.setCompanions(
        addrs.SentinelVault  || ethers.ZeroAddress,
        addrs.SentinelGuard  || ethers.ZeroAddress,
        addrs.SentinelOracle || ethers.ZeroAddress,
        addrs.SentinelSignal || ethers.ZeroAddress,
        { gasLimit: 200_000, gasPrice: gp }
      )).wait(1)
      console.log('[DEPLOYER] Companions linked')
    } catch (e) { console.log(`[DEPLOYER] Link: ${e.message?.slice(0, 60)}`) }
  }

  // Set sentinel on vault
  if (addrs.SentinelVault && addrs.Sentinel) {
    try {
      const v   = new ethers.Contract(addrs.SentinelVault, compiled.SentinelVault.abi, signer)
      const fee = await provider.getFeeData()
      const gp  = fee.gasPrice || ethers.parseUnits('30', 'gwei')
      await (await v.setSentinel(addrs.Sentinel, { gasLimit: 100_000, gasPrice: gp })).wait(1)
    } catch {}
  }

  // Set sentinel on guard
  if (addrs.SentinelGuard && addrs.Sentinel) {
    try {
      const g   = new ethers.Contract(addrs.SentinelGuard, compiled.SentinelGuard.abi, signer)
      const fee = await provider.getFeeData()
      const gp  = fee.gasPrice || ethers.parseUnits('30', 'gwei')
      await (await g.setSentinel(addrs.Sentinel, { gasLimit: 100_000, gasPrice: gp })).wait(1)
    } catch {}
  }

  inject(addrs)
  save({ ...addrs, deployedAt: Date.now() })
  HOT[H.CONTRACTS]  = Object.values(addrs).filter(v => typeof v === 'string' && ethers.isAddress(v)).length
  HOT[H.DEPLOYMENT] = 1
  console.log(`[DEPLOYER] ${HOT[H.CONTRACTS]} contracts live`)
  return true
}

export function startDeployer(SAB) {
  const HOT = new Float64Array(SAB)
  const existing = load()
  if (existing.Sentinel && ethers.isAddress(existing.Sentinel)) {
    inject(existing)
    HOT[H.CONTRACTS]  = Object.values(existing).filter(v => typeof v === 'string' && ethers.isAddress(v)).length
    HOT[H.DEPLOYMENT] = 1
    console.log(`[DEPLOYER] Contracts restored | Sentinel: ${existing.Sentinel}`)
    return
  }
  let attempts = 0
  const tryCompile = () => {
    attempts++
    if (precompile()) { ready = true; watchPOL(SAB, HOT) }
    else if (attempts < 5) setTimeout(tryCompile, 30_000)
    else console.log('[DEPLOYER] Compilation failed after 5 attempts')
  }
  tryCompile()
}

function watchPOL(SAB, HOT) {
  let deploying = false, lastLog = -1
  const iv = setInterval(async () => {
    if (deploying || !ready) return
    try {
      const bal     = await provider.getBalance(EXECUTOR)
      const pol     = parseFloat(ethers.formatEther(bal))
      const rounded = Math.floor(pol * 100) / 100
      if (rounded !== lastLog && pol > 0 && pol < 0.1) {
        lastLog = rounded
        console.log(`[DEPLOYER] ${pol.toFixed(4)} POL | need 0.1`)
      }
      if (pol >= 0.1) {
        deploying = true
        clearInterval(iv)
        console.log(`[DEPLOYER] ${pol.toFixed(4)} POL — deploying SENTINEL`)
        const ok = await deployAll(SAB, HOT)
        if (!ok) setTimeout(() => watchPOL(SAB, HOT), 60_000)
      }
    } catch {}
  }, 500)
  console.log(`[DEPLOYER] Watching for 0.1 POL at ${EXECUTOR}`)
}
