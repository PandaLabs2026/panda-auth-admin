# PandaAuth.WebAdmin 镜像（管理后台 BFF + React SPA，生产绑定 127.0.0.1:9006）
# 自包含构建（本仓即上下文，前端在容器内 node:24 构建）：
#   docker build -t panda-auth-webadmin:latest panda-auth-webadmin/

# ================= 前端构建 =================
FROM node:24-bookworm-slim AS frontend
WORKDIR /fe
# lockfile 必选：去掉 `*` 通配后缺失即构建失败，避免装出与提交内容无关的依赖树
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ================= 后端构建 =================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY PandaAuth.WebAdmin.slnx global.json Directory.Build.props ./
COPY src/ src/
RUN dotnet publish src/PandaAuth.WebAdmin -c Release -o /app --nologo

# ================= 运行阶段 =================
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 非 root 运行：aspnet 基础镜像自带 uid 1654 的 app 用户
COPY --chown=app:app --from=build /app .
COPY --chown=app:app --from=frontend /src/PandaAuth.WebAdmin/wwwroot/admin ./wwwroot/admin/

# DataProtection 密钥目录必须在镜像里预建并归 app 所有：命名卷首次创建时继承的是镜像内
# 该路径的属主，目录缺失或属 root 时 app 写不进密钥，启动即失败（compose 挂载了本路径）。
RUN mkdir -p /var/lib/panda-auth/webadmin-dataprotection \
    && chown app:app /var/lib/panda-auth/webadmin-dataprotection

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://127.0.0.1:9006

EXPOSE 9006

# 镜像级探活（**仅在裸 docker run 下生效**）：deploy/docker-compose.yml 给每个服务都写了
# 容器级 healthcheck，容器级优先、会**覆盖**本指令（已实测）。两处 URL 与参数刻意同构；
# compose 用的 start-period 是 15s 而非此处的 30s —— 仍然安全：start-period 内的失败
# 不计入 retries，之后须连续 3 次失败（每次间隔 interval=30s）才会被标 unhealthy。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:9006/admin/healthz || exit 1

USER app

ENTRYPOINT ["dotnet", "PandaAuth.WebAdmin.dll"]
