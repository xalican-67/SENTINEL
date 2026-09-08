// src/chains.js — SENTINEL chain monitor (Worker)
// WebSocket to all 20 chains
// Block detection — fires executor per block
// Also detects qualifying swaps for MEV targeting

import { workerData, parentPort } from 'worker_threads'
import { WebSocket }              from 'ws'
import { CHAINS, H, CHAIN_HOT }  from './config.js'

const SAB = workerData.SAB
const HOT = new Float64Array(SAB)

const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
const MIN_SWAP_USD = 50_000  // $50K minimum qualifying swap

let connected = 0

function connectChain(chain) {
  if (!chain.ws) return
  const hotKey = CHAIN_HOT[chain.name]
  let ws, pingTimer

  function connect() {
    try {
      ws = new WebSocket(chain.ws)

      ws.on('open', () => {
        connected++
        HOT[H.CHAIN_COUNT] = connected
        if (hotKey !== undefined) HOT[hotKey] = 1

        // Subscribe to new blocks
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_subscribe',
          params: ['newHeads'],
        }))

        // Subscribe to Uniswap V3 swaps for MEV targeting
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 2,
          method: 'eth_subscribe',
          params: ['logs', { topics: [SWAP_TOPIC] }],
        }))

        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping()
        }, 30_000)
      })

      ws.on('message', raw => {
        try {
          const msg = JSON.parse(raw)
          if (!msg?.params?.result) return

          const result = msg.params.result

          // New block — signal executor
          if (result.number) {
            parentPort?.postMessage({ type: 'block', chain: chain.name, block: result.number })
            return
          }

          // Swap log — MEV opportunity
          if (result.topics?.[0] === SWAP_TOPIC) {
            const data = result.data || '0x'
            if (data.length >= 130) {
              const amount0Hex = data.slice(2, 66)
              const absAmt     = BigInt('0x' + amount0Hex)
              const usdEst     = Number(absAmt < 0n ? -absAmt : absAmt) / 1e6
              if (usdEst >= MIN_SWAP_USD) {
                parentPort?.postMessage({
                  type: 'swap', chain: chain.name, usd: usdEst,
                  txHash: result.transactionHash,
                })
              }
            }
          }
        } catch {}
      })

      ws.on('pong', () => {})
      ws.on('close', () => {
        connected = Math.max(0, connected - 1)
        HOT[H.CHAIN_COUNT] = connected
        if (hotKey !== undefined) HOT[hotKey] = 0
        clearInterval(pingTimer)
        setTimeout(connect, 5_000)
      })
      ws.on('error', () => { clearInterval(pingTimer); try { ws.terminate() } catch {} })
    } catch { setTimeout(connect, 10_000) }
  }
  connect()
}

for (const chain of CHAINS) {
  setTimeout(() => connectChain(chain), Math.random() * 2000)
}

console.log(`[CHAINS] Connecting ${CHAINS.length} chains | blocks + swap detection`)
