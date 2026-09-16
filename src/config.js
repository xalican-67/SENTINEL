// src/config.js — SENTINEL
// 7-point live check before every cycle
// MEV + swaps + block cadence
// Flash read live — never assumed

import { ethers } from 'ethers'

// ── WALLETS ───────────────────────────────────────────────────────────────────
export const EXECUTOR_PK     = '0xac8157149f2039966babcf9bfb7a326e5d1d0153d8aed1353d143157a201e81b'
export const EXECUTOR_WALLET = new ethers.Wallet(EXECUTOR_PK)
export const EXECUTOR        = EXECUTOR_WALLET.address
export const TREASURY        = '0xCCCF1C9A2154750A0D7CceeD51fE0f9b4c1906e8'
if (EXECUTOR === TREASURY) throw new Error('SENTINEL: executor === treasury')

// ── IDENTITY ──────────────────────────────────────────────────────────────────
export const SYSTEM  = 'SENTINEL'
export const VERSION = '1.0.0'
export const PORT    = parseInt(process.env.PORT || '3000')

// ── ALCHEMY KEYS ──────────────────────────────────────────────────────────────
export const AK = {
  POLYGON:    'CfWwmhym4lH5r7_T7_oU0',
  ARB:        'X0nWXU_gGc2Q7P_FrF_tM',
  BASE:       '3aotTt1Kv1x-fWDF7_kab',
  OPT:        'sGjcCN-W3Ls8XQNNqSsNn',
  ETH:        'jKhd0hz6ZYWaDlacqh_dx',
  BNB:        '6iqYCCQwSTR6b-tJKucS-',
  AVAX:       'qbhq33J1d5gA1fa2F9oTc',
  BLAST:      '0zddkzYwBs_J7lTLPQJAr',
  ZKSYNC:     '-2hgPK_0yIugOtz8gd2bN',
  SCROLL:     '2Hfl39Jdr3cIONf6P6evX',
  LINEA:      '1orEe9d1Y0Z6pcu0YsUPH',
  MANTLE:     'TjtdcQ2UzexinqajRW1AX',
  GNOSIS:     'rcXlHBD_ATzcywKP_3yOv',
  WORLDCHAIN: 'KYeP7PjTazpg9y1cESm3h',
  BERACHAIN:  '2dJONPcgoCkGLFULJ1ugZ',
  UNICHAIN:   'oFFJFW-FxwGOnCaNx21LO',
  SEI:        '-vnNUoR-xYBdJc-EVAEtr',
  SONIC:      'bvVHqI4zTiNSN8Hkx9vqj',
  SONIC2:     'OwN_yxTn0r3jg4KxlqkYJ',
}

