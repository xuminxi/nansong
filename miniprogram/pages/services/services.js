// pages/services/services.js — 服务项目：分类展示推拿、足浴、肩颈、头疗
const store = require('../../utils/store')
const util = require('../../utils/util')

Page({
  data: {
    categories: ['全部'].concat(store.CATEGORIES),
    current: '全部',
    list: [],
  },

  onShow: function () {
    const self = this
    if (typeof store.pull === 'function') {
      store.pull().then(function () { self.refresh() })
    } else {
      self.refresh()
    }
  },

  refresh: function () {
    const all = store.getServices({ onOnly: true })
    const cur = this.data.current
    const list = (cur === '全部' ? all : all.filter(function (s) { return s.category === cur })).map(function (s) {
      return Object.assign({}, s, { color: util.avatarColor(s.id), zi: s.category.slice(0, 1) })
    })
    this.setData({ list: list })
  },

  onTab: function (e) {
    this.setData({ current: e.currentTarget.dataset.c })
    this.refresh()
  },

  goBooking: function (e) {
    wx.navigateTo({ url: '/pages/booking/booking?serviceId=' + e.currentTarget.dataset.id })
  },
})
