// server/db.js —— 极简 JSON 单文件数据库（零依赖，适合单店规模）
// 写入采用「临时文件 + 重命名」的原子方式，避免掉电/并发写坏文件。
const fs = require('fs')
const path = require('path')
const config = require('./config')

const STATUS = {
  PENDING: 'pending',
  ARRIVED: 'arrived',
  DONE: 'done',
  CANCELED: 'canceled',
}

// 初始种子数据（与小程序本地版示例数据一致）
function seed() {
  return {
    store: {
      name: '南松推拿馆',
      slogan: '松身 · 松心 · 松生活',
      desc: '清名桥畔的安静推拿小馆。两位资深技师坐镇，古法手法、松而不痛。支持在线预约，到店即享。',
      address: '无锡市梁溪区清名桥街道岸芷澜庭 22-3',
      lat: 31.5525,
      lng: 120.3095,
      phones: ['13382896845', '13621502203'],
      hours: '每日 9:30 - 21:30',
    },
    banners: [
      { tag: '南松推拿馆', title: '古法推拿', sub: '清名桥畔 · 岸芷澜庭', theme: 'green' },
      { tag: '专业技师', title: '手法到位 · 松而不痛', sub: '两位资深技师坐镇', theme: 'gold' },
      { tag: '便捷预约', title: '在线一键约', sub: '到店即享 · 无需排队', theme: 'ink' },
    ],
    techs: [
      {
        id: 'th1', name: '王师傅', gender: 'm',
        title: '资深推拿师 · 从业 12 年',
        desc: '擅长经络推拿与艾灸，力道沉稳，循经取穴，做完通体轻快。',
        tags: ['经络推拿', '艾灸'], avatar: '', status: 'on',
      },
      {
        id: 'th2', name: '李师傅', gender: 'm',
        title: '资深推拿师 · 从业 10 年',
        desc: '擅长肩颈松解，手法细致，久坐办公的肩背僵硬交给他最合适。',
        tags: ['肩颈松解', '推拿'], avatar: '', status: 'on',
      },
    ],
    services: [
      { id: 'sv1', category: '按摩', name: '15 分钟按摩', price: 29, duration: 15, desc: '快速放松肩颈腰背，时间紧张之选。', on: true },
      { id: 'sv2', category: '按摩', name: '30 分钟按摩', price: 49, duration: 30, desc: '针对酸痛点集中松解，最常选的时长。', on: true },
      { id: 'sv3', category: '按摩', name: '60 分钟按摩', price: 88, duration: 60, desc: '全身系统调理，从头到脚松一遍。', on: true },
      { id: 'sv4', category: '按摩', name: '90 分钟按摩', price: 128, duration: 90, desc: '深度放松，重度疲劳人群推荐。', on: true },
      { id: 'sv5', category: '艾灸', name: '30 分钟艾灸', price: 68, duration: 30, desc: '温通经络，驱寒祛湿，适合怕凉体质。', on: true },
    ],
    slots: { open: '9:30', close: '21:30', stepMin: 15 },
    bookings: [],
    users: {},      // openid -> { phone, nickname, avatarUrl }
    sessions: {},   // token  -> { openid, createdAt }
    adminTokens: {},// token  -> { createdAt }
    risk: {},       // 风控数据（黑名单 / 爽约计数 / 号码归属），字段由 risk.js 惰性补齐
  }
}

const storage = require('./storage')

let cache = null

// 由远端（对象存储）载入的数据直接注入内存，优先级高于本地文件
function prime(obj) {
  if (!obj || typeof obj !== 'object') return
  const s = seed()
  for (const k of Object.keys(s)) if (obj[k] === undefined) obj[k] = s[k]
  cache = obj
}

function load() {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(config.dataFile, 'utf8')
    cache = JSON.parse(raw)
    // 兼容旧文件缺字段
    const s = seed()
    for (const k of Object.keys(s)) if (cache[k] === undefined) cache[k] = s[k]
  } catch (e) {
    cache = seed()
    save()
  }
  return cache
}

let saving = false
function save() {
  const tmp = config.dataFile + '.tmp'
  const json = cache ? JSON.stringify(cache, null, 2) : '{}'
  try {
    fs.mkdirSync(path.dirname(config.dataFile), { recursive: true })
    fs.writeFileSync(tmp, json, 'utf8')
    fs.renameSync(tmp, config.dataFile)
  } catch (e) {
    // 挂载盘（COS / CFS 的 FUSE 文件系统）常常不支持 rename 或权限受限，
    // 这时退化为直接覆盖写，宁可少一层原子性，也不能一条单都存不下。
    try {
      fs.mkdirSync(path.dirname(config.dataFile), { recursive: true })
      fs.writeFileSync(config.dataFile, json, 'utf8')
    } catch (e2) {
      if (!saving) { saving = true; console.error('[db] 保存失败:', e.message, '| 回退也失败:', e2.message) }
    }
  }
  // 云托管容器不可持久化：同步推送到对象存储（异步、失败不阻断）
  if (cache) storage.write(json)
}

function db() { return load() }
function flush() { save() }

// —— 小工具 ——
function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function activeTechs() {
  return db().techs.filter(function (t) { return t.status === 'on' })
}

module.exports = { db, flush, save, prime, genId, activeTechs, STATUS, seed }
