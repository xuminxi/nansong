// server/core.js —— 预约核心业务逻辑（时长占用制）
// 规则与小程序本地版完全一致：
//   · 预约占用时长 = 项目时长（如 90 分钟项目 15:00 开始 → 占用 15:00-16:30）
//   · 同一技师的区间不可重叠；结束时间恰好等于下一单开始时间不算冲突（半开区间 [start, end)）
//   · 开始时间 + 项目时长不得晚于打烊时间
//   · 两位技师排班相互独立，A 被预约不影响 B
const { db, flush, genId, activeTechs, STATUS } = require('./db')
const risk = require('./risk')

// —— 时间工具 ——
function hmToMin(hm) {
  const p = String(hm).split(':')
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10)
}
function minToHm(m) {
  const h = Math.floor(m / 60)
  const mi = m % 60
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0')
}
function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function nowHm() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// 每天所有可选开始时间（不含打烊时刻本身）
function genStartPoints(cfg) {
  const s = hmToMin(cfg.open)
  const e = hmToMin(cfg.close)
  const step = Number(cfg.stepMin) || 15
  const out = []
  for (let m = s; m < e; m += step) out.push(minToHm(m))
  return out
}

// 某技师某天的占用区间
function busyRanges(date, techId) {
  return db().bookings
    .filter(function (b) {
      return b.date === date && b.techId === techId && b.status !== STATUS.CANCELED
    })
    .map(function (b) {
      return { s: hmToMin(b.time), e: hmToMin(b.endTime || b.time) }
    })
}

// 半开区间 [s, e) 是否空闲
function techFree(date, techId, s, e) {
  return !busyRanges(date, techId).some(function (r) { return s < r.e && e > r.s })
}

// 某天的可约开始时间列表
// techId 为 'auto' 时按「任意一位技师可接」计算，freeCount 为可接人数
function availableTimes(date, techId, duration) {
  const cfg = db().slots
  const close = hmToMin(cfg.close)
  const today = fmtDate(new Date())
  const nowMin = hmToMin(nowHm())
  const techs = activeTechs()
  const points = genStartPoints(cfg)

  return points.map(function (time) {
    const s = hmToMin(time)
    const e = s + duration
    let disabled = false
    if (e > close) disabled = true                                  // 跨打烊
    else if (date < today) disabled = true                          // 已过去
    else if (date === today && s <= nowMin) disabled = true         // 今天且已过点

    let freeCount = 0
    if (!disabled) {
      if (techId && techId !== 'auto') {
        freeCount = techFree(date, techId, s, e) ? 1 : 0
      } else {
        freeCount = techs.filter(function (t) { return techFree(date, t.id, s, e) }).length
      }
      if (freeCount === 0) disabled = true
    }
    return { time: time, endTime: minToHm(e), freeCount: freeCount, disabled: disabled }
  })
}

// 空闲区间（技师页「今日空闲」用）
function freeRanges(date, techId) {
  const cfg = db().slots
  const open = hmToMin(cfg.open)
  const close = hmToMin(cfg.close)
  const busy = busyRanges(date, techId).sort(function (a, b) { return a.s - b.s })
  const out = []
  let cur = open
  for (const r of busy) {
    if (r.s > cur) out.push({ start: minToHm(cur), end: minToHm(Math.min(r.s, close)) })
    cur = Math.max(cur, r.e)
    if (cur >= close) break
  }
  if (cur < close) out.push({ start: minToHm(cur), end: minToHm(close) })
  return out
}

// 从空闲技师中随机挑一位
function pickFreeTech(date, time, duration) {
  const s = hmToMin(time)
  const e = s + duration
  const free = activeTechs().filter(function (t) { return techFree(date, t.id, s, e) })
  if (free.length === 0) return null
  return free[Math.floor(Math.random() * free.length)]
}

// 自动匹配最近可约（未来 7 天）
function autoMatchNearest(duration) {
  const days = 7
  const base = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime())
    d.setDate(d.getDate() + i)
    const date = fmtDate(d)
    const list = availableTimes(date, 'auto', duration)
    for (const t of list) {
      if (!t.disabled) {
        return { date: date, time: t.time, endTime: t.endTime, freeCount: t.freeCount }
      }
    }
  }
  return null
}

// 到店核销码：6 位数字，顾客报码 / 商家扫码核销，是判定「是否真实到店」的依据
function genCheckinCode() {
  const used = {}
  db().bookings.forEach(function (b) { if (b.code) used[b.code] = 1 })
  for (let i = 0; i < 50; i++) {
    const c = String(Math.floor(100000 + Math.random() * 900000))
    if (!used[c]) return c
  }
  return String(Date.now()).slice(-6)
}

