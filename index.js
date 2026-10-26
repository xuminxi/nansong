// server/index.js —— 南松推拿馆预约服务端（零依赖，Node 18+ 直接跑）
// 启动：node index.js        （本地调试：PORT=3000 MOCK_LOGIN=1 node index.js）
// 云托管：容器默认 UTC，营业时段依赖本地时间，必须强制上海时区
process.env.TZ = process.env.TZ || 'Asia/Shanghai'

const http = require('http')
const crypto = require('crypto')
const config = require('./config')
const storage = require('./storage')
const { db, flush, prime, genId } = require('./db')
const wx = require('./wx')
const core = require('./core')
const risk = require('./risk')

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}
const ok = function (res, data) { json(res, 200, Object.assign({ ok: true }, data || {})) }
const fail = function (res, msg, code) { json(res, code || 200, { ok: false, msg: msg }) }

function readBody(req) {
  return new Promise(function (resolve) {
    let buf = ''
    req.on('data', function (d) {
      buf += d
      if (buf.length > 1e6) { req.destroy(); resolve({}) }
    })
    req.on('end', function () {
      try { resolve(buf ? JSON.parse(buf) : {}) } catch (e) { resolve({}) }
    })
  })
}

// —— 鉴权 ——
function newToken(prefix) {
  return prefix + '_' + crypto.randomBytes(16).toString('hex')
}
function userOf(req) {
  const t = (req.headers['x-token'] || '') + ''
  const s = db().sessions[t]
  return s ? s.openid : ''
}
function requireAdmin(req) {
  const t = (req.headers['x-admin-token'] || '') + ''
  return !!(t && db().adminTokens[t])
}

