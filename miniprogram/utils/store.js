// utils/store.js — 本地数据层（南松推拿馆 · 时长占用模型）
// 说明：本版本不依赖任何后端，全部数据保存在用户手机的本机存储（wx storage）中。
// 时段模型：营业时间 9:30-21:30，项目按时长占用技师时间；
//   - 排班相互独立：技师 A 的预约不影响技师 B；
//   - 冲突校验：同一技师的时间段 [start, end) 不可重叠；
//   - 营业校验：不可跨营业时间（start >= 开门，end <= 打烊）。
// 未来接入云服务时，只需把 get/set 换成云数据库调用，页面层无需大改。

const util = require('./util')

// ———————— 存储键 ————————
const KEYS = {
  INIT: 'ns_init_v1',
  STORE: 'ns_store', // 店铺信息
  BANNERS: 'ns_banners', // 轮播图
  TECHS: 'ns_techs', // 技师
  SERVICES: 'ns_services', // 服务项目
  SLOTS: 'ns_slot_config', // 营业/时段设置
  BOOKINGS: 'ns_bookings', // 预约记录
  USER: 'ns_user', // 用户信息（登录态、手机号）
  ADMIN: 'ns_admin_session', // 商家登录态
}

// 商家后台登录密码（可按需修改，见 README）
const ADMIN_PASSWORD = 'admin888'

// 预约状态
const STATUS = {
  PENDING: 'pending',
  ARRIVED: 'arrived',
  DONE: 'done',
  CANCELED: 'canceled',
}
const STATUS_META = {
  pending: { text: '待确认', cls: 'badge-pending' },
  arrived: { text: '已到店', cls: 'badge-arrived' },
  done: { text: '已完成', cls: 'badge-done' },
  canceled: { text: '已取消', cls: 'badge-canceled' },
}

// 项目分类
const CATEGORIES = ['按摩', '艾灸']

// ———————— 基础读写 ————————
function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    if (v === '' || v === null || v === undefined) return fallback
    return v
  } catch (e) {
    console.error('storage get failed', e)
    return fallback
  }
}
function set(key, val) {
  try {
    wx.setStorageSync(key, val)
    return true
  } catch (e) {
    console.error('storage set failed', e)
    wx.showToast({ title: '本地保存失败，请重试', icon: 'none' })
    return false
  }
}

// ———————— 示例数据（首次启动写入，可在商家后台修改） ————————
const SEED = {
  store: {
    name: '南松推拿馆',
    slogan: '松身 · 松心 · 松生活',
    desc: '清名桥畔的安静推拿小馆。两位资深技师坐镇，古法手法、松而不痛。支持在线预约，到店即享。',
    address: '无锡市梁溪区清名桥街道岸芷澜庭 22-3',
    lat: 31.5525, // 经纬度用于地图导航，可在商家后台微调
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
      id: 'th1',
      name: '王师傅',
      gender: 'm',
      title: '资深推拿师 · 从业 12 年',
      desc: '擅长经络推拿与艾灸，力道沉稳，循经取穴，做完通体轻快。',
      tags: ['经络推拿', '艾灸'],
      avatar: '', // 头像图片路径，商家后台上传后持久保存
      status: 'on',
    },
    {
      id: 'th2',
      name: '李师傅',
      gender: 'm',
      title: '资深推拿师 · 从业 10 年',
      desc: '擅长肩颈松解，手法细致，久坐办公的肩背僵硬交给他最合适。',
      tags: ['肩颈松解', '推拿'],
      avatar: '',
      status: 'on',
    },
  ],
  services: [
    { id: 'sv1', category: '按摩', name: '15 分钟按摩', price: 29, duration: 15, desc: '快速放松肩颈腰背，时间紧张之选。', on: true },
    { id: 'sv2', category: '按摩', name: '30 分钟按摩', price: 49, duration: 30, desc: '针对酸痛点集中松解，最常选的时长。', on: true },
    { id: 'sv3', category: '按摩', name: '60 分钟按摩', price: 88, duration: 60, desc: '全身系统调理，从头到脚松一遍。', on: true },
    { id: 'sv4', category: '按摩', name: '90 分钟按摩', price: 128, duration: 90, desc: '深度放松，重度疲劳人群推荐。', on: true },
    { id: 'sv5', category: '艾灸', name: '30 分钟艾灸', price: 68, duration: 30, desc: '温通经络，驱寒祛湿，适合怕凉体质。', on: true },
  ],
  slotConfig: {
    open: '9:30', // 开始营业
    close: '21:30', // 打烊（不可跨）
    stepMin: 15, // 可选开始时间的粒度（分钟）
  },
  bookings: [],
}

