# 南松推拿馆预约服务端 —— 微信云托管 Dockerfile
# 零依赖原生 Node HTTP 服务，不需要 npm install，构建快
FROM node:lts-alpine

# 容器默认时区为 UTC，营业时段（9:30-21:30）依赖本地时间，必须切到上海时区
RUN apk add --no-cache tzdata ca-certificates \
  && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production
ENV PORT=80
ENV HOST=0.0.0.0

WORKDIR /app

# 拷贝包管理文件（本项目无第三方依赖，保留以便后续扩展）
COPY package*.json /app/

# 将当前目录下所有文件拷贝到工作目录（.dockerignore 中文件除外）
COPY . /app

# 数据目录：若配置了「存储挂载」，用 DATA_DIR 环境变量指向挂载点即可
RUN mkdir -p /app/data

# 云托管要求监听 PORT（默认 80）
EXPOSE 80

CMD ["node", "index.js"]