async function route(req, res, url, body) {
  const p = url.pathname
  const q = url.searchParams
  const m = req.method

  // 健康检查（云托管存活探针填 /api/health）
  if (p === '/api/health' || p === '/') {
    return ok(res, {
      service: '南松推拿馆预约服务端',
      appidConfigured: !!config.appid,
      mockLogin: config.mockLogin,
      storage: config.storage.type + (storage.enabled() ? '(已配置)' : '(未配置/本地文件)'),
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      bookings: db().bookings.length,
    })
  }

  // ========== 登录 / 手机号 ==========
  // wx.login 的 code → openid，签发登录态 token
  if (p === '/api/auth/login' && m === 'POST') {
    if (!config.appid) {
      if (!config.mockLogin) return fail(res, '服务端未配置 APPID，请在环境变量中配置 APPID / SECRET')
      // 本地联调模式（MOCK_LOGIN=1）：用一个稳定的假 openid
      const openid = 'dev_' + (body.mockOpenid || 'local')
      const token = newToken('u')
      db().sessions[token] = { openid: openid, createdAt: Date.now() }
      if (!db().users[openid]) db().users[openid] = { phone: '', nickname: '', avatarUrl: '' }
      flush()
      return ok(res, { token: token, openid: openid, phone: db().users[openid].phone, mock: true })
    }
    try {
      const r = await wx.code2Session(body.code)
      const token = newToken('u')
      db().sessions[token] = { openid: r.openid, createdAt: Date.now() }
      if (!db().users[r.openid]) db().users[r.openid] = { phone: '', nickname: '', avatarUrl: '' }
      flush()
      return ok(res, { token: token, openid: r.openid, phone: db().users[r.openid].phone })
    } catch (e) {
      return fail(res, '登录失败：' + e.message)
    }
  }

  // 手机号按钮回调的 code → 真实手机号
  // 前置：已认证的非个人主体小程序 + 公众平台已开通「获取手机号」接口权限
  if (p === '/api/auth/phone' && m === 'POST') {
    const openid = userOf(req)
    if (!openid) return fail(res, '请先登录', 401)
    try {
      const info = await wx.getPhoneNumber(body.code)
      const phone = info.purePhoneNumber || info.phoneNumber
      const u = db().users[openid] || {}
      u.phone = phone
      db().users[openid] = u
      flush()
      return ok(res, { phone: phone })
    } catch (e) {
      const hint = e.errcode === 41001 || /access_token/i.test(e.message)
        ? '（请确认 AppID/AppSecret 正确）'
        : '（请确认小程序为已认证的非个人主体，且已在公众平台开通「获取手机号」权限）'
      return fail(res, '获取手机号失败：' + e.message + hint)
    }
  }

  // 保存用户自填的资料（头像昵称）
  if (p === '/api/auth/profile' && m === 'POST') {
    const openid = userOf(req)
    if (!openid) return fail(res, '请先登录', 401)
    const u = db().users[openid] || {}
    if (body.nickname !== undefined) u.nickname = String(body.nickname).slice(0, 40)
    if (body.avatarUrl !== undefined) u.avatarUrl = String(body.avatarUrl).slice(0, 500)
    if (body.phone !== undefined) u.phone = String(body.phone)
    db().users[openid] = u
    flush()
    return ok(res, { user: u })
  }

  if (p === '/api/auth/me' && m === 'GET') {
    const openid = userOf(req)
    if (!openid) return fail(res, '未登录', 401)
    return ok(res, { openid: openid, user: db().users[openid] || {} })
  }

  // 商家登录
  if (p === '/api/auth/admin' && m === 'POST') {
    if (!config.adminPassword) return fail(res, '服务端未配置 ADMIN_PASSWORD，商家后台不可用')
    if (body.password !== config.adminPassword) return fail(res, '密码不正确')
    const token = newToken('a')
    db().adminTokens[token] = { createdAt: Date.now() }
    flush()
    return ok(res, { adminToken: token })
  }

  // ========== 公开读接口 ==========
  if (p === '/api/store' && m === 'GET') return ok(res, { store: db().store })
  if (p === '/api/banners' && m === 'GET') return ok(res, { banners: db().banners })
  if (p === '/api/slots' && m === 'GET') return ok(res, { slots: db().slots })

  if (p === '/api/techs' && m === 'GET') {
    const list = db().techs.filter(function (t) { return q.get('all') === '1' || t.status === 'on' })
    return ok(res, { techs: list })
  }
  if (p === '/api/services' && m === 'GET') {
    const list = db().services.filter(function (s) { return q.get('all') === '1' || s.on })
    return ok(res, { services: list })
  }

  // 可约开始时间
  if (p === '/api/availability' && m === 'GET') {
    const duration = Number(q.get('duration') || 30)
    const techId = q.get('techId') || 'auto'
    const date = q.get('date') || core.fmtDate(new Date())
    return ok(res, { date: date, times: core.availableTimes(date, techId, duration) })
  }
  // 某技师空闲区间
  if (p === '/api/free-ranges' && m === 'GET') {
    return ok(res, { ranges: core.freeRanges(q.get('date') || core.fmtDate(new Date()), q.get('techId') || '') })
  }
  // 最近可约自动匹配
  if (p === '/api/auto-match' && m === 'GET') {
    const r = core.autoMatchNearest(Number(q.get('duration') || 30))
    return ok(res, { match: r })
  }

  // ========== 预约 ==========
  if (p === '/api/bookings' && m === 'GET') {
    const phone = q.get('phone')
    let list = db().bookings
    if (phone) list = list.filter(function (b) { return b.phone === String(phone) })
    list = list.slice().sort(function (a, b) { return b.createdAt - a.createdAt })
    return ok(res, { bookings: list })
  }

  if (p === '/api/bookings' && m === 'POST') {
    const openid = userOf(req)
    if (!openid) return fail(res, '登录状态已失效，请重新进入小程序', 401)
    const phone = String(body.phone || '').trim()
    if (!/^1\d{10}$/.test(phone)) return fail(res, '请填写正确的 11 位手机号')
    const r = core.createBooking({
      serviceId: body.serviceId,
      techId: body.techId || 'auto',
      date: body.date,
      time: body.time,
      phone: phone,
      remark: body.remark,
      openid: openid,
    })
    if (!r.ok) return json(res, 200, { ok: false, msg: r.msg, code: r.code || '' })
    if (openid) {
      const u = db().users[openid] || {}
      u.phone = phone
      db().users[openid] = u
      flush()
    }
    return ok(res, { booking: r.booking })
  }

  // 顾客自助取消（需登录态，只能取消自己的）
  if (p === '/api/bookings/cancel' && m === 'POST') {
    const openid = userOf(req)
    if (!openid) return fail(res, '登录状态已失效，请重新进入小程序', 401)
    const r = core.cancelBooking(body.id, body.phone, openid)
    return r.ok ? ok(res, {}) : fail(res, r.msg)
  }

  // 到店核销（商家输入顾客报的 6 位核销码）
  if (p === '/api/admin/checkin' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    const r = core.checkinByCode(body.code)
    return r.ok ? ok(res, { booking: r.booking }) : fail(res, r.msg)
  }

  // ========== 商家端 ==========
  if (p === '/api/admin/bookings' && m === 'GET') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    const list = db().bookings.slice().sort(function (a, b) { return b.createdAt - a.createdAt })
    return ok(res, { bookings: list, stats: {
      pending: list.filter(function (b) { return b.status === 'pending' }).length,
      today: list.filter(function (b) { return b.date === core.fmtDate(new Date()) && b.status !== 'canceled' }).length,
    } })
  }
  if (p === '/api/admin/bookings/status' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    // body.noshow = true 表示标记「顾客未到店」，计入爽约
    const r = core.updateBookingStatus(body.id, body.status, { noshow: !!body.noshow })
    return r.ok ? ok(res, { booking: r.booking, punish: r.punish }) : fail(res, r.msg)
  }

  // ========== 风控 ==========
  if (p === '/api/admin/risk' && m === 'GET') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    return ok(res, { risk: risk.summary() })
  }
  if (p === '/api/admin/risk/config' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    const c = risk.ensure().config
    const patch = body.config || {}
    const allow = Object.keys(risk.DEFAULT_CONFIG)
    for (const k of Object.keys(patch)) {
      if (allow.indexOf(k) >= 0) c[k] = patch[k]
    }
    flush()
    return ok(res, { config: c })
  }
  if (p === '/api/admin/risk/block' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    // body: { type:'openid'|'phone', value, reason }
    const t = body.type === 'phone' ? 'tel:' + String(body.value || '') : 'oid:' + String(body.value || '')
    if (!body.value) return fail(res, '缺少要限制的对象')
    risk.block(t, body.reason || '商家手动限制', 'admin')
    return ok(res, { blacklist: risk.summary().blacklist })
  }
  if (p === '/api/admin/risk/unblock' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    risk.unblock(String(body.key || ''))
    return ok(res, { blacklist: risk.summary().blacklist })
  }
  if (p === '/api/admin/store' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    Object.assign(db().store, body.store || {})
    flush()
    return ok(res, { store: db().store })
  }
  if (p === '/api/admin/banners' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    if (Array.isArray(body.banners)) { db().banners = body.banners; flush() }
    return ok(res, { banners: db().banners })
  }
  if (p === '/api/admin/techs' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    const t = body.tech || {}
    const list = db().techs
    const idx = list.findIndex(function (x) { return x.id === t.id })
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], t)
    else list.push(Object.assign({ id: genId('th'), status: 'on', avatar: '', tags: [] }, t))
    flush()
    return ok(res, { techs: db().techs })
  }
  if (p === '/api/admin/techs/remove' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    db().techs = db().techs.filter(function (x) { return x.id !== body.id })
    flush()
    return ok(res, { techs: db().techs })
  }
  if (p === '/api/admin/services' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    const s = body.service || {}
    const list = db().services
    const idx = list.findIndex(function (x) { return x.id === s.id })
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], s)
    else list.push(Object.assign({ id: genId('sv'), on: true }, s))
    flush()
    return ok(res, { services: db().services })
  }
  if (p === '/api/admin/slots' && m === 'POST') {
    if (!requireAdmin(req)) return fail(res, '未登录商家后台', 401)
    Object.assign(db().slots, body.slots || {})
    flush()
    return ok(res, { slots: db().slots })
  }

  return fail(res, '接口不存在: ' + m + ' ' + p, 404)
}

