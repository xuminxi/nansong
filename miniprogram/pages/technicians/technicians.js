// pages/technicians/technicians.js — 技师：头像、简介、擅长、空闲时段
const store = require('../../utils/store')
const util = require('../../utils/util')

// 兼容本地版（同步返回）与服务端版（Promise）两种数据层
function asPromise(v) {
  return (v && typeof v.then === 'function') ? v : Promise.resolve(v)
}

Page({
  data: {
    techs: [],
    expandedId: '',
    freeList: [], // 展开技师的今日空闲区间
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
    const techs = store.getTechs(false).map(function (t) {
      return Object.assign({}, t, {
        color: util.avatarColor(t.id),
        zi: t.name.slice(0, 1),
        tagsText: (t.tags || []).join(' · '),
      })
    })
    this.setData({ techs: techs, expandedId: '', freeList: [] })
  },

  // 展开/收起该技师今日空闲区间
  toggleTimes: function (e) {
    const id = e.currentTarget.dataset.id
    if (this.data.expandedId === id) {
      this.setData({ expandedId: '', freeList: [] })
      return
    }
    const date = util.fmtDate(new Date())
    const nowMin = util.hmToMin(util.nowHm())
    const self = this
    this.setData({ expandedId: id, freeList: [], freeLoading: true })
    asPromise(store.freeRanges(date, id)).then(function (free) {
      // 只显示尚未过去的区间
      const list = (free || []).filter(function (r) { return util.hmToMin(r.end) > nowMin })
      self.setData({ freeList: list, freeLoading: false })
    })
  },

  // 预约该技师（tech 模式：只看 TA 的空闲时间，手动自选时段）
  goBooking: function (e) {
    wx.navigateTo({ url: '/pages/booking/booking?techId=' + e.currentTarget.dataset.id })
  },
})
