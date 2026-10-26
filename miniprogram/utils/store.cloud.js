// utils/store.cloud.js —— 服务端版数据层
// 与 utils/store.js 暴露完全相同的接口，页面层无需感知存储介质。
// 用法：把本文件改名覆盖 utils/store.js 即可切换到服务端模式（记得先改 utils/api.js 里的 API_BASE）。
//
// 设计：本地保留一份快照缓存，读操作同步返回（页面代码不用改）；
//       写操作先更新缓存再发请求，保证界面即时响应；
//       涉及"实时余量"的查询（可约时段 / 自动匹配 / 空闲区间 / 预约列表）走服务端，返回 Promise。
const api = require('./api')

const STATUS = { PENDING: 'pending', ARRIVED: 'arrived', DONE: 'done', CANCELED: 'canceled' }
const STATUS_META = {
  pending: { text: '待确认', cls: 'badge-pending' },
  arrived: { text: '已到店', cls: 'badge-arrived' },
  done: { text: '已完成', cls: 'badge-done' },
  canceled: { text: '已取消', cls: 'badge-canceled' },
}
const CATEGORIES = ['按摩', '艾灸']
const ADMIN_PASSWORD = '（服务端模式下由服务端 config.js 的 adminPassword 决定）'

// —— 本地快照缓存 ——
const cache = {
  store: {}, banners: [], techs: [], services: [], slots: { open: '9:30', close: '21:30', stepMin: 15 },
  bookings: [], user: null,
}

function saveUserLocal(u) {
  try { wx.setStorageSync('ns_user', u || {}) } catch (e) {}
  cache.user = u || {}
}
function loadUserLocal() {
  try { cache.user = wx.getStorageSync('ns_user') || {} } catch (e) { cache.user = {} }
  if (!cache.user) cache.user = {}
}

// —— 初始化 / 拉取快照 ——
function ensureInit() {
  loadUserLocal()
  return pull()
}

function pull() {
  return Promise.all([
    api.get('/store'),
    api.get('/banners'),
    api.get('/techs', { all: '0' }),
    api.get('/services', { all: '0' }),
    api.get('/slots'),
  ]).then(function (rs) {
    if (rs[0] && rs[0].ok) cache.store = rs[0].store
    if (rs[1] && rs[1].ok) cache.banners = rs[1].banners
    if (rs[2] && rs[2].ok) cache.techs = rs[2].techs
    if (rs[3] && rs[3].ok) cache.services = rs[3].services
    if (rs[4] && rs[4].ok) cache.slots = rs[4].slots
    return cache
  }).catch(function () { return cache })
}

// ===== 同步读（来自缓存）=====
function getStore() { return cache.store || {} }
function getBanners() { return cache.banners || [] }
function getTechs(all) {
  if (!cache.techs) return []
  return all ? cache.techs.slice() : cache.techs.filter(function (t) { return t.status === 'on' })
}
function getTech(id) { return (cache.techs || []).filter(function (t) { return t.id === id })[0] || null }
function getServices(opts) {
  const onOnly = opts && opts.onOnly
  return (cache.services || []).filter(function (s) { return onOnly ? s.on : true })
}
function getService(id) { return (cache.services || []).filter(function (s) { return s.id === id })[0] || null }
function getSlotConfig() { return cache.slots || { open: '9:30', close: '21:30', stepMin: 15 } }
function getBooking(id) { return (cache.bookings || []).filter(function (b) { return b.id === id })[0] || null }

// 时间工具（与服务端一致）
function hmToMin(hm) { const p = String(hm).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10) }
function minToHm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
function genStartPoints(cfg) {
  const s = hmToMin(cfg.open); const e = hmToMin(cfg.close); const step = Number(cfg.stepMin) || 15
  const out = []
  for (let m = s; m < e; m += step) out.push(minToHm(m))
  return out
}
function busyRanges(date, techId) {
  return (cache.bookings || []).filter(function (b) {
    return b.date === date && b.techId === techId && b.status !== STATUS.CANCELED
  }).map(function (b) { return { s: hmToMin(b.time), e: hmToMin(b.endTime || b.time) } })
}
function techFree(date, techId, s, e) {
  return !busyRanges(date, techId).some(function (r) { return s < r.e && e > r.s })
}
function pickFreeTech(date, time, duration) {
  const s = hmToMin(time), e = s + duration
  const free = getTechs(false).filter(function (t) { return techFree(date, t.id, s, e) })
  return free.length ? free[Math.floor(Math.random() * free.length)] : null
}

