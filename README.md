# 南松推拿馆 · 预约服务端

微信小程序「南松推拿馆」的后端服务。**零依赖原生 Node HTTP 服务**（不用 Express、不装 npm 包）。

| 目录 | 内容 |
|---|---|
| 仓库根 | **服务端**，微信云托管从这里构建（`Dockerfile` 在根，构建目录留空） |
| `miniprogram/` | 微信小程序前端代码（仅作版本管理，云托管不构建它） |

## 快速开始

完整部署步骤、自检清单、常见坑见 **[部署说明.md](./部署说明.md)**。

一句话版：推代码 → 云托管构建（端口 80）→ 控制台填环境变量 → 配存储挂载。

## 项目结构

```
.
├── Dockerfile
├── container.config.json
├── index.js          入口：HTTP 路由 + 鉴权
├── config.js         配置（全部走环境变量）
├── db.js             JSON 单文件库（原子写，失败降级覆盖写）
├── storage.js        COS 对象存储后端（零依赖手写签名）
├── core.js           预约/时段/冲突校验/核销
├── risk.js           风控 8 条规则 + 黑名单
├── wx.js             code2Session、获取手机号
└── miniprogram/      小程序前端（不参与构建）
```

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health`、`/` | 健康检查（云托管存活探针） |
| POST | `/api/auth/login` | `wx.login` 的 code 换 openid + 登录态 |
| POST | `/api/auth/phone` | 手机号按钮 code 换真实手机号 |
| GET | `/api/store`、`/api/banners`、`/api/techs`、`/api/services`、`/api/slots` | 门店与项目数据 |
| GET | `/api/availability`、`/api/free-ranges`、`/api/auto-match` | 可约时段（按时长占用，两技师独立排班） |
| POST | `/api/bookings` | 下单（含风控校验，返回 6 位核销码） |
| POST | `/api/bookings/cancel` | 顾客自助取消 |
| POST | `/api/auth/admin` | 商家登录 |
| GET/POST | `/api/admin/*` | 订单管理、轮播、技师、项目、时段、核销、风控 |

## 环境变量（云托管控制台填写）

- 必填：`APPID` `SECRET` `ADMIN_PASSWORD`
- 持久化推荐：`DATA_DIR=/mnt/cos`（配合控制台「存储挂载」）
- 备选直写 COS：`STORAGE=cos` `COS_REGION` `COS_BUCKET` `COS_SECRET_ID` `COS_SECRET_KEY`
- 🚫 禁止：`MOCK_LOGIN`（本地联调专用，线上开了风控等于没有）

## 本地跑

```bash
PORT=3000 MOCK_LOGIN=1 ADMIN_PASSWORD=123456 node index.js
# 或
npm run dev
```

## 注意

- 容器默认 UTC，营业时段依赖本地时间，`Dockerfile` 已强制 `Asia/Shanghai`，不要覆盖 `TZ`
- 云托管容器不可持久化，务必配置存储挂载或 COS，否则重启后预约单会丢
