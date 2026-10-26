// server/risk.js —— 预约风控（防虚假预约 / 防占坑 / 防恶意刷单）
//
// 设计前提：手机号只是「联系方式」，不是「身份证明」。
// 真正的身份锚点是 openid（一个微信号一个，微信官方保证唯一且无法批量伪造）。
// 所以本模块以 openid 为主线做限制，手机号作为辅助约束，
// 最后用「到店核销 / 爽约累计」做闭环——真实用户会到店，虚假预约不会。
//
// 规则一览（均可在商家后台「风控设置」里调整）：
//   R1 号码合法性   11 位 + 合法号段 + 明显虚假号（11111111111 之类）拦截
//   R2 下单冷却     同一微信号两次下单最小间隔
//   R3 未完成上限   同一微信号同时处于「待确认/已到店」的订单数上限
//   R4 每日上限     同一微信号每自然日下单数上限
//   R5 号码归属     一个手机号只能归属一个微信号（防止冒用他人号码下单）
//   R6 号码占坑     同一手机号同时未完成的订单数上限
//   R7 爽约惩罚     累计爽约达阈值 → 自动拉黑
//   R8 黑名单       商家可手动拉黑 / 解除（按微信号或手机号）
const { db, flush, STATUS } = require('./db')

const DEFAULT_CONFIG = {
  cooldownSec: 60,        // R2 两次下单最小间隔（秒）
  maxActive: 2,           // R3 同时未完成的订单数上限
  maxPerDay: 4,           // R4 每自然日下单上限（已取消的不计）
  maxPhonePerUser: 3,     // R5 一个微信号最多使用过的手机号数量
  maxActivePerPhone: 1,   // R6 同一手机号同时未完成的订单数上限
  noshowLimit: 3,         // R7 爽约达此数自动拉黑
  fakeDetect: true,       // R1 是否拦截明显虚假号码
  phoneBind: true,        // R5 是否启用手机号归属绑定
  enabled: true,          // 总开关（关掉后只做号码格式校验）
}

// 数据结构初始化（兼容旧数据文件缺字段）
function ensure() {
  const d = db()
  if (!d.risk) d.risk = {}
  const r = d.risk
  if (!r.config) r.config = {}
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (r.config[k] === undefined) r.config[k] = DEFAULT_CONFIG[k]
  }
  if (!r.blacklist) r.blacklist = {}   // key -> { reason, at, by }
  if (!r.noshow) r.noshow = {}         // openid -> 爽约次数
  if (!r.phoneOwner) r.phoneOwner = {} // phone -> openid
  if (!r.phonesOf) r.phonesOf = {}     // openid -> [phone]
  if (!r.events) r.events = []         // 最近风控事件
  return r
}

function cfg() { return ensure().config }

// —— 小工具 ——
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// 记录一条风控事件（只保留最近 200 条，避免数据文件无限增长）
function note(kind, openid, phone, msg) {
  const r = ensure()
  r.events.unshift({ at: Date.now(), kind: kind, openid: openid || '', phone: phone || '', msg: msg })
  if (r.events.length > 200) r.events.length = 200
}

// —— R1 号码合法性 ——
function validPhone(p) {
  const s = String(p || '').trim()
  if (!/^\d{11}$/.test(s)) return { ok: false, msg: '请填写 11 位手机号' }
  if (!/^1[3-9]\d{9}$/.test(s)) return { ok: false, msg: '手机号号段不正确' }
  return { ok: true }
}

// 明显虚假号：全同数字、连续递增/递减、常见占位号
function looksFake(p) {
  const s = String(p || '')
  if (/^(\d)\1{10}$/.test(s)) return true                       // 11111111111
  if (/^(12345678901|12345678900|13800138000|10000000000)$/.test(s)) return true
  let asc = true, desc = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) asc = false
    if (d !== -1) desc = false
  }
  if (asc || desc) return true                                   // 12345678901 / 98765432109
  // 尾号 4 位相同（0000/8888）不判定为假，仅记录，避免误伤
  return false
}

// —— R8 黑名单 ——
function blockKey(openid, phone) {
  return { o: 'oid:' + openid, p: 'tel:' + phone }
}
function isBlocked(openid, phone) {
  const r = ensure()
  const k = blockKey(openid || '', phone || '')
  return r.blacklist[k.o] || r.blacklist[k.p] || null
}
function block(target, reason, by) {
  const r = ensure()
  // target 形如 'oid:xxx' 或 'tel:138...'
  r.blacklist[target] = { reason: reason || '商家手动拉黑', at: Date.now(), by: by || 'admin' }
  flush()
  return true
}
function unblock(target) {
  const r = ensure()
  delete r.blacklist[target]
  flush()
  return true
}

// —— R7 爽约 ——
function markNoshow(openid) {
  if (!openid) return { noshow: 0, blocked: false }
  const r = ensure()
  const n = (r.noshow[openid] || 0) + 1
  r.noshow[openid] = n
  let blocked = false
  if (n >= Number(r.config.noshowLimit || DEFAULT_CONFIG.noshowLimit)) {
    block('oid:' + openid, '累计爽约 ' + n + ' 次，系统自动限制预约', 'system')
    blocked = true
  }
  note('noshow', openid, '', '爽约 +1（累计 ' + n + '）' + (blocked ? '，已自动限制' : ''))
  flush()
  return { noshow: n, blocked: blocked }
}

