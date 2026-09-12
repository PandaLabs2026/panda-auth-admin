# PandaAuth.WebAdmin 镜像（管理后台 BFF + React SPA，生产绑定 127.0.0.1:9006）
# 自包含构建（本仓即上下文，前端在容器内 node:24 构建）：
#   docker build -t panda-auth-webadmin:latest panda-auth-webadmin/

# ================= 前端构建 =================
FROM node:24-bookworm-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
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
WORKDIR /app

COPY --from=build /app .
COPY --from=frontend /src/PandaAuth.WebAdmin/wwwroot/admin ./wwwroot/admin/

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://127.0.0.1:9006

EXPOSE 9006

ENTRYPOINT ["dotnet", "PandaAuth.WebAdmin.dll"]
