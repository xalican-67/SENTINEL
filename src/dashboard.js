// dashboard.js — SENTINEL 15-tab dashboard
// WebSocket shim injected server-side — fixes ws:// on Railway HTTPS
// Broadcasts live state every 500ms

import { createRequire }  from 'module'
import { createServer }   from 'http'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath }  from 'url'
import path               from 'path'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const _req  = createRequire(import.meta.url)
const express             = _req(path.join(__dir, 'node_modules/express'))
const { WebSocketServer } = _req(path.join(__dir, 'node_modules/ws'))

import {
  H, PORT, SYSTEM, VERSION, EXECUTOR, TREASURY,
  CONTRACT, CHAINS, PROPELLER, FLASH_CONFIG,
  TOTAL_BLOCKS_DAY, CHECK,
} from './src/config.js'
import { activatePropeller, getPropellerStats, getProgress, getCeilingPct } from './src/propeller.js'
import { getBundleStats }   from './src/bundle.js'
import { getSignalLog }     from './src/signals.js'
import { getStrategyStats } from './src/strategies.js'
import { getBlockStats }    from './src/scheduler.js'
import { reconcile }        from './src/reconciler.js'
import { send as mpSend, calcFee, networks } from './src/adapters/modempay.js'

// ── WEBSOCKET SHIM — fixes ws:// → wss:// on Railway HTTPS ──────────────────
const WS_SHIM = `<script>;(function(){
  var _WS = window.WebSocket;
  window.WebSocket = function(url, proto) {
    if (location.protocol === 'https:' && url && url.indexOf('ws://') === 0)
      url = url.replace('ws://', 'wss://');
    return proto ? new _WS(url, proto) : new _WS(url);
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = _WS.CONNECTING;
  window.WebSocket.OPEN = _WS.OPEN;
  window.WebSocket.CLOSING = _WS.CLOSING;
  window.WebSocket.CLOSED = _WS.CLOSED;
})();</script>`

let SAB_REF = null
const WS_CLIENTS = new Set()
const hot = () => SAB_REF ? new Float64Array(SAB_REF) : null

function fmtUSD(n) {
  if (!n || n === 0) return '$0'
  if (n >= 1e12) return '$' + (n/1e12).toFixed(4) + 'T'
  if (n >= 1e9)  return '$' + (n/1e9).toFixed(4) + 'B'
  if (n >= 1e6)  return '$' + (n/1e6).toFixed(4) + 'M'
  if (n >= 1e3)  return '$' + (n/1e3).toFixed(2) + 'K'
  return '$' + n.toFixed(2)
}

function fullState() {
  const H2 = hot()
  if (!H2) return { type: 'state', ts: Date.now(), booting: true }
  return {
    type: 'state', ts: Date.now(),
    // Revenue
    revToday:    H2[H.REV_TODAY],
    revTotal:    H2[H.REV_TOTAL],
    netToday:    H2[H.NET_TODAY],
    revFmt:      fmtUSD(H2[H.REV_TODAY] || 0),
    // Cycles
    cyclesToday:  H2[H.CYCLES_TODAY]  | 0,
    cyclesTotal:  H2[H.CYCLES_TOTAL]  | 0,
    cyclesMax:    H2[H.CYCLES_MAX]    | 0,
    successToday: H2[H.SUCCESS_TODAY] | 0,
    failToday:    H2[H.FAIL_TODAY]    | 0,
    skipToday:    H2[H.SKIP_TODAY]    | 0,
    execSpeed:    H2[H.EXEC_SPEED]    || 0,
    // Flash
    flashLive:     H2[H.FLASH_LIVE]     || 0,
    flashBalancer: H2[H.FLASH_BALANCER] || 0,
    flashAave:     H2[H.FLASH_AAVE]     || 0,
    flashConfig:   FLASH_CONFIG,
    // Gas
    gasPrice: H2[H.GAS_PRICE] || 0,
    gasOK:    H2[H.GAS_OK] === 1,
    gasSpent: H2[H.GAS_SPENT] || 0,
    // 7-point checks
    checks: {
      c1: H2[H.CHECK1_PASS] | 0,
      c2: H2[H.CHECK2_PASS] | 0,
      c3: H2[H.CHECK3_PASS] | 0,
      c4: H2[H.CHECK4_PASS] | 0,
      c5: H2[H.CHECK5_PASS] | 0,
      c6: H2[H.CHECK6_PASS] | 0,
      c7: H2[H.CHECK7_PASS] | 0,
    },
    // Propeller
    propeller:      'P' + (H2[H.PROPELLER] | 0 || 10),
    propellerNum:   H2[H.PROPELLER] | 0,
    dailyTarget:    H2[H.DAILY_TARGET] || 0,
    progress:       getProgress(H2),
    ceilingPct:     getCeilingPct(H2),
    propellerStats: getPropellerStats(),
    // Treasury
    vaultConfirmed: H2[H.VAULT_CONFIRMED]  || 0,
    vaultComputed:  H2[H.VAULT_COMPUTED]   || 0,
    reconcileScore: H2[H.RECONCILE_SCORE]  || 100,
    firstRev:       H2[H.FIRST_REV] === 1,
    // Oracle
    oracleETH:   H2[H.ORACLE_ETH]   || 0,
    oracleBTC:   H2[H.ORACLE_BTC]   || 0,
    oracleMATIC: H2[H.ORACLE_MATIC] || 0,
    // Recycler
    recyclerBal: H2[H.RECYCLER_BAL] || 0,
    // System
    deployment:  H2[H.DEPLOYMENT] === 1,
    contracts:   H2[H.CONTRACTS]   | 0,
    uptime:      H2[H.UPTIME]      | 0,
    mb:          H2[H.MB]          | 0,
    chainCount:  H2[H.CHAIN_COUNT] | 0,
    executor:    EXECUTOR,
    treasury:    TREASURY,
    contractAddrs: CONTRACT,
    totalBlocksDay: TOTAL_BLOCKS_DAY,
    // Chains
    chainStates: Object.fromEntries(
      CHAINS.map(c => [c.name, H2[H['C_' + c.name.toUpperCase()]] === 1])
    ),
    // MEV breakdown
    mevStats: getStrategyStats(H2),
    // Bundles
    bundleStats: getBundleStats(H2),
    // Signal log
    signalLog: getSignalLog(20),
    // Block stats
    blockStats: getBlockStats(H2),
    version: VERSION,
    wsClients: WS_CLIENTS.size,
  }
}