// —— 主校验：下单前调用 ——
// payload: { openid, phone, date }
function check(payload) {
  const r = ensure()
  const c = r.config
  const openid = String(payload.openid || '')
  const phone = String(payload.phone || '').trim()

  // R1 号码合法性（总开关关闭时也保留）
  const v = validPhone(phone)
  if (!v.ok) return { ok: false, code: 'PHONE', msg: v.msg }
  if (c.enabled && c.fakeDetect && looksFake(phone)) {
    note('fake', openid, phone, '疑似虚假号码')
    return { ok: false, code: 'PHONE', msg: '请填写真实手机号，否则无法联系您确认预约' }
  }

  if (!c.enabled) return { ok: true }

  // R8 黑名单
  const b = isBlocked(openid, phone)
  if (b) {
    note('blocked', openid, phone, '命中黑名单：' + b.reason)
    return { ok: false, code: 'BLOCKED', msg: b.reason + '。如需恢复请致电门店' }
  }

  if (!openid) {
    // 没有 openid 说明未走微信登录（本地版或异常调用），降级：只做手机号维度限制
    return checkByPhone(phone, c)
  }

  const mine = db().bookings.filter(function (x) { return x.openid === openid })
  const active = mine.filter(function (x) { return x.status === STATUS.PENDING || x.status === STATUS.ARRIVED })
  const today = todayStr()

  // R2 冷却
  const last = mine.reduce(function (m, x) { return Math.max(m, x.createdAt || 0) }, 0)
  const cd = Number(c.cooldownSec || 0) * 1000
  if (cd > 0 && last && Date.now() - last < cd) {
    const left = Math.ceil((cd - (Date.now() - last)) / 1000)
    note('cooldown', openid, phone, '下单过于频繁')
    return { ok: false, code: 'COOLDOWN', msg: '操作太快了，请 ' + left + ' 秒后再试' }
  }

  // R3 未完成上限
  if (active.length >= Number(c.maxActive)) {
    note('maxActive', openid, phone, '未完成订单 ' + active.length + ' 个')
    return { ok: false, code: 'MAX_ACTIVE', msg: '您还有 ' + active.length + ' 个未完成的预约，请先到店或取消后再预约' }
  }

  // R4 每日上限（按服务器本地日期切分）
  const todayLocal = mine.filter(function (x) {
    if (x.status === STATUS.CANCELED) return false
    const d = new Date(x.createdAt || 0)
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    return ds === today
  }).length
  if (todayLocal >= Number(c.maxPerDay)) {
    note('maxPerDay', openid, phone, '今日已下单 ' + todayLocal + ' 次')
    return { ok: false, code: 'MAX_DAY', msg: '今日预约已达上限（' + c.maxPerDay + ' 次），如需加约请致电门店' }
  }

  // R5 号码归属：一个手机号只能属于一个微信号
  if (c.phoneBind) {
    const owner = r.phoneOwner[phone]
    if (owner && owner !== openid) {
      note('phoneTaken', openid, phone, '手机号已归属其他账号')
      return { ok: false, code: 'PHONE_TAKEN', msg: '该手机号已被其他账号使用，请更换或致电门店' }
    }
    const used = r.phonesOf[openid] || []
    if (used.indexOf(phone) < 0 && used.length >= Number(c.maxPhonePerUser)) {
      note('maxPhone', openid, phone, '该账号已使用 ' + used.length + ' 个号码')
      return { ok: false, code: 'MAX_PHONE', msg: '一个账号最多使用 ' + c.maxPhonePerUser + ' 个手机号' }
    }
  }

  // R6 号码占坑：同一手机号同时未完成订单数
  const phoneActive = db().bookings.filter(function (x) {
    return x.phone === phone && (x.status === STATUS.PENDING || x.status === STATUS.ARRIVED)
  }).length
  if (phoneActive >= Number(c.maxActivePerPhone)) {
    note('phoneActive', openid, phone, '该手机号已有 ' + phoneActive + ' 个未完成预约')
    return { ok: false, code: 'PHONE_ACTIVE', msg: '该手机号已有未完成的预约，请先完成或取消' }
  }

  return { ok: true }
}

// 无 openid 时的降级校验（只按手机号维度）
function checkByPhone(phone, c) {
  const phoneActive = db().bookings.filter(function (x) {
    return x.phone === phone && (x.status === STATUS.PENDING || x.status === STATUS.ARRIVED)
  }).length
  if (phoneActive >= Number(c.maxActivePerPhone)) {
    return { ok: false, code: 'PHONE_ACTIVE', msg: '该手机号已有未完成的预约，请先完成或取消' }
  }
  return { ok: true }
}

// 下单成功后登记号码归属
function commitPhone(openid, phone) {
  const r = ensure()
  phone = String(phone || '').trim()
  if (!openid || !phone) return
  if (r.config.phoneBind) {
    if (!r.phoneOwner[phone]) r.phoneOwner[phone] = openid
    const used = r.phonesOf[openid] || []
    if (used.indexOf(phone) < 0) used.push(phone)
    r.phonesOf[openid] = used
  }
}

// 商家后台查看用
function summary() {
  const r = ensure()
  const list = Object.keys(r.blacklist).map(function (k) {
    return Object.assign({ key: k }, r.blacklist[k])
  }).sort(function (a, b) { return b.at - a.at })
  return {
    config: r.config,
    blacklist: list,
    noshow: r.noshow,
    events: r.events.slice(0, 50),
  }
}

module.exports = {
  DEFAULT_CONFIG, ensure, cfg, check, commitPhone, markNoshow,
  block, unblock, isBlocked, summary, validPhone, looksFake, todayStr, note,
}