function ensureInit() {
  if (get(KEYS.INIT, false)) return
  set(KEYS.STORE, SEED.store)
  set(KEYS.BANNERS, SEED.banners)
  set(KEYS.TECHS, SEED.techs)
  set(KEYS.SERVICES, SEED.services)
  set(KEYS.SLOTS, SEED.slotConfig)
  set(KEYS.BOOKINGS, SEED.bookings)
  set(KEYS.INIT, true)
}

// ———————— 店铺信息 ————————
function getStore() {
  return get(KEYS.STORE, SEED.store)
}
function getBanners() {
  return get(KEYS.BANNERS, SEED.banners)
}
function saveStore(patch) {
  const cur = getStore()
  set(KEYS.STORE, Object.assign({}, cur, patch))
}
// 轮播管理
function saveBanners(list) {
  return set(KEYS.BANNERS, list)
}

// ———————— 技师 ————————
function getTechs(includeOff) {
  const list = get(KEYS.TECHS, [])
  return includeOff ? list : list.filter(function (t) { return t.status === 'on' })
}
function getTech(id) {
  return get(KEYS.TECHS, []).find(function (t) { return t.id === id }) || null
}
function saveTech(tech) {
  const list = get(KEYS.TECHS, [])
  const idx = list.findIndex(function (t) { return t.id === tech.id })
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], tech)
  } else {
    tech.id = tech.id || util.genId('th')
    tech.status = tech.status || 'on'
    tech.avatar = tech.avatar || ''
    list.unshift(tech)
  }
  return set(KEYS.TECHS, list)
}
function removeTech(id) {
  const list = get(KEYS.TECHS, []).filter(function (t) { return t.id !== id })
  return set(KEYS.TECHS, list)
}
// 上传技师头像：把临时图片持久保存到用户目录，返回可长期使用的路径
function saveTechAvatar(techId, tempFilePath) {
  try {
    const fsm = wx.getFileSystemManager()
    const dest = wx.env.USER_DATA_PATH + '/avatar-' + techId + '.png'
    fsm.saveFileSync(tempFilePath, dest)
    saveTech({ id: techId, avatar: dest })
    return dest
  } catch (e) {
    console.error('save avatar failed', e)
    return ''
  }
}

// ———————— 服务项目 ————————
function getServices(opts) {
  const list = get(KEYS.SERVICES, [])
  if (opts && opts.onOnly) return list.filter(function (s) { return s.on })
  return list
}
function getService(id) {
  return get(KEYS.SERVICES, []).find(function (s) { return s.id === id }) || null
}
function saveService(sv) {
  const list = get(KEYS.SERVICES, [])
  const idx = list.findIndex(function (s) { return s.id === sv.id })
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], sv)
  } else {
    sv.id = sv.id || util.genId('sv')
    sv.on = sv.on !== false
    list.push(sv)
  }
  return set(KEYS.SERVICES, list)
}
function toggleService(id) {
  const list = get(KEYS.SERVICES, [])
  const item = list.find(function (s) { return s.id === id })
  if (item) {
    item.on = !item.on
    return set(KEYS.SERVICES, list)
  }
  return false
}

// ———————— 营业时间与时段 ————————
function getSlotConfig() {
  return get(KEYS.SLOTS, SEED.slotConfig)
}
function saveSlotConfig(cfg) {
  return set(KEYS.SLOTS, {
    open: cfg.open,
    close: cfg.close,
    stepMin: cfg.stepMin,
  })
}
// 一天所有可选开始时间点（仅营业时间 + 粒度，不含冲突过滤）
function genStartPoints(cfg) {
  cfg = cfg || getSlotConfig()
  const out = []
  let m = util.hmToMin(cfg.open)
  const close = util.hmToMin(cfg.close)
  const step = parseInt(cfg.stepMin, 10) || 15
  while (m < close) {
    out.push(util.minToHm(m))
    m += step
  }
  return out
}

