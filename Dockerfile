# PandaAuth.Admin 镜像（管理后台 BFF + React SPA；开发绑定 localhost:9006，生产端口由部署 env ASPNETCORE_URLS 注入，t0000 现网 10002）
# 工作区根目录为构建上下文，包含同级 panda-auth-share ProjectReference。
#   docker build -f panda-auth-admin/Dockerfile -t panda-auth-admin:latest .
# 上下文过滤走同目录的 Dockerfile.dockerignore（BuildKit 按 Dockerfile 名取用），
# 本仓的 .dockerignore 对工作区根上下文不生效——见 Dockerfile.dockerignore 头注释
# 与 panda-auth-me 同名文件（同款结构）。

# ================= 前端构建 =================
# 基础镜像 digest 钉值，原 tag：node:24-bookworm-slim（2026-10-06 解析）
FROM node@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS frontend
WORKDIR /src/panda-auth-admin/frontend
# lockfile 必选：去掉 `*` 通配后缺失即构建失败，避免装出与提交内容无关的依赖树
COPY panda-auth-admin/frontend/package.json panda-auth-admin/frontend/package-lock.json ./
RUN npm ci
COPY panda-auth-admin/frontend/ .
RUN npm run build

# ================= 后端构建 =================
# 基础镜像 digest 钉值，原 tag：mcr.microsoft.com/dotnet/sdk:10.0（2026-10-06 解析）
FROM mcr.microsoft.com/dotnet/sdk:10.0.403@sha256:de4fe90a98845d75910b9769662465c84de1a934665c431279d1382b2bddc02b AS build
WORKDIR /src
# restore 缓存层：先只进清单文件（本仓 slnx/global.json/props 落在 /src，与旧布局一致，
# 再补 publish 目标工程的 csproj 与引用图上的 share props + share/src csproj），
# NuGet 还原只随这些文件变化，日常源码改动直接命中缓存层，不再重跑 restore。
COPY panda-auth-admin/PandaAuth.Admin.slnx panda-auth-admin/global.json panda-auth-admin/Directory.Build.props panda-auth-admin/Directory.Packages.props ./
COPY panda-auth-admin/src/PandaAuth.Admin/PandaAuth.Admin.csproj panda-auth-admin/src/PandaAuth.Admin/
COPY panda-auth-share/Directory.Build.props panda-auth-share/
COPY panda-auth-share/src/PandaAuth.Shared/PandaAuth.Shared.csproj panda-auth-share/src/PandaAuth.Shared/
RUN dotnet restore panda-auth-admin/src/PandaAuth.Admin
# 全量源码层：bin/obj 已被 Dockerfile.dockerignore 挡在上下文外，restore 生成的
# obj/project.assets.json 不会被宿主产物覆盖，publish --no-restore 直接复用。
COPY panda-auth-admin/src/ panda-auth-admin/src/
COPY panda-auth-share/ panda-auth-share/
RUN dotnet publish panda-auth-admin/src/PandaAuth.Admin -c Release -o /app --no-restore --nologo

# ================= 运行阶段 =================
# .NET/ASP.NET 安全补丁 10.0.13；与 Server 共用不可变运行时基线（2026-10-22 核验）。
FROM mcr.microsoft.com/dotnet/aspnet:10.0.13@sha256:d5633778c754e89a386882eddf8dbee6942447a8a4b8267c19cf1e1158d0b0ac AS runtime
LABEL org.opencontainers.image.source="https://github.com/PandaLabs2026/panda-auth-admin"
LABEL cc.pandalabs.auth.schema-floor="online-signing-v1"
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 非 root 运行：aspnet 基础镜像自带 uid 1654 的 app 用户
COPY --chown=app:app --from=build /app .
COPY --chown=app:app --from=frontend /src/panda-auth-admin/src/PandaAuth.Admin/wwwroot/admin ./wwwroot/admin/

# DataProtection 密钥目录必须在镜像里预建并归 app 所有：命名卷首次创建时继承的是镜像内
# 该路径的属主，目录缺失或属 root 时 app 写不进密钥，启动即失败（compose 挂载了本路径）。
RUN mkdir -p /var/lib/panda-auth/admin-dataprotection \
    && chown app:app /var/lib/panda-auth/admin-dataprotection

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

ENTRYPOINT ["dotnet", "PandaAuth.Admin.dll"]