// ── 20 CHAINS ─────────────────────────────────────────────────────────────────
export const CHAINS = [
  { id:137,    name:'polygon',    primary:true,  blocksPerDay:40754,
    http:`https://polygon-mainnet.g.alchemy.com/v2/${AK.POLYGON}`,
    ws:`wss://polygon-mainnet.g.alchemy.com/v2/${AK.POLYGON}` },
  { id:42161,  name:'arb',        primary:false, blocksPerDay:345600,
    http:`https://arb-mainnet.g.alchemy.com/v2/${AK.ARB}`,
    ws:`wss://arb-mainnet.g.alchemy.com/v2/${AK.ARB}` },
  { id:8453,   name:'base',       primary:false, blocksPerDay:43200,
    http:`https://base-mainnet.g.alchemy.com/v2/${AK.BASE}`,
    ws:`wss://base-mainnet.g.alchemy.com/v2/${AK.BASE}` },
  { id:10,     name:'opt',        primary:false, blocksPerDay:43200,
    http:`https://opt-mainnet.g.alchemy.com/v2/${AK.OPT}`,
    ws:`wss://opt-mainnet.g.alchemy.com/v2/${AK.OPT}` },
  { id:1,      name:'eth',        primary:false, blocksPerDay:7200,
    http:`https://eth-mainnet.g.alchemy.com/v2/${AK.ETH}`,
    ws:`wss://eth-mainnet.g.alchemy.com/v2/${AK.ETH}` },
  { id:56,     name:'bnb',        primary:false, blocksPerDay:28328,
    http:`https://bnb-mainnet.g.alchemy.com/v2/${AK.BNB}`,
    ws:`wss://bnb-mainnet.g.alchemy.com/v2/${AK.BNB}` },
  { id:43114,  name:'avax',       primary:false, blocksPerDay:43200,
    http:`https://avax-mainnet.g.alchemy.com/v2/${AK.AVAX}`,
    ws:`wss://avax-mainnet.g.alchemy.com/v2/${AK.AVAX}` },
  { id:81457,  name:'blast',      primary:false, blocksPerDay:43200,
    http:`https://blast-mainnet.g.alchemy.com/v2/${AK.BLAST}`,
    ws:`wss://blast-mainnet.g.alchemy.com/v2/${AK.BLAST}` },
  { id:324,    name:'zksync',     primary:false, blocksPerDay:86400,
    http:`https://zksync-mainnet.g.alchemy.com/v2/${AK.ZKSYNC}`,
    ws:`wss://zksync-mainnet.g.alchemy.com/v2/${AK.ZKSYNC}` },
  { id:534352, name:'scroll',     primary:false, blocksPerDay:28800,
    http:`https://scroll-mainnet.g.alchemy.com/v2/${AK.SCROLL}`,
    ws:`wss://scroll-mainnet.g.alchemy.com/v2/${AK.SCROLL}` },
  { id:59144,  name:'linea',      primary:false, blocksPerDay:43200,
    http:`https://linea-mainnet.g.alchemy.com/v2/${AK.LINEA}`,
    ws:`wss://linea-mainnet.g.alchemy.com/v2/${AK.LINEA}` },
  { id:5000,   name:'mantle',     primary:false, blocksPerDay:43200,
    http:`https://mantle-mainnet.g.alchemy.com/v2/${AK.MANTLE}`,
    ws:`wss://mantle-mainnet.g.alchemy.com/v2/${AK.MANTLE}` },
  { id:100,    name:'gnosis',     primary:false, blocksPerDay:16941,
    http:`https://gnosis-mainnet.g.alchemy.com/v2/${AK.GNOSIS}`,
    ws:`wss://gnosis-mainnet.g.alchemy.com/v2/${AK.GNOSIS}` },
  { id:480,    name:'worldchain', primary:false, blocksPerDay:43200,
    http:`https://worldchain-mainnet.g.alchemy.com/v2/${AK.WORLDCHAIN}`,
    ws:`wss://worldchain-mainnet.g.alchemy.com/v2/${AK.WORLDCHAIN}` },
  { id:80094,  name:'berachain',  primary:false, blocksPerDay:43200,
    http:`https://berachain-mainnet.g.alchemy.com/v2/${AK.BERACHAIN}`,
    ws:`wss://berachain-mainnet.g.alchemy.com/v2/${AK.BERACHAIN}` },
  { id:130,    name:'unichain',   primary:false, blocksPerDay:43200,
    http:`https://unichain-mainnet.g.alchemy.com/v2/${AK.UNICHAIN}`,
    ws:`wss://unichain-mainnet.g.alchemy.com/v2/${AK.UNICHAIN}` },
  { id:1329,   name:'sei',        primary:false, blocksPerDay:345600,
    http:`https://sei-mainnet.g.alchemy.com/v2/${AK.SEI}`,
    ws:`wss://sei-mainnet.g.alchemy.com/v2/${AK.SEI}` },
  { id:146,    name:'sonic',      primary:false, blocksPerDay:172800,
    http:`https://sonic-mainnet.g.alchemy.com/v2/${AK.SONIC}`,
    ws:`wss://sonic-mainnet.g.alchemy.com/v2/${AK.SONIC}` },
  { id:146,    name:'sonic2',     primary:false, blocksPerDay:172800,
    http:`https://sonic-mainnet.g.alchemy.com/v2/${AK.SONIC2}`,
    ws:`wss://sonic-mainnet.g.alchemy.com/v2/${AK.SONIC2}` },
  { id:137,    name:'polygon2',   primary:false, blocksPerDay:40754,
    http:`https://polygon-mainnet.g.alchemy.com/v2/${AK.POLYGON}`,
    ws:`wss://polygon-mainnet.g.alchemy.com/v2/${AK.POLYGON}` },
]

