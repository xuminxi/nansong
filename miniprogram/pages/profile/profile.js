// pages/profile/profile.js — 我的：微信授权登录、手机号（自动带入预约）、预约记录、取消预约
const store = require('../../utils/store')
const util = require('../../utils/util')

// 兼容本地版（同步返回）与服务端版（Promise）两种数据层
function asPromise(v) {
  return (v && typeof v.then === 'function') ? v : Promise.resolve(v)
}

Page({
  data: {
    logged: false,
    nickname: '',
    phone: '',
    phoneMasked: '',
    stats: { pending: 0, done: 0, total: 0 },
    tabs: ['全部', '待确认', '已到店', '已完成', '已取消'],
    current: '全部',
    list: [],
  },

  onShow: function () {
    this.refresh()
  },

  refresh: function () {
    const self = this
    const user = store.getUser()
    const phone = user.phone || ''
    asPromise(store.getBookings({ phone: phone })).then(function (mine) {
      self.renderBookings(mine || [], phone, user)
    })
  },

  renderBookings: function (mine, phone, user) {
    const decor = function (b) {
      const meta = store.STATUS_META[b.status]
      return Object.assign({}, b, {
        statusText: meta.text,
        statusCls: meta.cls,
        dateCN: util.fmtDateCN(b.date),
        createdAtText: util.fmtTime(b.createdAt),
        canCancel: b.status === store.STATUS.PENDING,
        // 只有未完成的预约才需要展示核销码
        showCode: b.status === store.STATUS.PENDING || b.status === store.STATUS.ARRIVED,
      })
    }
    const tabMap = { 待确认: 'pending', 已到店: 'arrived', 已完成: 'done', 已取消: 'canceled' }
    const cur = this.data.current
    const list = (cur === '全部'
      ? mine
      : mine.filter(function (b) { return b.status === tabMap[cur] })
    ).map(decor)

    this.setData({
      logged: !!user.logged,
      nickname: user.nickname || '微信用户',
      phone: phone,
      phoneMasked: phone ? phone.slice(0, 3) + '****' + phone.slice(7) : '',
      stats: {
        pending: mine.filter(function (b) { return b.status === 'pending' }).length,
        done: mine.filter(function (b) { return b.status === 'done' }).length,
        total: mine.length,
      },
      list: list,
    })
  },

  // 微信授权登录（本地版：wx.login 建立会话；真实获取微信手机号需正式上线后接入云服务）
  wxLogin: function () {
    const that = this
    store.wxLogin().then(function (res) {
      if (res.ok) {
        wx.showToast({ title: '登录成功', icon: 'success' })
        that.refresh()
      } else {
        wx.showToast({ title: res.msg || '登录失败', icon: 'none' })
      }
    })
  },

  // 修改手机号（保存后预约时自动带入）
  onPhoneInput: function (e) {
    const v = e.detail.value
    this.setData({ phone: v })
    if (util.validPhone(v)) {
      store.saveUser({ phone: v })
      this.setData({ phoneMasked: v.slice(0, 3) + '****' + v.slice(7) })
    }
  },

  onTab: function (e) {
    this.setData({ current: e.currentTarget.dataset.t })
    this.refresh()
  },

  goBooking: function () {
    wx.switchTab({ url: '/pages/services/services' })
  },

  cancel: function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '取消预约',
      content: '确定要取消这条预约吗？',
      confirmColor: '#B4553E',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        asPromise(store.cancelBooking(id, that.data.phone)).then(function (res) {
          wx.hideLoading()
          if (res && res.ok) {
            wx.showToast({ title: '已取消', icon: 'success' })
            that.refresh()
          } else {
            wx.showModal({ title: '无法取消', content: (res && res.msg) || '请稍后再试', showCancel: false })
          }
        })
      },
    })
  },

  // 用微信手机号授权按钮带出真实手机号
  // 前置：小程序为已认证的非个人主体 + 已开通「获取手机号」权限 + 已接入服务端
  onGetPhone: function (e) {
    const code = e.detail && e.detail.code
    if (!code) {
      if (e.detail && e.detail.errMsg && e.detail.errMsg.indexOf('deny') >= 0) {
        wx.showToast({ title: '已取消授权', icon: 'none' })
      } else {
        wx.showToast({ title: '请在真机上授权手机号', icon: 'none' })
      }
      return
    }
    if (typeof store.getPhoneNumber !== 'function') {
      wx.showModal({
        title: '当前为本地版',
        content: '本地数据版无法解密微信手机号，请手动填写，或接入服务端后再使用此功能。',
        showCancel: false,
      })
      return
    }
    const that = this
    wx.showLoading({ title: '获取中', mask: true })
    store.getPhoneNumber(code).then(function (res) {
      wx.hideLoading()
      if (res && res.ok) {
        wx.showToast({ title: '已获取手机号', icon: 'success' })
        that.refresh()
      } else {
        wx.showModal({ title: '获取失败', content: (res && res.msg) || '请稍后再试', showCancel: false })
      }
    })
  },

  goAdmin: function () {
    if (store.isAdmin()) {
      wx.navigateTo({ url: '/pages/admin/bookings/bookings' })
    } else {
      wx.navigateTo({ url: '/pages/admin/login/login' })
    }
  },
})
