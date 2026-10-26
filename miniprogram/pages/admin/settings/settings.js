// pages/admin/settings/settings.js — 商家：店铺设置（门店信息、双电话、导航坐标、轮播管理）
const store = require('../../../utils/store')

const THEMES = ['green', 'gold', 'ink']
const THEME_LABELS = ['松绿', '浅金', '墨灰']

Page({
  data: {
    form: { name: '', slogan: '', desc: '', address: '', hours: '' },
    phone1: '',
    phone2: '',
    lat: '',
    lng: '',
    banners: [],
    themes: THEMES,
    themeLabels: THEME_LABELS,
    editing: null, // 正在编辑的轮播索引
    editThemeIndex: 0,
  },

  onShow: function () {
    if (!store.isAdmin()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    this.refresh()
  },

  refresh: function () {
    const s = store.getStore()
    const phones = s.phones || []
    this.setData({
      form: {
        name: s.name || '',
        slogan: s.slogan || '',
        desc: s.desc || '',
        address: s.address || '',
        hours: s.hours || '',
      },
      phone1: phones[0] || '',
      phone2: phones[1] || '',
      lat: s.lat === undefined || s.lat === null ? '' : String(s.lat),
      lng: s.lng === undefined || s.lng === null ? '' : String(s.lng),
      banners: store.getBanners(),
      editing: null,
    })
  },

  onFormInput: function (e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onPhone: function (e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  onCoord: function (e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  save: function () {
    const f = this.data.form
    if (!f.name.trim()) return wx.showToast({ title: '店名不能为空', icon: 'none' })

    const phones = []
    if (this.data.phone1.trim()) phones.push(this.data.phone1.trim())
    if (this.data.phone2.trim()) phones.push(this.data.phone2.trim())
    if (phones.length === 0) return wx.showToast({ title: '请至少填写一个电话', icon: 'none' })

    const lat = parseFloat(this.data.lat)
    const lng = parseFloat(this.data.lng)
    if (isNaN(lat) || isNaN(lng)) {
      return wx.showToast({ title: '导航坐标需为数字', icon: 'none' })
    }

    store.saveStore({
      name: f.name.trim(),
      slogan: f.slogan.trim(),
      desc: f.desc.trim(),
      address: f.address.trim(),
      hours: f.hours.trim(),
      phones: phones,
      lat: lat,
      lng: lng,
    })
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  // ---------- 轮播管理 ----------
  addBanner: function () {
    const list = this.data.banners.slice()
    if (list.length >= 6) return wx.showToast({ title: '最多 6 张轮播', icon: 'none' })
    list.push({ tag: '南松推拿馆', title: '新轮播标题', sub: '副标题', theme: 'green' })
    this.setData({ banners: list, editing: list.length - 1, editThemeIndex: 0 })
  },

  editBanner: function (e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const theme = this.data.banners[idx].theme
    this.setData({
      editing: idx,
      editThemeIndex: Math.max(0, THEMES.indexOf(theme)),
    })
  },

  onBannerInput: function (e) {
    const idx = this.data.editing
    if (idx === null) return
    const field = e.currentTarget.dataset.field
    this.setData({ ['banners[' + idx + '].' + field]: e.detail.value })
  },

  onBannerTheme: function (e) {
    const idx = this.data.editing
    if (idx === null) return
    const v = Number(e.detail.value)
    this.setData({ ['banners[' + idx + '].theme']: THEMES[v] })
  },

  closeBannerEdit: function () {
    this.setData({ editing: null })
  },

  removeBanner: function (e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const list = this.data.banners
    const self = this
    wx.showModal({
      title: '删除轮播',
      content: '确定删除「' + (list[idx].title || '该轮播') + '」？',
      success: function (r) {
        if (!r.confirm) return
        const next = self.data.banners.slice()
        next.splice(idx, 1)
        store.saveBanners(next)
        self.setData({ banners: next, editing: null })
        wx.showToast({ title: '已删除', icon: 'success' })
      },
    })
  },

  saveBanners: function () {
    const list = this.data.banners.filter(function (b) {
      return b.title && String(b.title).trim()
    })
    if (list.length === 0) return wx.showToast({ title: '至少保留一张轮播', icon: 'none' })
    store.saveBanners(list)
    this.setData({ banners: list, editing: null })
    wx.showToast({ title: '轮播已保存', icon: 'success' })
  },

  pickLocation: function () {
    const self = this
    wx.chooseLocation({
      success: function (r) {
        if (typeof r.latitude !== 'number') return
        self.setData({
          lat: String(Number(r.latitude.toFixed(6))),
          lng: String(Number(r.longitude.toFixed(6))),
        })
        if (r.address) self.setData({ 'form.address': r.address })
        wx.showToast({ title: '已选取坐标', icon: 'success' })
      },
    })
  },

  logout: function () {
    wx.showModal({
      title: '退出登录',
      content: '确定退出商家管理？',
      success: function (r) {
        if (!r.confirm) return
        store.adminLogout()
        wx.switchTab({ url: '/pages/profile/profile' })
      },
    })
  },
})
