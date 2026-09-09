// src/compile.js — SENTINEL one-shot compiler subprocess
// Hard heap cap: 250MB (set by deployer fork execArgv)
// Sequential — one contract at a time, GC between each
// Exits after writing artifacts — main process never loads solc

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { ethers }        from 'ethers'

const require   = createRequire(import.meta.url)
const COMP_PATH = '/data/sentinel_compiled.json'
const ADDR_PATH = '/data/sentinel_contracts.json'

const SOURCES = [
  { name: 'SentinelVault',  path: './contracts/SentinelVault.sol',  critical: false },
  { name: 'SentinelGuard',  path: './contracts/SentinelGuard.sol',  critical: false },
  { name: 'SentinelOracle', path: './contracts/SentinelOracle.sol', critical: false },
  { name: 'SentinelSignal', path: './contracts/SentinelSignal.sol', critical: false },
  { name: 'SentinelFlash',  path: './contracts/SentinelFlash.sol',  critical: false },
  { name: 'Sentinel',       path: './contracts/Sentinel.sol',        critical: true  },
]

const ASCII_MAP = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00A0\u200B\u202F\u2009\u2008\u2007\u2006\u2005\u2004\u2003\u2002\u2001\u2000]/g, ' '],
  [/[\u200C\u200D\uFEFF]/g, ''],
  [/\u00D7/g, '*'],
  [/\u00F7/g, '/'],
  [/[^\x00-\x7F]/g, ''],
]

function sanitize(source) {
  let s = source
  for (const [pattern, replacement] of ASCII_MAP) s = s.replace(pattern, replacement)
  return s
}

function gc() {
  if (global.gc) { global.gc(); global.gc() }
}

function send(msg) {
  try { process.send?.(msg) } catch {}
}

function compileSingle(name, filePath) {
  if (!existsSync(filePath)) {
    send({ type: 'missing', name })
    return null
  }

  gc()

  let solc, source
  try { solc = require('solc') } catch (e) {
    send({ type: 'error', name, msg: `solc load: ${e.message?.slice(0, 40)}` })
    return null
  }

  try { source = readFileSync(filePath, 'utf8') } catch (e) {
    send({ type: 'error', name, msg: `read: ${e.message?.slice(0, 40)}` })
    return null
  }

  source = sanitize(source)

  const input = JSON.stringify({
    language: 'Solidity',
    sources:  { [`${name}.sol`]: { content: source } },
    settings: {
      viaIR:           true,
      optimizer:       { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  })

  let out
  try { out = JSON.parse(solc.compile(input)) } catch (e) {
    send({ type: 'error', name, msg: e.message?.slice(0, 100) })
    gc(); return null
  }

  const fatals = (out.errors || []).filter(e => e.severity === 'error')
  if (fatals.length) {
    fatals.forEach(f => send({ type: 'error', name, msg: f.formattedMessage?.slice(0, 160) }))
    out = null; gc(); return null
  }

  const c = out.contracts?.[`${name}.sol`]?.[name]
  if (!c?.evm?.bytecode?.object || c.evm.bytecode.object.length < 10) {
    send({ type: 'error', name, msg: 'empty bytecode' })
    out = null; gc(); return null
  }

  const result = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }
  out = null; source = null; gc()
  return result
}

async function main() {
  if (existsSync(ADDR_PATH)) {
    try {
      const d = JSON.parse(readFileSync(ADDR_PATH, 'utf8'))
      if (d.Sentinel && ethers.isAddress(d.Sentinel)) {
        send({ type: 'already_deployed', data: d })
        process.exit(0)
        return
      }
    } catch {}
  }

  send({ type: 'start', count: SOURCES.length })

  const compiled = {}

  for (const { name, path: fp, critical } of SOURCES) {
    await new Promise(r => setTimeout(r, 600))

    const result = compileSingle(name, fp)

    if (result) {
      compiled[name] = result
      send({ type: 'compiled', name })
    } else {
      if (critical) send({ type: 'critical_fail', name })
    }

    if (Object.keys(compiled).length % 2 === 0) {
      await new Promise(r => setTimeout(r, 400))
      gc()
    }
  }

  const count = Object.keys(compiled).length
  send({ type: 'done', count, names: Object.keys(compiled) })

  if (!compiled['Sentinel']) {
    send({ type: 'fatal', msg: 'Sentinel.sol failed to compile — cannot deploy' })
    process.exit(1)
    return
  }

  if (!existsSync('/data')) mkdirSync('/data', { recursive: true })
  writeFileSync(COMP_PATH, JSON.stringify(compiled))
  send({ type: 'written', path: COMP_PATH, count })

  gc(); gc()
  process.exit(0)
}

main().catch(e => {
  send({ type: 'fatal', msg: e.message?.slice(0, 100) })
  process.exit(1)
})
