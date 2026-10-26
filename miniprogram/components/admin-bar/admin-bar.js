// components/admin-bar.js — 商家后台底部导航
Component({
  properties: {
    current: { type: String, value: '' },
  },
  data: {
    tabs: [
      { key: 'bookings', zi: '约', text: '预约', url: '/pages/admin/bookings/bookings' },
      { key: 'technicians', zi: '师', text: '技师', url: '/pages/admin/technicians/technicians' },
      { key: 'services', zi: '项', text: '项目', url: '/pages/admin/services/services' },
      { key: 'time-slots', zi: '时', text: '时段', url: '/pages/admin/time-slots/time-slots' },
      { key: 'settings', zi: '设', text: '设置', url: '/pages/admin/settings/settings' },
    ],
  },
  methods: {
    onTap: function (e) {
      const url = e.currentTarget.dataset.url
      if (url) wx.redirectTo({ url: url })
    },
  },
})
