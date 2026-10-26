// pages/admin/login/login.js — 商家登录
const store = require('../../../utils/store')

Page({
  data: {
    pwd: '',
  },

  onPwd: function (e) {
    this.setData({ pwd: e.detail.value })
  },

  login: function () {
    // 本地版同步返回布尔值，服务端版返回 Promise，两种都支持
    const r = store.adminLogin(this.data.pwd)
    const done = function (ok, msg) {
      if (ok) wx.redirectTo({ url: '/pages/admin/bookings/bookings' })
      else wx.showToast({ title: msg || '密码不正确', icon: 'none' })
    }
    if (r && typeof r.then === 'function') {
      wx.showLoading({ title: '登录中', mask: true })
      r.then(function (res) {
        wx.hideLoading()
        done(res && res.ok, res && res.msg)
      })
    } else {
      done(!!r)
    }
  },

  backHome: function () {
    wx.switchTab({ url: '/pages/profile/profile' })
  },
})