// 某技师在某天的占用区间 [s, e)（分钟）。排班独立：只统计该技师自己的预约
function busyRanges(date, techId) {
  return get(KEYS.BOOKINGS, [])
    .filter(function (b) {
      return b.date === date && b.techId === techId && b.status !== STATUS.CANCELED
    })
    .map(function (b) {
      return { s: util.hmToMin(b.time), e: util.hmToMin(b.endTime) }
    })
}

// 某技师在 [s, e) 是否空闲（开区间比较，端点相接不算冲突）
function techFree(date, techId, s, e) {
  return !busyRanges(date, techId).some(function (r) {
    return s < r.e && r.s < e
  })
}

// 生成某天可选开始时间列表（按时长占用过滤冲突）
// techId = 'auto' 表示任一技师空闲即可（用于"选项目自动匹配"模式）
function availableTimes(date, techId, duration) {
  const cfg = getSlotConfig()
  const open = util.hmToMin(cfg.open)
  const close = util.hmToMin(cfg.close)
  const step = parseInt(cfg.stepMin, 10) || 15
  const today = util.fmtDate(new Date())
  const nowMin = util.hmToMin(util.nowHm())
  const techs = getTechs(false)

  const out = []
  for (let m = open; m + duration <= close; m += step) {
    const past = date === today && m <= nowMin
    let free = techs.filter(function (t) {
      return techFree(date, t.id, m, m + duration)
    })
    if (techId !== 'auto') {
      free = free.filter(function (t) { return t.id === techId })
    }
    out.push({
      time: util.minToHm(m),
      endTime: util.minToHm(m + duration),
      freeCount: free.length,
      disabled: past || free.length === 0,
    })
  }
  return out
}

// 某技师某天的连续空闲区间（用于技师页展示），返回 [{start, end}]
function freeRanges(date, techId) {
  const cfg = getSlotConfig()
  const open = util.hmToMin(cfg.open)
  const close = util.hmToMin(cfg.close)
  const ranges = busyRanges(date, techId).sort(function (a, b) { return a.s - b.s })
  const out = []
  let cur = open
  ranges.forEach(function (r) {
    if (r.s > cur) out.push({ start: util.minToHm(cur), end: util.minToHm(r.s) })
    if (r.e > cur) cur = r.e
  })
  if (cur < close) out.push({ start: util.minToHm(cur), end: util.minToHm(close) })
  return out
}

// 自动匹配最近可约时段（今天起逐天扫描，返回最早可用点；无则返回 null）
function autoMatchNearest(duration, days) {
  days = days || 7
  const list = util.nextDays(days)
  for (let i = 0; i < list.length; i++) {
    const slots = availableTimes(list[i].date, 'auto', duration)
    for (let j = 0; j < slots.length; j++) {
      if (!slots[j].disabled) {
        return { date: list[i].date, time: slots[j].time, endTime: slots[j].endTime, freeCount: slots[j].freeCount }
      }
    }
  }
  return null
}

// 从空闲技师中随机挑一位（两位均空闲时随机分配）
function pickFreeTech(date, time, duration) {
  const s = util.hmToMin(time)
  const free = getTechs(false).filter(function (t) {
    return techFree(date, t.id, s, s + duration)
  })
  if (free.length === 0) return null
  const idx = Math.floor(Math.random() * free.length)
  return free[idx]
}

// ———————— 预约 ————————
function getBookings(filter) {
  let list = get(KEYS.BOOKINGS, []).slice()
  if (filter) {
    if (filter.phone) list = list.filter(function (b) { return b.phone === filter.phone })
    if (filter.statuses) list = list.filter(function (b) { return filter.statuses.indexOf(b.status) >= 0 })
    if (filter.date) list = list.filter(function (b) { return b.date === filter.date })
  }
  list.sort(function (a, b) { return b.createdAt - a.createdAt })
  return list
}
function getBooking(id) {
  return get(KEYS.BOOKINGS, []).find(function (b) { return b.id === id }) || null
}

