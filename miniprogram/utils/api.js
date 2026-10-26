// utils/api.js —— 服务端接口封装
// 上线前把 API_BASE 改成你自己的已备案 HTTPS 域名，并在
// 微信公众平台 → 开发 → 开发设置 → 服务器域名 → request 合法域名 中加入该域名。
const API_BASE = 'https://你的域名/api' // ← 改这里

function request(path, method, data, extraHeaders) {
  return new Promise(function (resolve) {
    wx.request({
      url: API_BASE + path,
      method: method || 'GET',
      data: data || {},
      header: Object.assign({ 'content-type': 'application/json' }, extraHeaders || {}),
      timeout: 15000,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data) return resolve(res.data)
        resolve({ ok: false, msg: '网络异常(' + res.statusCode + ')' })
      },
      fail: function (err) {
        resolve({ ok: false, msg: '无法连接服务器，请检查网络或域名配置' })
      },
    })
  })
}

function get(path, data) { return request(path, 'GET', data) }
function post(path, data) { return request(path, 'POST', data) }

// token 存在本地，随请求带上
const TOKEN_KEY = 'ns_token'
const ADMIN_KEY = 'ns_admin_token'

function getToken() { try { return wx.getStorageSync(TOKEN_KEY) || '' } catch (e) { return '' } }
function setToken(t) { try { wx.setStorageSync(TOKEN_KEY, t || '') } catch (e) {} }
function getAdminToken() { try { return wx.getStorageSync(ADMIN_KEY) || '' } catch (e) { return '' } }
function setAdminToken(t) { try { wx.setStorageSync(ADMIN_KEY, t || '') } catch (e) {} }

module.exports = {
  API_BASE: API_BASE,
  get: get,
  post: post,
  // 带登录态
  getAuth: function (path, data) {
    return request(path, 'GET', data, { 'x-token': getToken() })
  },
  postAuth: function (path, data) {
    return request(path, 'POST', data, { 'x-token': getToken() })
  },
  // 带商家登录态
  getAdmin: function (path, data) {
    return request(path, 'GET', data, { 'x-admin-token': getAdminToken() })
  },
  postAdmin: function (path, data) {
    return request(path, 'POST', data, { 'x-admin-token': getAdminToken() })
  },
  getToken: getToken,
  setToken: setToken,
  getAdminToken: getAdminToken,
  setAdminToken: setAdminToken,
}
