// pages/admin/services/services.js — 商家：项目管理（新增/编辑/上下架）
const store = require('../../../utils/store')

const EMPTY_FORM = { id: '', category: '推拿', name: '', price: '', duration: '', desc: '' }

Page({
  data: {
    categories: store.CATEGORIES,
    groups: [],
    formVisible: false,
    form: Object.assign({}, EMPTY_FORM),
    categoryIndex: 0,
  },

  onShow: function () {
    if (!store.isAdmin()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    this.refresh()
  },

  refresh: function () {
    const all = store.getServices()
    const groups = store.CATEGORIES.map(function (c) {
      return {
        category: c,
        items: all.filter(function (s) { return s.category === c }),
      }
    })
    this.setData({ groups: groups })
  },

  showAdd: function () {
    this.setData({ formVisible: true, form: Object.assign({}, EMPTY_FORM), categoryIndex: 0 })
  },

  showEdit: function (e) {
    const s = store.getService(e.currentTarget.dataset.id)
    if (!s) return
    this.setData({
      formVisible: true,
      form: {
        id: s.id,
        category: s.category,
        name: s.name,
        price: String(s.price),
        duration: String(s.duration),
        desc: s.desc,
      },
      categoryIndex: Math.max(0, store.CATEGORIES.indexOf(s.category)),
    })
  },

  hideForm: function () {
    this.setData({ formVisible: false })
  },

  // 阻止弹层内部点击冒泡到遮罩
  noop: function () {},

  onFormInput: function (e) {
    const field = e.currentTarget.dataset.field
    const key = 'form.' + field
    this.setData({ [key]: e.detail.value })
  },

  onCategory: function (e) {
    const idx = Number(e.detail.value)
    this.setData({ categoryIndex: idx, 'form.category': store.CATEGORIES[idx] })
  },

  save: function () {
    const f = this.data.form
    if (!f.name.trim()) return wx.showToast({ title: '请填写项目名称', icon: 'none' })
    const price = Number(f.price)
    const duration = Number(f.duration)
    if (!price || price <= 0) return wx.showToast({ title: '请填写正确的价格', icon: 'none' })
    if (!duration || duration <= 0) return wx.showToast({ title: '请填写正确的时长（分钟）', icon: 'none' })
    const existing = f.id ? store.getService(f.id) : null
    store.saveService({
      id: f.id || undefined,
      category: f.category,
      name: f.name.trim(),
      price: Math.round(price),
      duration: Math.round(duration),
      desc: f.desc.trim(),
      on: existing ? existing.on : true,
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this.setData({ formVisible: false })
    this.refresh()
  },

  toggle: function (e) {
    store.toggleService(e.currentTarget.dataset.id)
    this.refresh()
  },
})