// ———————— 轻量风控（本地版） ————————
// 说明：本地版没有服务端，拿不到 openid，无法做真正的身份锚定，
// 只能以「手机号 + 本机预约记录」做最基本的限流与占坑防护。
// 要做到「一个微信号一档」的强约束，需接入服务端（见 utils/store.cloud.js）。
const RISK_LIMIT = {
  enabled: true,        // 总开关
  fakeDetect: true,     // 拦截明显虚假号码
  maxActivePerPhone: 2, // 同一手机号同时未完成的预约数上限
  cooldownSec: 60,      // 同一手机号两次下单的最小间隔（秒）
}

// 明显虚假号码：全同号、顺序号、常见占位号
function looksFakePhone(p) {
  const s = String(p || '')
  if (!/^\d{11}$/.test(s)) return false
  if (/^(\d)\1{10}$/.test(s)) return true
  if (/^(12345678901|12345678900|13800138000|10000000000)$/.test(s)) return true
  let asc = true, desc = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) asc = false
    if (d !== -1) desc = false
  }
  return asc || desc
}

function checkRisk(phone) {
  const p = String(phone || '').trim()
  if (!RISK_LIMIT.enabled) return { ok: true }
  if (RISK_LIMIT.fakeDetect && looksFakePhone(p)) {
    return { ok: false, code: 'PHONE', msg: '请填写真实手机号，否则无法联系您确认预约' }
  }
  const all = get(KEYS.BOOKINGS, [])
  const mine = all.filter(function (b) { return b.phone === p })
  const active = mine.filter(function (b) { return b.status === STATUS.PENDING || b.status === STATUS.ARRIVED })
  if (active.length >= RISK_LIMIT.maxActivePerPhone) {
    return { ok: false, code: 'PHONE_ACTIVE', msg: '该手机号已有 ' + active.length + ' 个未完成的预约，请先到店或取消后再约' }
  }
  const last = mine.reduce(function (m, b) { return Math.max(m, b.createdAt || 0) }, 0)
  const cd = RISK_LIMIT.cooldownSec * 1000
  if (cd > 0 && last && Date.now() - last < cd) {
    const left = Math.ceil((cd - (Date.now() - last)) / 1000)
    return { ok: false, code: 'COOLDOWN', msg: '操作太快了，请 ' + left + ' 秒后再试' }
  }
  return { ok: true }
}

// 到店核销码（顾客报码 / 商家核销，是判定是否真实到店的依据）
function genCheckinCode() {
  const used = {}
  get(KEYS.BOOKINGS, []).forEach(function (b) { if (b.code) used[b.code] = 1 })
  for (let i = 0; i < 50; i++) {
    const c = String(Math.floor(100000 + Math.random() * 900000))
    if (!used[c]) return c
  }
  return String(Date.now()).slice(-6)
}

// 提交预约（含营业时间 / 冲突校验 / 风控；techId='auto' 时随机分配空闲技师）
function createBooking(payload) {
  const svc = getService(payload.serviceId)
  if (!svc || !svc.on) return { ok: false, msg: '该项目已下架，请重新选择' }
  const cfg = getSlotConfig()
  const start = util.hmToMin(payload.time)
  const end = start + svc.duration
  if (start < util.hmToMin(cfg.open) || end > util.hmToMin(cfg.close)) {
    return { ok: false, msg: '该时段超出营业时间（' + cfg.open + ' - ' + cfg.close + '），请重新选择' }
  }
  if (!util.validPhone(payload.phone)) return { ok: false, msg: '请填写正确的 11 位手机号' }
  const rc = checkRisk(payload.phone)
  if (!rc.ok) return { ok: false, msg: rc.msg, code: rc.code }

  let tech
  if (payload.techId === 'auto') {
    tech = pickFreeTech(payload.date, payload.time, svc.duration)
    if (!tech) return { ok: false, msg: '手慢一步，该时段技师刚被约满，请换一个时段' }
  } else {
    tech = getTech(payload.techId)
    if (!tech || tech.status !== 'on') return { ok: false, msg: '该技师当前不可约，请重新选择' }
    if (!techFree(payload.date, tech.id, start, end)) {
      return { ok: false, msg: '该技师此时段已有预约，请换一个时段' }
    }
  }

  const booking = {
    id: util.genId('B'),
    code: genCheckinCode(),
    serviceId: svc.id,
    serviceName: svc.name,
    price: svc.price,
    duration: svc.duration,
    techId: tech.id,
    techName: tech.name,
    date: payload.date,
    time: payload.time,
    endTime: util.minToHm(end),
    phone: payload.phone,
    remark: payload.remark || '',
    status: STATUS.PENDING,
    createdAt: Date.now(),
  }
  const list = get(KEYS.BOOKINGS, [])
  list.unshift(booking)
  if (!set(KEYS.BOOKINGS, list)) return { ok: false, msg: '保存失败，请重试' }
  return { ok: true, booking: booking }
}

