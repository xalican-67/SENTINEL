// src/adapters/modempay.js — SENTINEL withdrawal bridge

import { randomUUID } from 'crypto'

const BASE = key => key?.startsWith('sk_live_')
  ? 'https://api.modempay.com/v1'
  : 'https://api.test.modempay.com/v1'

const OPERATOR = 'SENTINEL | Bun Omar SECKA'
const FEES     = {
  wave: 0.015, afrimoney: 0.015, qmoney: 0.015,
  bank: 0.0125, international: 0.0125, crypto: 0.01,
}

function resolveNetwork(type, network) {
  if (network) return network
  if (!type)   return 'wave'
  if (type.includes('wave') || type.includes('mobile')) return 'wave'
  if (type.includes('afri'))   return 'afrimoney'
  if (type.includes('qmoney')) return 'qmoney'
  if (type.includes('bank'))   return 'bank'
  if (type.includes('intl') || type.includes('international')) return 'international'
  return 'wave'
}

export async function send(key, params) {
  const { type, amount, phone, accountNumber, accountName, swiftCode, address, network } = params
  if (!amount || amount <= 0) throw new Error('Invalid amount')
  if (!key) throw new Error('MODEMPAY_SECRET_KEY not configured')
  const net  = resolveNetwork(type, network)
  const rate = FEES[net] || 0.015
  const fee  = amount * rate
  const ref  = `${OPERATOR} | ${Date.now()}`
  const body = {
    amount, currency: 'GMD',
    account_number:   phone || accountNumber || address || '',
    network:          net,
    beneficiary_name: accountName || 'SENTINEL Treasury',
    reference:        ref, description: ref,
  }
  if (swiftCode) body.swift_code = swiftCode
  const r = await fetch(`${BASE(key)}/transfers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.message || d.error || `ModemPay ${r.status}`)
  return {
    ok: true, result: d, gross: amount,
    fee: +fee.toFixed(2), net: +(amount - fee).toFixed(2),
    rate: `${(rate * 100).toFixed(2)}%`, reference: ref, network: net, bridge: 'modempay',
  }
}

export function calcFee(amount, network = 'wave') {
  const rate = FEES[network] || 0.015
  return {
    gross: amount, fee: +(amount * rate).toFixed(2),
    net: +(amount * (1 - rate)).toFixed(2),
    rate: `${(rate * 100).toFixed(2)}%`, network,
  }
}

export function networks() {
  return Object.entries(FEES).map(([name, rate]) => ({
    name, fee: `${(rate * 100).toFixed(2)}%`,
  }))
}