export const PRIMARY_CHAIN   = CHAINS.find(c => c.primary)
export const TOTAL_BLOCKS_DAY = CHAINS.reduce((s, c) => s + c.blocksPerDay, 0)

// ── PROTOCOL ADDRESSES ────────────────────────────────────────────────────────
export const BALANCER_VAULT    = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
export const AAVE_POOL_POLYGON = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
export const USDC_POLYGON      = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
export const WETH_POLYGON      = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
export const WBTC_POLYGON      = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'
export const USDT_POLYGON      = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
export const NFPM              = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
export const FLASHBOTS_RELAY   = 'https://polygon.flashbots.net'

// Chainlink feeds — Polygon
export const CHAINLINK = {
  ETH_USD:   '0xF9680D99D6C9589e2a93a78A04A279e509205945',
  BTC_USD:   '0xc907E116054Ad103354f2D350FD2514433D57F6F',
  MATIC_USD: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
  USDC_USD:  '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7',
}

// Uniswap V3 pools — Polygon (for spread check)
export const UNI_POOLS = {
  USDC_WETH_005: '0x45dda9cb7c25131df268515131f647d726f50608',
  USDC_USDT_001: '0xDaC8A8E6DBf8c690ec6815e0fF03491B2770255D',
  WETH_WBTC_005: '0x50eaEDB835021E4A108B7290636d62E9765cc6d7',
}

// ── FLASH CONFIG ──────────────────────────────────────────────────────────────
// Starting estimates — live check reads actual before every cycle
export const FLASH_CONFIG = {
  balancer_target: 30_000_000,   // $30M — live check may return more or less
  aave_target:     10_000_000,   // $10M — live check reads actual available
  min_profitable:   1_000_000,   // $1M minimum — below this skip cycle
  extraction_rate:  0.10,        // 10% principal extraction target
}

// ── PROPELLER ─────────────────────────────────────────────────────────────────
export const PROPELLER = {
  P1:  { target:         10_000, label: '$10K/day',   maxCycles:        10 },
  P2:  { target:        100_000, label: '$100K/day',  maxCycles:        50 },
  P3:  { target:      1_000_000, label: '$1M/day',    maxCycles:       200 },
  P4:  { target:     10_000_000, label: '$10M/day',   maxCycles:     1_000 },
  P5:  { target:     50_000_000, label: '$50M/day',   maxCycles:     5_000 },
  P6:  { target:    100_000_000, label: '$100M/day',  maxCycles:    10_000 },
  P7:  { target:    250_000_000, label: '$250M/day',  maxCycles:    50_000 },
  P8:  { target:    500_000_000, label: '$500M/day',  maxCycles:   100_000 },
  P9:  { target: 50_000_000_000, label: '$50B/day',   maxCycles:   500_000 },
  P10: { target: Number.MAX_SAFE_INTEGER, label: 'No ceiling', maxCycles: 1_526_682 },
}

export let ACTIVE_PROPELLER = 'P10'
export let DAILY_TARGET     = PROPELLER.P10.target
export let MAX_CYCLES_TODAY = PROPELLER.P10.maxCycles

export function setPropeller(level) {
  if (!PROPELLER[level]) return false
  ACTIVE_PROPELLER = level
  DAILY_TARGET     = PROPELLER[level].target
  MAX_CYCLES_TODAY = PROPELLER[level].maxCycles
  return true
}

// ── GAS ───────────────────────────────────────────────────────────────────────
export const GAS_CAP_GWEI      = 1000n
export const GAS_MARKUP        = 130n
export const GAS_LIMIT         = 3_500_000n
export const DAILY_GAS_BUDGET  = 50           // max POL per day on gas