// 商家修改预约状态
function updateBookingStatus(id, status) {
  if (!STATUS_META[status]) return false
  const list = get(KEYS.BOOKINGS, [])
  const item = list.find(function (b) { return b.id === id })
  if (!item) return false
  item.status = status
  item.updatedAt = Date.now()
  return set(KEYS.BOOKINGS, list)
}

// 用户取消自己的预约（仅待确认可取消）
function cancelBooking(id, phone) {
  const list = get(KEYS.BOOKINGS, [])
  const item = list.find(function (b) { return b.id === id })
  if (!item || item.phone !== phone) return { ok: false, msg: '未找到该预约' }
  if (item.status !== STATUS.PENDING) return { ok: false, msg: '当前状态不可取消' }
  item.status = STATUS.CANCELED
  item.updatedAt = Date.now()
  set(KEYS.BOOKINGS, list)
  return { ok: true }
}

// ———————— 用户信息（微信登录 + 手机号） ————————
function getUser() {
  return get(KEYS.USER, { logged: false, phone: '' })
}
function saveUser(patch) {
  set(KEYS.USER, Object.assign({}, getUser(), patch))
}
// 微信授权登录（本地版：wx.login 建立本地会话）
function wxLogin() {
  return new Promise(function (resolve) {
    wx.login({
      success: function (res) {
        if (res.code) {
          const cur = getUser()
          saveUser({ logged: true, openid: cur.openid || ('local_' + res.code.slice(0, 8)), nickname: cur.nickname || '微信用户' })
          resolve({ ok: true })
        } else {
          resolve({ ok: false, msg: '微信登录失败，请重试' })
        }
      },
      fail: function () {
        resolve({ ok: false, msg: '微信登录失败，请重试' })
      },
    })
  })
}

// ———————— 商家登录态 ————————
function adminLogin(pwd) {
  if (pwd === ADMIN_PASSWORD) {
    set(KEYS.ADMIN, { login: true, at: Date.now() })
    return true
  }
  return false
}
function isAdmin() {
  const s = get(KEYS.ADMIN, null)
  return !!(s && s.login)
}
function adminLogout() {
  set(KEYS.ADMIN, null)
}

module.exports = {
  KEYS,
  ADMIN_PASSWORD,
  STATUS,
  STATUS_META,
  CATEGORIES,
  ensureInit,
  getStore,
  getBanners,
  saveBanners,
  saveStore,
  getTechs,
  getTech,
  saveTech,
  removeTech,
  saveTechAvatar,
  getServices,
  getService,
  saveService,
  toggleService,
  getSlotConfig,
  saveSlotConfig,
  genStartPoints,
  busyRanges,
  techFree,
  availableTimes,
  freeRanges,
  autoMatchNearest,
  pickFreeTech,
  getBookings,
  getBooking,
  createBooking,
  updateBookingStatus,
  cancelBooking,
  getUser,
  saveUser,
  wxLogin,
  adminLogin,
  isAdmin,
  adminLogout,
  // 风控
  RISK_LIMIT,
  checkRisk,
  looksFakePhone,
  genCheckinCode,
}
