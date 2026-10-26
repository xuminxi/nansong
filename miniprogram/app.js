// app.js — 按摩店线上预约小程序（本地数据版）
// 首次启动时初始化示例数据（店铺信息 / 技师 / 项目 / 时段），全部存储在本机 storage。
const store = require('./utils/store')

App({
  onLaunch: function () {
    store.ensureInit()
  },
})