const server = http.createServer(async function (req, res) {
  if (config.cors) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-token,x-admin-token')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  let url
  try { url = new URL(req.url, 'http://localhost') } catch (e) { return fail(res, 'bad url', 400) }
  const body = req.method === 'GET' ? {} : await readBody(req)

  try {
    await route(req, res, url, body)
  } catch (e) {
    console.error('[err]', url.pathname, e)
    fail(res, '服务端异常：' + e.message, 500)
  }
})

// —— 启动：先从远端（对象存储）拉回数据，再监听端口 ——
async function bootstrap() {
  const remote = await storage.init()
  if (remote) prime(remote)
  db() // 触发本地加载 / 补齐缺失字段

  server.listen(config.port, config.host, function () {
    console.log('南松推拿馆预约服务端已启动: http://' + config.host + ':' + config.port)
    console.log('  时区:', process.env.TZ, '| 当前时间:', new Date().toLocaleString('zh-CN'))
    console.log('  AppID 已配置:', !!config.appid, config.mockLogin ? '（MOCK_LOGIN 模式，禁止用于生产）' : '')
    console.log('  商家后台密码已配置:', !!config.adminPassword)
    console.log('  数据文件:', config.dataFile)
    console.log('  持久化后端:', config.storage.type, storage.enabled() ? '（对象存储已配置）' : '（容器重启会丢数据，请配置 COS 或改用数据库）')
  })
}

// 容器缩容/重启前，把最后一次写入推上去并落盘
function shutdown(sig) {
  console.log('[shutdown] 收到 ' + sig + '，正在保存数据…')
  storage.flush().catch(function () {}).then(function () {
    try { require('./db').save() } catch (e) { /* ignore */ }
    server.close(function () { process.exit(0) })
    setTimeout(function () { process.exit(0) }, 3000).unref()
  })
}
process.on('SIGTERM', function () { shutdown('SIGTERM') })
process.on('SIGINT', function () { shutdown('SIGINT') })

bootstrap()