// ===== 异步读（走服务端，保证实时）=====
function availableTimes(date, techId, duration) {
  return api.get('/availability', { date: date, duration: duration, techId: techId || 'auto' })
    .then(function (r) { return (r && r.ok && r.times) ? r.times : [] })
}
function freeRanges(date, techId) {
  return api.get('/free-ranges', { date: date, techId: techId })
    .then(function (r) { return (r && r.ok && r.ranges) ? r.ranges : [] })
}
function autoMatchNearest(duration) {
  return api.get('/auto-match', { duration: duration }).then(function (r) { return (r && r.match) || null })
}
function getBookings(opts) {
  const phone = opts && opts.phone
  return api.get('/bookings', phone ? { phone: phone } : {})
    .then(function (r) {
      if (r && r.ok) { cache.bookings = r.bookings || []; return cache.bookings }
      return cache.bookings || []
    })
}

// ===== 写操作（先更新缓存，再发请求）=====
function createBooking(payload) {
  const phone = String((payload && payload.phone) || (cache.user && cache.user.phone) || '')
  return api.postAuth('/bookings', {
    serviceId: payload.serviceId, techId: payload.techId || 'auto',
    date: payload.date, time: payload.time, phone: phone, remark: payload.remark || '',
  }).then(function (r) {
    if (r && r.ok) {
      cache.bookings.push(r.booking)
      saveUserLocal(Object.assign({}, cache.user, { phone: phone }))
      return { ok: true, booking: r.booking }
    }
    return { ok: false, msg: (r && r.msg) || '预约失败，请稍后再试' }
  })
}

function updateBookingStatus(id, status) {
  const b = getBooking(id)
  if (b) { b.status = status; b.updatedAt = Date.now() }
  return api.postAdmin('/admin/bookings/status', { id: id, status: status })
    .then(function (r) { return !!(r && r.ok) })
}

function cancelBooking(id, phone) {
  const b = getBooking(id)
  if (b) { b.status = STATUS.CANCELED; b.updatedAt = Date.now() }
  return api.post('/bookings/cancel', { id: id, phone: phone })
    .then(function (r) { return (r && r.ok) ? { ok: true } : { ok: false, msg: (r && r.msg) || '取消失败' } })
}

function saveStore(patch) {
  Object.assign(cache.store, patch || {})
  return api.postAdmin('/admin/store', { store: cache.store })
}
function saveBanners(list) {
  cache.banners = list || []
  return api.postAdmin('/admin/banners', { banners: cache.banners })
}

function saveTech(t) {
  const list = cache.techs
  const idx = list.findIndex(function (x) { return x.id === t.id })
  if (idx >= 0) list[idx] = Object.assign({}, list[idx], t)
  else list.push(Object.assign({ id: '', status: 'on', avatar: '', tags: [] }, t))
  return api.postAdmin('/admin/techs', { tech: t })
}
function removeTech(id) {
  cache.techs = cache.techs.filter(function (x) { return x.id !== id })
  return api.postAdmin('/admin/techs/remove', { id: id })
}
// 头像：本地版存文件路径；服务端模式下建议先传到自己的文件服务，这里退回保存临时路径
function saveTechAvatar(id, tempPath) {
  const t = getTech(id)
  if (t) { t.avatar = tempPath; saveTech({ id: id, avatar: tempPath }) }
  return tempPath
}

function saveService(s) {
  const list = cache.services
  const idx = list.findIndex(function (x) { return x.id === s.id })
  if (idx >= 0) list[idx] = Object.assign({}, list[idx], s)
  else list.push(Object.assign({ id: '', on: true }, s))
  return api.postAdmin('/admin/services', { service: s })
}
function toggleService(id) {
  const s = getService(id)
  if (!s) return Promise.resolve(false)
  s.on = !s.on
  return api.postAdmin('/admin/services', { service: { id: id, on: s.on } })
}
function saveSlotConfig(cfg) {
  Object.assign(cache.slots, cfg || {})
  return api.postAdmin('/admin/slots', { slots: cache.slots })
}

