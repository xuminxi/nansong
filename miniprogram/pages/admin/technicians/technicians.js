// pages/admin/technicians/technicians.js — 商家：技师管理（新增/编辑/上下架/删除）
const store = require('../../../utils/store')

const EMPTY_FORM = { id: '', name: '', gender: 'm', title: '', desc: '', tags: '' }

Page({
  data: {
    list: [],
    formVisible: false,
    form: Object.assign({}, EMPTY_FORM),
    genders: ['男', '女'],
    genderIndex: 0,
  },

  onShow: function () {
    if (!store.isAdmin()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    this.refresh()
  },

  refresh: function () {
    const list = store.getTechs(true).map(function (t) {
      return Object.assign({}, t, {
        zi: t.name ? t.name.slice(0, 1) : '',
        tagsText: (t.tags || []).join(' · '),
      })
    })
    this.setData({ list: list })
  },

  // 上传/更换技师头像（chooseMedia → 持久保存到用户目录）
  uploadAvatar: function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: function (res) {
        if (!res.tempFiles || !res.tempFiles[0]) return
        const saved = store.saveTechAvatar(id, res.tempFiles[0].tempFilePath)
        if (saved) {
          wx.showToast({ title: '头像已更新', icon: 'success' })
          that.refresh()
        } else {
          wx.showToast({ title: '头像保存失败', icon: 'none' })
        }
      },
    })
  },

  showAdd: function () {
    this.setData({
      formVisible: true,
      form: Object.assign({}, EMPTY_FORM),
      genderIndex: 0,
    })
  },

  showEdit: function (e) {
    const t = store.getTech(e.currentTarget.dataset.id)
    if (!t) return
    this.setData({
      formVisible: true,
      form: {
        id: t.id,
        name: t.name,
        gender: t.gender,
        title: t.title,
        desc: t.desc,
        tags: (t.tags || []).join(' '),
      },
      genderIndex: t.gender === 'f' ? 1 : 0,
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

  onGender: function (e) {
    const idx = Number(e.detail.value)
    this.setData({
      genderIndex: idx,
      'form.gender': idx === 1 ? 'f' : 'm',
    })
  },

  save: function () {
    const f = this.data.form
    if (!f.name.trim()) return wx.showToast({ title: '请填写技师姓名', icon: 'none' })
    const tags = f.tags
      .split(/[\s,，、]+/)
      .filter(function (s) { return s })
      .slice(0, 4)
    store.saveTech({
      id: f.id || undefined,
      name: f.name.trim(),
      gender: f.gender,
      title: f.title.trim() || '理疗师',
      desc: f.desc.trim(),
      tags: tags,
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this.setData({ formVisible: false })
    this.refresh()
  },

  toggleStatus: function (e) {
    const id = e.currentTarget.dataset.id
    const t = store.getTech(id)
    if (t) {
      store.saveTech({ id: id, status: t.status === 'on' ? 'off' : 'on' })
      this.refresh()
    }
  },

  remove: function (e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '删除技师',
      content: '删除后该技师将不可再被预约，确定删除？',
      confirmColor: '#B4553E',
      success: function (r) {
        if (!r.confirm) return
        store.removeTech(id)
        wx.showToast({ title: '已删除', icon: 'success' })
        that.refresh()
      },
    })
  },
})
