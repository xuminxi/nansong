// pages/admin/bookings/bookings.js — 商家：预约列表与状态管理
const store = require('../../../utils/store')
const util = require('../../../utils/util')

// 兼容本地版（同步返回）与服务端版（Promise）两种数据层
function asPromise(v) {
  return (v && typeof v.then === 'function') ? v : Promise.resolve(v)
}

Page({
  data: {
    tabs: ['全部', '待确认', '已到店', '已完成', '已取消'],
    current: '全部',
    list: [],
    todayCount: 0,
    pendingCount: 0,
  },

  onShow: function () {
    if (!store.isAdmin()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    this.refresh()
  },

  refresh: function () {
    const self = this
    asPromise(store.getBookings()).then(function (all) { self.renderList(all || []) })
  },

  renderList: function (all) {
    const tabMap = { 待确认: 'pending', 已到店: 'arrived', 已完成: 'done', 已取消: 'canceled' }
    const cur = this.data.current
    const list = (cur === '全部' ? all : all.filter(function (b) { return b.status === tabMap[cur] })).map(function (b) {
      const meta = store.STATUS_META[b.status]
      return Object.assign({}, b, {
        statusText: meta.text,
        statusCls: meta.cls,
        dateCN: util.fmtDateCN(b.date),
        createdAtText: util.fmtTime(b.createdAt),
        // 各状态下可执行的操作
        canArrive: b.status === 'pending',
        canDone: b.status === 'pending' || b.status === 'arrived',
        canCancel: b.status === 'pending' || b.status === 'arrived',
        // 「未到店」只在待确认时可标记（已到店/已完成说明人确实来了）
        canNoshow: b.status === 'pending',
      })
    })
    const today = util.fmtDate(new Date())
    this.setData({
      list: list,
      todayCount: all.filter(function (b) { return b.date === today && b.status !== 'canceled' }).length,
      pendingCount: all.filter(function (b) { return b.status === 'pending' }).length,
    })
  },

  onTab: function (e) {
    this.setData({ current: e.currentTarget.dataset.t })
    this.refresh()
  },

  setStatus: function (e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const titles = { arrived: '确认为「已到店」？', done: '确认为「已完成」？', canceled: '确认取消该预约？' }
    const that = this
    wx.showModal({
      title: '修改状态',
      content: titles[status] || '确认修改？',
      confirmColor: status === 'canceled' ? '#B4553E' : '#486552',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        asPromise(store.updateBookingStatus(id, status)).then(function (ok) {
          wx.hideLoading()
          if (ok) {
            wx.showToast({ title: '已更新', icon: 'success' })
            that.refresh()
          } else {
            wx.showToast({ title: '更新失败', icon: 'none' })
          }
        })
      },
    })
  },

  // 标记「未到店」：计入该顾客爽约次数，达到阈值后系统自动限制其预约
  markNoshow: function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '标记未到店',
      content: '该顾客未按约到店？标记后将计入爽约记录，累计达到上限会自动限制其预约。',
      confirmText: '标记爽约',
      confirmColor: '#B4553E',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        // 服务端模式下第三个参数 { noshow: true } 才会计数；本地版忽略该参数
        asPromise(store.updateBookingStatus(id, 'canceled', { noshow: true })).then(function (ok) {
          wx.hideLoading()
          if (ok) {
            wx.showToast({ title: '已标记', icon: 'success' })
            that.refresh()
          } else {
            wx.showToast({ title: '操作失败', icon: 'none' })
          }
        })
      },
    })
  },

  callCustomer: function (e) {
    const phone = e.currentTarget.dataset.phone
    if (phone) wx.makePhoneCall({ phoneNumber: String(phone) })
  },
})
