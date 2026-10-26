// server/wx.js —— 调用微信服务端接口（零依赖，用内置 https）
// 涉及两个接口：
//   1) code2Session  : 用 wx.login 的 code 换 openid（登录）
//   2) getPhoneNumber: 用按钮回调的 code 换真实手机号（需已认证的非个人主体）
const https = require('https')
const config = require('./config')

function request(url, method, body) {
  return new Promise(function (resolve, reject) {
    let u
    try { u = new URL(url) } catch (e) { return reject(new Error('bad url')) }
    const payload = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method || 'GET',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}
      ),
    }, function (res) {
      let buf = ''
      res.on('data', function (d) { buf += d })
      res.on('end', function () {
        try { resolve(JSON.parse(buf)) } catch (e) { resolve({ errcode: -1, errmsg: 'bad json: ' + buf }) }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// —— 全局 access_token：有效期 7200 秒，提前 5 分钟刷新并缓存 ——
let tokenCache = { token: '', expireAt: 0 }

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token
  const r = await request(
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
      encodeURIComponent(config.appid) + '&secret=' + encodeURIComponent(config.secret),
    'GET'
  )
  if (!r.access_token) {
    throw new Error('获取 access_token 失败: ' + JSON.stringify(r))
  }
  tokenCache = { token: r.access_token, expireAt: Date.now() + (r.expires_in - 300) * 1000 }
  return tokenCache.token
}

// wx.login 的 code → openid（+ unionid）
async function code2Session(code) {
  const r = await request(
    'https://api.weixin.qq.com/sns/jscode2session?appid=' + encodeURIComponent(config.appid) +
      '&secret=' + encodeURIComponent(config.secret) +
      '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code',
    'GET'
  )
  if (!r.openid) throw new Error('code2Session 失败: ' + JSON.stringify(r))
  return r
}

// 手机号按钮回调的 code → 真实手机号
// 官方文档：POST https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=ACCESS_TOKEN
// 注意：code 一次性、有效期 5 分钟；仅「已认证的非个人主体」小程序可用
async function getPhoneNumber(code) {
  const token = await getAccessToken()
  const r = await request(
    'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(token),
    'POST',
    { code: code }
  )
  if (r.errcode !== 0 || !r.phone_info) {
    const e = new Error(r.errmsg || 'getPhoneNumber 失败')
    e.errcode = r.errcode
    throw e
  }
  return r.phone_info
}

module.exports = { code2Session, getPhoneNumber, getAccessToken }