// 创建预约
function createBooking(payload) {
  const svc = db().services.filter(function (s) { return s.id === payload.serviceId && s.on })[0]
  if (!svc) return { ok: false, msg: '该项目已下架或不存在' }
  if (!payload.date || !payload.time) return { ok: false, msg: '请选择预约日期与时段' }

  // 风控校验（身份锚点 openid + 行为频率 + 号码归属 + 黑名单）
  const rc = risk.check({
    openid: payload.openid,
    phone: payload.phone,
    date: payload.date,
  })
  if (!rc.ok) return { ok: false, msg: rc.msg, code: rc.code }

  const duration = svc.duration
  const start = hmToMin(payload.time)
  const end = start + duration
  const cfg = db().slots
  if (end > hmToMin(cfg.close)) {
    return { ok: false, msg: '该时段超出营业时间（' + cfg.open + ' - ' + cfg.close + '），请重新选择' }
  }

  // 技师分配：指定或自动
  let tech
  if (payload.techId && payload.techId !== 'auto') {
    tech = db().techs.filter(function (t) { return t.id === payload.techId })[0]
    if (!tech) return { ok: false, msg: '技师不存在' }
    if (!techFree(payload.date, tech.id, start, end)) {
      return { ok: false, msg: '该技师此时段已有预约，请换一个时段' }
    }
  } else {
    tech = pickFreeTech(payload.date, payload.time, duration)
    if (!tech) return { ok: false, msg: '该时段技师已约满' }
  }

  const now = Date.now()
  const b = {
    id: genId('bk'),
    code: genCheckinCode(),
    serviceId: svc.id,
    serviceName: svc.name,
    price: svc.price,
    duration: duration,
    techId: tech.id,
    techName: tech.name,
    date: payload.date,
    time: payload.time,
    endTime: minToHm(end),
    phone: String(payload.phone || ''),
    remark: String(payload.remark || ''),
    openid: payload.openid || '',
    status: STATUS.PENDING,
    createdAt: now,
    updatedAt: now,
  }
  db().bookings.push(b)
  // 登记号码归属（风控 R5）
  risk.commitPhone(payload.openid, b.phone)
  flush()
  return { ok: true, booking: b }
}

// 核销：用核销码把「待确认」直接置为「已到店」
function checkinByCode(code) {
  const c = String(code || '').trim()
  if (!c) return { ok: false, msg: '请输入核销码' }
  const b = db().bookings.filter(function (x) { return x.code === c })[0]
  if (!b) return { ok: false, msg: '核销码无效' }
  if (b.status === STATUS.CANCELED) return { ok: false, msg: '该预约已取消' }
  if (b.status === STATUS.DONE) return { ok: false, msg: '该预约已完成' }
  b.status = STATUS.ARRIVED
  b.updatedAt = Date.now()
  flush()
  return { ok: true, booking: b }
}

// 改状态。opts.noshow = true 表示「顾客未到店」，计入爽约并可能触发自动限制
function updateBookingStatus(id, status, opts) {
  if (![STATUS.PENDING, STATUS.ARRIVED, STATUS.DONE, STATUS.CANCELED].includes(status)) {
    return { ok: false, msg: '非法状态' }
  }
  const b = db().bookings.filter(function (x) { return x.id === id })[0]
  if (!b) return { ok: false, msg: '未找到该预约' }
  b.status = status
  b.updatedAt = Date.now()
  let punish = null
  if (opts && opts.noshow && b.openid) {
    punish = risk.markNoshow(b.openid)
  }
  flush()
  return { ok: true, booking: b, punish: punish }
}

// 顾客自助取消（只能取消自己的、且处于待确认）
// openid 存在时以 openid 为准校验归属（手机号可伪造，openid 不可）
function cancelBooking(id, phone, openid) {
  const list = db().bookings.filter(function (x) { return x.id === id })
  const b = list[0]
  if (!b) return { ok: false, msg: '未找到该预约' }
  if (openid) {
    if (b.openid !== openid) return { ok: false, msg: '只能取消自己的预约' }
  } else if (b.phone !== String(phone || '')) {
    return { ok: false, msg: '未找到该预约' }
  }
  if (b.status !== STATUS.PENDING) return { ok: false, msg: '当前状态不可取消' }
  b.status = STATUS.CANCELED
  b.updatedAt = Date.now()
  flush()
  return { ok: true }
}

module.exports = {
  hmToMin, minToHm, fmtDate, nowHm,
  genStartPoints, busyRanges, techFree, availableTimes, freeRanges,
  pickFreeTech, autoMatchNearest, createBooking, updateBookingStatus, cancelBooking,
  checkinByCode, genCheckinCode,
  STATUS,
}