function broadcast(data) {
  const p = JSON.stringify(data)
  for (const ws of WS_CLIENTS) {
    if (ws.readyState === 1) try { ws.send(p) } catch { WS_CLIENTS.delete(ws) }
  }
}

setInterval(() => { if (WS_CLIENTS.size > 0) broadcast(fullState()) }, 500)

const app = express()
const srv = createServer(app)
const wss = new WebSocketServer({ server: srv, perMessageDeflate: false })

app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dir, 'dashboard')))

// ROOT — inject WS shim before </head> (fixes Railway HTTPS ws://)
app.get('/', (_, res) => {
  const p = path.join(__dir, 'dashboard/sentinel.html')
  if (!existsSync(p)) return res.status(404).send('sentinel.html missing')
  const html = readFileSync(p, 'utf8').replace('</head>', WS_SHIM + '</head>')
  res.setHeader('Content-Type', 'text/html')
  res.send(html)
})

app.get('/ping', (_, res) => {
  const H2 = hot()
  res.json({
    ok: true, system: SYSTEM, version: VERSION,
    uptime: H2?.[H.UPTIME] | 0,
    deployed: H2?.[H.DEPLOYMENT] === 1,
    chains: H2?.[H.CHAIN_COUNT] | 0,
    propeller: 'P' + (H2?.[H.PROPELLER] | 0 || 10),
  })
})

app.get('/api/state',    (_, res) => res.json(fullState()))
app.get('/api/signals',  (_, res) => res.json(getSignalLog(100)))
app.get('/api/propeller',(_, res) => res.json(getPropellerStats()))

// Propeller control
app.post('/api/propeller', (req, res) => {
  const { level } = req.body
  const H2 = hot(); if (!H2) return res.status(503).json({ error: 'not ready' })
  const ok = activatePropeller(level, H2)
  res.json({ ok, level, target: PROPELLER[level]?.target, maxCycles: PROPELLER[level]?.maxCycles })
})

// Executor control
app.post('/api/executor/pause',  (_, res) => {
  const H2 = hot(); if (!H2) return res.status(503).json({ error: 'not ready' })
  H2[H.GAS_OK] = 0; res.json({ ok: true, status: 'paused' })
})
app.post('/api/executor/resume', (_, res) => {
  const H2 = hot(); if (!H2) return res.status(503).json({ error: 'not ready' })
  H2[H.GAS_OK] = 1; res.json({ ok: true, status: 'resumed' })
})

// Force reconcile
app.post('/api/reconcile', async (_, res) => {
  const H2 = hot(); if (!H2) return res.status(503).json({ error: 'not ready' })
  await reconcile(H2)
  res.json({ ok: true, confirmed: H2[H.VAULT_CONFIRMED], computed: H2[H.VAULT_COMPUTED], score: H2[H.RECONCILE_SCORE] })
})

// FTW quote
app.post('/api/ftw/quote', (req, res) => {
  const { amount, network } = req.body
  if (!amount) return res.status(400).json({ error: 'amount required' })
  res.json({ ...calcFee(parseFloat(amount), network || 'wave'), ts: Date.now() })
})

// FTW withdraw
app.post('/api/ftw/withdraw', async (req, res) => {
  const { amount, type, phone, accountNumber, accountName, swiftCode, network, address } = req.body
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount required' })
  const key = process.env.MODEMPAY_SECRET_KEY || ''
  if (!key) return res.status(400).json({ error: 'MODEMPAY_SECRET_KEY not set in Railway env' })
  try {
    const result = await mpSend(key, { type, amount: parseFloat(amount), phone, accountNumber, accountName, swiftCode, network, address })
    broadcast({ type: 'ftw', amount, network: result.network })
    res.json({ ok: true, ...result })
  } catch (e) { res.status(500).json({ error: e.message?.slice(0,120) }) }
})

app.get('/api/ftw/networks', (_, res) => res.json(networks()))

wss.on('connection', ws => {
  WS_CLIENTS.add(ws)
  try { ws.send(JSON.stringify(fullState())) } catch {}
  ws.on('close', () => WS_CLIENTS.delete(ws))
  ws.on('error', () => WS_CLIENTS.delete(ws))
})

export function startDashboard(SAB) {
  SAB_REF = SAB
  srv.listen(PORT, () => {
    console.log(`[DASHBOARD] SENTINEL :${PORT} | 15 tabs | WS shim active | /ping`)
  })
}
