// pages/index/index.js — 首页：轮播、门店介绍、营业时间、双电话一键拨打、地址导航、技师展示
const store = require('../../utils/store')
const util = require('../../utils/util')

Page({
  data: {
    storeInfo: {},
    phones: [],
    banners: [],
    techs: [],
    services: [],
  },

  onShow: function () {
    // 服务端模式下先拉一次最新快照，再渲染；本地版没有 pull，直接渲染
    const self = this
    if (typeof store.pull === 'function') {
      store.pull().then(function () { self.refresh() })
    } else {
      self.refresh()
    }
  },

  refresh: function () {
    const storeInfo = store.getStore()
    const techs = store.getTechs(false).map(function (t) {
      return Object.assign({}, t, { zi: t.name.slice(0, 1) })
    })
    const services = store.getServices({ onOnly: true }).slice(0, 6).map(function (s) {
      return Object.assign({}, s, { color: util.avatarColor(s.id), zi: s.category.slice(0, 1) })
    })
    this.setData({
      storeInfo: storeInfo,
      phones: storeInfo.phones || [],
      banners: store.getBanners(),
      techs: techs,
      services: services,
    })
  },

  goServices: function () {
    wx.switchTab({ url: '/pages/services/services' })
  },
  goTechs: function () {
    wx.switchTab({ url: '/pages/technicians/technicians' })
  },
  goBooking: function (e) {
    wx.navigateTo({ url: '/pages/booking/booking?serviceId=' + e.currentTarget.dataset.id })
  },

  // 一键拨打（data-idx 区分主/副号）
  callShop: function (e) {
    const idx = e.currentTarget.dataset.idx || 0
    const phone = this.data.phones[idx]
    if (phone) wx.makePhoneCall({ phoneNumber: String(phone) })
  },

  // 地址导航：跳转微信内置地图
  openMap: function () {
    const s = this.data.storeInfo
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number' || !s.lat || !s.lng) {
      wx.showToast({ title: '商家未设置导航坐标', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: s.lat,
      longitude: s.lng,
      name: s.name,
      address: s.address,
      scale: 17,
    })
  },
})
