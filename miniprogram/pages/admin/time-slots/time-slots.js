// pages/admin/time-slots/time-slots.js — 商家：营业时间与可约开始时间设置
const store = require('../../../utils/store')
const util = require('../../../utils/util')

Page({
  data: {
    cfg: { open: '9:30', close: '21:30', stepMin: 15 },
    steps: [10, 15, 30, 60],
    stepLabels: ['10 分钟', '15 分钟', '30 分钟', '60 分钟'],
    stepIndex: 1,
    preview: [],
    previewCount: 0,
  },

  onShow: function () {
    if (!store.isAdmin()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    const cfg = store.getSlotConfig()
    this.setData({
      cfg: cfg,
      stepIndex: Math.max(0, this.data.steps.indexOf(Number(cfg.stepMin))),
    })
    this.previewSlots()
  },

  previewSlots: function () {
    const points = store.genStartPoints(this.data.cfg)
    this.setData({ preview: points, previewCount: points.length })
  },

  onOpen: function (e) {
    this.setData({ 'cfg.open': e.detail.value })
    this.previewSlots()
  },
  onClose: function (e) {
    this.setData({ 'cfg.close': e.detail.value })
    this.previewSlots()
  },
  onStep: function (e) {
    const idx = Number(e.detail.value)
    this.setData({ stepIndex: idx, 'cfg.stepMin': this.data.steps[idx] })
    this.previewSlots()
  },

  save: function () {
    const cfg = this.data.cfg
    if (util.hmToMin(cfg.close) <= util.hmToMin(cfg.open)) {
      return wx.showToast({ title: '打烊时间需晚于开门时间', icon: 'none' })
    }
    store.saveSlotConfig({
      open: cfg.open,
      close: cfg.close,
      stepMin: cfg.stepMin,
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this.previewSlots()
  },
})
