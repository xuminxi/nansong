// pages/booking/booking.js — 预约下单
// 两种模式：
//   quick：从「项目」tab 进入 —— 已选项目，自动匹配最近可约时段，两位技师均空闲时随机分配；
//   tech ：从「技师」tab 进入 —— 锁定该技师，只看 TA 的空闲时间，手动自选时段。
// 校验：时间冲突、不可跨营业时间，由数据层（本地或服务端）统一处理。
// 说明：数据层的「余量查询 / 下单」在本地版返回同步值、服务端版返回 Promise，
//       这里用 asPromise 统一包装，两种模式共用一份页面代码。
const store = require('../../utils/store')
const util = require('../../utils/util')

function asPromise(v) {
  return (v && typeof v.then === 'function') ? v : Promise.resolve(v)
}

Page({
  data: {
    mode: 'quick', // quick | tech
    services: [],
    serviceId: '',
    selService: null,
    techs: [],
    tech: null,
    days: [],
    date: '',
    times: [],
    time: '',
    endTime: '',
    matchInfo: null,
    phone: '',
    remark: '',
    phoneError: '',
    submitting: false,
    loadingTimes: false,
  },

  onLoad: function (query) {
    const services = store.getServices({ onOnly: true }).map(function (s) {
      return Object.assign({}, s, { color: util.avatarColor(s.id), zi: s.category.slice(0, 1) })
    })
    const techs = store.getTechs(false).map(function (t) {
      return Object.assign({}, t, { color: util.avatarColor(t.id), zi: t.name.slice(0, 1) })
    })
    const days = util.nextDays(7)

    let serviceId = ''
    if (query.serviceId && services.some(function (s) { return s.id === query.serviceId })) {
      serviceId = query.serviceId
    } else if (services.length > 0) {
      serviceId = services[0].id
    }

    let mode = 'quick'
    let tech = null
    if (query.techId && techs.some(function (t) { return t.id === query.techId })) {
      mode = 'tech'
      tech = techs.filter(function (t) { return t.id === query.techId })[0]
      if (!serviceId) serviceId = services.length > 0 ? services[0].id : ''
    }

    const user = store.getUser()
    this.setData({
      mode: mode,
      services: services,
      techs: techs,
      tech: tech,
      days: days,
      date: days[0].date,
      serviceId: serviceId,
      phone: user.phone || '',
    })
    this.applySelection(true)
  },

  // 根据当前项目拉取可选时段；quick 模式首次进入/换项目时自动匹配最近可约
  applySelection: function (autoMatch) {
    const d = this.data
    const self = this
    const svc = d.services.filter(function (s) { return s.id === d.serviceId })[0] || null
    const duration = svc ? svc.duration : 30
    const targetTech = d.mode === 'tech' && d.tech ? d.tech.id : 'auto'

    this.setData({ loadingTimes: true, selService: svc })

    const finish = function (times, extra) {
      const patch = { times: times || [], loadingTimes: false }
      if (extra) Object.assign(patch, extra)
      self.setData(patch)
    }

    if (d.mode === 'quick' && autoMatch) {
      return asPromise(store.autoMatchNearest(duration)).then(function (m) {
        if (m) {
          const day = d.days.filter(function (x) { return x.date === m.date })[0]
          return asPromise(store.availableTimes(m.date, 'auto', duration)).then(function (times) {
            finish(times, {
              matchInfo: {
                date: m.date,
                time: m.time,
                endTime: m.endTime,
                freeCount: m.freeCount,
                dateCN: util.fmtDateCN(m.date),
                week: day ? day.week : '',
              },
              date: m.date,
              time: m.time,
              endTime: m.endTime,
            })
          })
        }
        return asPromise(store.availableTimes(d.date, 'auto', duration)).then(function (times) {
          finish(times, { matchInfo: null, time: '', endTime: '' })
        })
      }).catch(function () {
        finish([], { matchInfo: null })
      })
    }

    return asPromise(store.availableTimes(d.date, targetTech, duration)).then(function (times) {
      finish(times, {
        time: '',
        endTime: '',
        matchInfo: d.mode === 'quick' ? null : d.matchInfo,
      })
    }).catch(function () {
      finish([], {})
    })
  },

  onService: function (e) {
    this.setData({ serviceId: e.currentTarget.dataset.id })
    this.applySelection(this.data.mode === 'quick')
    if (this.data.mode === 'tech') this.scrollTo('#step-time')
  },

  onDay: function (e) {
    this.setData({ date: e.currentTarget.dataset.date })
    this.applySelection(false)
  },

  onTime: function (e) {
    const t = e.currentTarget.dataset
    if (t.disabled) {
      wx.showToast({ title: '该时段不可选', icon: 'none' })
      return
    }
    const slot = this.data.times.filter(function (x) { return x.time === t.time })[0]
    this.setData({ time: t.time, endTime: slot ? slot.endTime : '' })
  },

  // 一键回到"最近可约"
  useMatch: function () {
    const m = this.data.matchInfo
    if (!m) return
    const svc = this.data.selService
    const duration = svc ? svc.duration : 30
    const self = this
    asPromise(store.availableTimes(m.date, 'auto', duration)).then(function (times) {
      self.setData({ date: m.date, time: m.time, endTime: m.endTime, times: times || [] })
    })
  },

  onPhone: function (e) {
    this.setData({ phone: e.detail.value, phoneError: '' })
  },
  onRemark: function (e) {
    this.setData({ remark: e.detail.value })
  },

  scrollTo: function (selector) {
    try {
      wx.pageScrollTo({ selector: selector, duration: 260 })
    } catch (err) {
      // 低版本基础库不支持 selector，忽略即可
    }
  },

  submit: function () {
    if (this.data.submitting) return
    const d = this.data
    const self = this

    if (!d.serviceId) return wx.showToast({ title: '请先选择服务项目', icon: 'none' })
    if (!d.time) {
      wx.showModal({
        title: '还差一步',
        content: '请先在上方「选择时间」里点选一个时段，再提交预约。',
        showCancel: false,
      })
      this.scrollTo('#step-time')
      return
    }
    if (!util.validPhone(d.phone)) {
      this.setData({ phoneError: '请填写正确的 11 位手机号' })
      wx.showModal({
        title: '手机号有误',
        content: '请填写 11 位手机号，商家需要用它联系您确认预约。',
        showCancel: false,
      })
      return
    }

    this.setData({ submitting: true })
    asPromise(store.createBooking({
      serviceId: d.serviceId,
      techId: d.mode === 'tech' && d.tech ? d.tech.id : 'auto',
      date: d.date,
      time: d.time,
      phone: d.phone,
      remark: d.remark,
    })).then(function (res) {
      self.setData({ submitting: false })
      if (!res || !res.ok) {
        wx.showModal({ title: '预约失败', content: (res && res.msg) || '请稍后再试', showCancel: false })
        self.applySelection(false)
        return
      }
      store.saveUser({ phone: d.phone })
      const b = res.booking
      wx.showModal({
        title: '预约成功',
        content:
          b.date.replace(/-/g, '/') + ' ' + b.time + '-' + b.endTime + ' · ' +
          b.serviceName + '（' + b.techName + '），商家确认后到店即可。可在「我的」中查看记录。',
        confirmText: '查看预约',
        showCancel: false,
        success: function () { wx.switchTab({ url: '/pages/profile/profile' }) },
      })
    })
  },
})
