// server/config.js —— 服务端配置
// 全部配置均可通过环境变量注入，适配微信云托管 / 自建服务器 / 本地调试三种场景。
// 敏感信息（AppSecret、商家密码、云密钥）一律不要写进代码。
const path = require('path')

// 数据落盘目录：云托管容器不可持久化，建议指向对象存储；本地默认 server/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')

const appid = process.env.APPID || process.env.WX_APPID || ''
const secret = process.env.SECRET || process.env.WX_SECRET || ''

module.exports = {
  // —— 小程序 ——
  appid: appid,
  secret: secret,
  // 未配置 AppID 且显式设置 MOCK_LOGIN=1 时，才允许走「假登录」分支（仅供本地联调）
  mockLogin: process.env.MOCK_LOGIN === '1',

  // —— 商家后台 ——
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // —— 网络 ——
  // 云托管要求监听环境变量 PORT（缺省 80），且必须绑定 0.0.0.0
  port: Number(process.env.PORT || 80),
  host: process.env.HOST || '0.0.0.0',
  cors: process.env.CORS !== '0',

  // —— 数据 ——
  dataFile: process.env.DATA_FILE || path.join(DATA_DIR, 'data.json'),

  // —— 持久化后端 ——
  // file: 写本地文件（容器环境会丢，仅本地/有持久盘时用）
  // cos : 腾讯云对象存储，零依赖手写签名，云托管推荐
  storage: {
    type: (process.env.STORAGE || 'file').toLowerCase(),
    region: process.env.COS_REGION || '',
    bucket: process.env.COS_BUCKET || '',
    key: process.env.COS_KEY || 'nansong/data.json',
    secretId: process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRET_ID || '',
    secretKey: process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRET_KEY || '',
    // 使用临时密钥（STS）时必填，永久密钥留空
    sessionToken: process.env.COS_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSION_TOKEN || '',
  },
}
