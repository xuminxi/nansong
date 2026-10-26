// utils/util.js — 通用工具：日期、校验、颜色
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// Date -> 'YYYY-MM-DD'
function fmtDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

// 未来 n 天（含今天）的日期选项
function nextDays(n) {
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const out = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    out.push({
      date: fmtDate(d),
      month: pad2(d.getMonth() + 1) + '月',
      day: pad2(d.getDate()),
      week: i === 0 ? '今天' : weeks[d.getDay()],
      isToday: i === 0,
    })
  }
  return out
}

// 'HH:mm' -> 分钟数
function hmToMin(hm) {
  const parts = hm.split(':')
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
}

// 分钟数 -> 'HH:mm'
function minToHm(m) {
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60)
}

function nowHm() {
  const d = new Date()
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

function validPhone(p) {
  return /^1\d{10}$/.test(p)
}

// 根据字符串稳定地取一个柔和的 avatar 底色
const AVATAR_COLORS = ['#5F7A66', '#7C6A54', '#8A9A8B', '#6B7A8F', '#A08D6E', '#77857A']
function avatarColor(seed) {
  let h = 0
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// 时间戳 -> 'MM-DD HH:mm'
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

// 'YYYY-MM-DD' -> 'M月D日'
function fmtDateCN(dateStr) {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日'
}

function genId(prefix) {
  return (prefix || '') + Date.now() + Math.floor(Math.random() * 90 + 10)
}

module.exports = {
  pad2,
  fmtDate,
  nextDays,
  hmToMin,
  minToHm,
  nowHm,
  validPhone,
  avatarColor,
  fmtTime,
  fmtDateCN,
  genId,
}