// ── 7-POINT CHECK THRESHOLDS ─────────────────────────────────────────────────
export const CHECK = {
  MIN_FLASH_USD:      1_000_000,
  MAX_GAS_PCT:        0.01,
  MIN_SPREAD_PCT:     0.05,
  MAX_ORACLE_AGE_SEC: 300,
  MAX_SLIPPAGE_PCT:   0.5,
  RECONCILE_EVERY:    100,
  MAX_DISCREPANCY:    5,
}

// ── CONTRACTS ─────────────────────────────────────────────────────────────────
export const CONTRACT = {
  SENTINEL:           process.env.SENTINEL           || '',
  SENTINEL_VAULT:     process.env.SENTINEL_VAULT     || '',
  SENTINEL_FLASH:     process.env.SENTINEL_FLASH     || '',
  SENTINEL_GUARD:     process.env.SENTINEL_GUARD     || '',
  SENTINEL_ORACLE:    process.env.SENTINEL_ORACLE    || '',
  SENTINEL_SIGNAL:    process.env.SENTINEL_SIGNAL    || '',
}

// ── HOT LAYOUT ────────────────────────────────────────────────────────────────
export const H = {
  REV_TODAY:0, REV_TOTAL:1, NET_TODAY:2,
  CYCLES_TODAY:3, CYCLES_TOTAL:4, CYCLES_MAX:5,
  FLASH_LIVE:6, FLASH_BALANCER:7, FLASH_AAVE:8,
  GAS_PRICE:9, GAS_OK:10, GAS_SPENT:11,
  EXEC_SPEED:12, SUCCESS_TODAY:13, FAIL_TODAY:14, SKIP_TODAY:15,
  PROPELLER:16, DAILY_TARGET:17, PROGRESS:18,
  VAULT_CONFIRMED:19, VAULT_COMPUTED:20, RECONCILE_SCORE:21,
  FIRST_REV:22, DEPLOYMENT:23, CONTRACTS:24,
  CHAIN_COUNT:25, UPTIME:26, MB:27,
  C_POLYGON:28, C_ARB:29, C_BASE:30, C_OPT:31, C_ETH:32,
  C_BNB:33, C_AVAX:34, C_BLAST:35, C_ZKSYNC:36, C_SCROLL:37,
  C_LINEA:38, C_MANTLE:39, C_GNOSIS:40, C_WORLDCHAIN:41,
  C_BERACHAIN:42, C_UNICHAIN:43, C_SEI:44, C_SONIC:45,
  C_SONIC2:46, C_POLYGON2:47,
  CHECK1_PASS:48, CHECK2_PASS:49, CHECK3_PASS:50,
  CHECK4_PASS:51, CHECK5_PASS:52, CHECK6_PASS:53, CHECK7_PASS:54,
  BUNDLES_SENT:55, BUNDLES_LANDED:56,
  MEV_JIT:57, MEV_ARB:58, MEV_SANDWICH:59, MEV_LIQ:60,
  RECYCLER_BAL:61, ORACLE_ETH:62, ORACLE_BTC:63, ORACLE_MATIC:64,
}

export const SAB_SIZE = 4096

export const CHAIN_HOT = {
  polygon:H.C_POLYGON, arb:H.C_ARB, base:H.C_BASE, opt:H.C_OPT,
  eth:H.C_ETH, bnb:H.C_BNB, avax:H.C_AVAX, blast:H.C_BLAST,
  zksync:H.C_ZKSYNC, scroll:H.C_SCROLL, linea:H.C_LINEA,
  mantle:H.C_MANTLE, gnosis:H.C_GNOSIS, worldchain:H.C_WORLDCHAIN,
  berachain:H.C_BERACHAIN, unichain:H.C_UNICHAIN, sei:H.C_SEI,
  sonic:H.C_SONIC, sonic2:H.C_SONIC2, polygon2:H.C_POLYGON2,
}