// ===== 用户 / 登录 =====
function getUser() { return cache.user || {} }
function saveUser(patch) {
  saveUserLocal(Object.assign({}, cache.user, patch || {}))
  return api.postAuth('/auth/profile', patch || {}).catch(function () { return {} })
}

// 微信登录：wx.login → code → 服务端换 openid
function wxLogin() {
  return new Promise(function (resolve) {
    wx.login({
      success: function (r) {
        if (!r.code) return resolve({ ok: false, msg: 'wx.login 失败' })
        api.post('/auth/login', { code: r.code }).then(function (res) {
          if (res && res.ok && res.token) {
            api.setToken(res.token)
            saveUserLocal(Object.assign({}, cache.user, { openid: res.openid, phone: res.phone || '' }))
            return resolve({ ok: true, phone: res.phone || '' })
          }
          resolve({ ok: false, msg: (res && res.msg) || '登录失败' })
        })
      },
      fail: function () { resolve({ ok: false, msg: 'wx.login 调用失败' }) },
    })
  })
}

// 用手机号按钮回调的 code 换真实手机号（需已认证的非个人主体小程序）
// 页面里：<button open-type="getPhoneNumber" bindgetphonenumber="onGetPhone">
function getPhoneNumber(code) {
  return api.postAuth('/auth/phone', { code: code }).then(function (r) {
    if (r && r.ok && r.phone) {
      saveUserLocal(Object.assign({}, cache.user, { phone: r.phone }))
      return { ok: true, phone: r.phone }
    }
    return { ok: false, msg: (r && r.msg) || '获取手机号失败' }
  })
}

// ———— 风控 ————
// 真正的限制（身份锚点 openid、频率、占坑、爽约拉黑）全部在服务端 risk.js 执行。
// 这里只做「明显虚假号码」的本地预检，让用户立刻得到反馈，不必等一次网络往返。
const RISK_LIMIT = {
  enabled: true,
  fakeDetect: true,
  maxActivePerPhone: 2,
  cooldownSec: 60,
}
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
  if (RISK_LIMIT.enabled && RISK_LIMIT.fakeDetect && looksFakePhone(phone)) {
    return { ok: false, code: 'PHONE', msg: '请填写真实手机号，否则无法联系您确认预约' }
  }
  return { ok: true }
}

function adminLogin(password) {
  return api.post('/auth/admin', { password: password }).then(function (r) {
    if (r && r.ok && r.adminToken) { api.setAdminToken(r.adminToken); return { ok: true } }
    return { ok: false, msg: (r && r.msg) || '登录失败' }
  })
}
function isAdmin() { return !!api.getAdminToken() }
function adminLogout() { api.setAdminToken('') }

module.exports = {
  KEYS: {}, ADMIN_PASSWORD: ADMIN_PASSWORD, STATUS: STATUS, STATUS_META: STATUS_META, CATEGORIES: CATEGORIES,
  ensureInit: ensureInit, pull: pull,
  getStore: getStore, getBanners: getBanners, saveBanners: saveBanners, saveStore: saveStore,
  getTechs: getTechs, getTech: getTech, saveTech: saveTech, removeTech: removeTech, saveTechAvatar: saveTechAvatar,
  getServices: getServices, getService: getService, saveService: saveService, toggleService: toggleService,
  getSlotConfig: getSlotConfig, saveSlotConfig: saveSlotConfig,
  genStartPoints: genStartPoints, busyRanges: busyRanges, techFree: techFree,
  availableTimes: availableTimes, freeRanges: freeRanges, autoMatchNearest: autoMatchNearest, pickFreeTech: pickFreeTech,
  getBookings: getBookings, getBooking: getBooking,
  createBooking: createBooking, updateBookingStatus: updateBookingStatus, cancelBooking: cancelBooking,
  getUser: getUser, saveUser: saveUser, wxLogin: wxLogin, getPhoneNumber: getPhoneNumber,
  adminLogin: adminLogin, isAdmin: isAdmin, adminLogout: adminLogout,
  RISK_LIMIT: RISK_LIMIT, checkRisk: checkRisk, looksFakePhone: looksFakePhone,
}
