// server/storage.js —— 数据持久化后端（零依赖）
//
// 为什么需要它：微信云托管「容器不支持持久化存储」，容器扩缩容/重启/重新部署时
// 容器内的文件会被还原，预约单会凭空消失。所以线上必须把数据落到容器之外。
//
// 两种后端：
//   STORAGE=file  写本地文件（默认）—— 本地调试 / 有持久盘的服务器使用
//   STORAGE=cos   写腾讯云对象存储 —— 云托管推荐，零依赖手写 COS v5 签名，无需 npm 包
//
// COS 模式配置：COS_REGION / COS_BUCKET / COS_SECRET_ID / COS_SECRET_KEY，键名默认 nansong/data.json
const https = require('https')
const crypto = require('crypto')
const config = require('./config')

function enabled() {
  const s = config.storage
  return s.type === 'cos' && !!(s.region && s.bucket && s.secretId && s.secretKey)
}

// —— COS v5 签名 ——
function authorization(method, keyPath, headers) {
  const s = config.storage
  const now = Math.floor(Date.now() / 1000)
  const signTime = (now - 60) + ';' + (now + 3600)

  const hKeys = Object.keys(headers).map(function (k) { return k.toLowerCase() }).sort()
  const headerList = hKeys.join(';')
  const httpHeaders = hKeys.map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(headers[k]))
  }).join('&')

  const httpString = [
    method.toLowerCase(),
    keyPath,                // UriPathname
    '',                     // HttpParameters（本实现不带 query）
    httpHeaders,
    '',
  ].join('\n')

  const stringToSign = [
    'sha1',
    signTime,
    crypto.createHash('sha1').update(httpString).digest('hex'),
    '',
  ].join('\n')

  const signKey = crypto.createHmac('sha1', s.secretKey).update(signTime).digest('hex')
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex')

  return 'q-sign-algorithm=sha1'
    + '&q-ak=' + s.secretId
    + '&q-sign-time=' + signTime
    + '&q-key-time=' + signTime
    + '&q-header-list=' + headerList
    + '&q-url-param-list='
    + '&q-signature=' + signature
}

function request(method, body) {
  return new Promise(function (resolve, reject) {
    const s = config.storage
    const host = s.bucket + '.cos.' + s.region + '.myqcloud.com'
    const keyPath = '/' + String(s.key || '').replace(/^\/+/, '')

    const headers = {
      Host: host,
      'Content-Type': 'application/json',
    }
    // 临时密钥（STS）必须带 security-token，且要参与签名
    if (config.storage.sessionToken) headers['x-cos-security-token'] = config.storage.sessionToken
    if (body != null) headers['Content-Length'] = String(Buffer.byteLength(body))
    headers['Authorization'] = authorization(method, keyPath, headers)

    const req = https.request({
      host: host,
      path: keyPath,
      method: method,
      headers: headers,
      timeout: 10000,
    }, function (res) {
      let buf = ''
      res.on('data', function (d) { buf += d })
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(buf)
        reject(new Error('COS ' + method + ' 失败 ' + res.statusCode + ': ' + buf.slice(0, 300)))
      })
    })
    req.on('timeout', function () { req.destroy(new Error('COS 请求超时')) })
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
}

let pending = null
let warned = false

// 启动时拉取远端数据，返回解析后的对象（失败返回 null，不阻断启动）
async function init() {
  if (!enabled()) return null
  try {
    let raw = await request('GET', null)
    if (!raw) return null
    try { raw = JSON.parse(raw) } catch (e) { throw new Error('远端数据不是合法 JSON') }
    console.log('[storage] 已从对象存储载入数据：' + config.storage.key)
    return raw
  } catch (e) {
    // 首次部署时对象不存在属正常情况
    console.warn('[storage] 读取远端数据失败（首次部署可忽略）：' + e.message)
    return null
  }
}

// 写入：返回 Promise，调用方无需等待（内存缓存已即时生效）
function write(json) {
  if (!enabled()) return Promise.resolve(false)
  pending = request('PUT', json).then(function () {
    pending = null
    return true
  }).catch(function (e) {
    pending = null
    if (!warned) { warned = true; console.error('[storage] 写入对象存储失败：' + e.message) }
    return false
  })
  return pending
}

// 进程退出前尽量把最后一次写入推上去
async function flush() {
  if (pending) { try { await pending } catch (e) { /* ignore */ } }
}

module.exports = { init: init, write: write, flush: flush, enabled: enabled }
