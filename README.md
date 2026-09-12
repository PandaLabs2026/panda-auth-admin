# panda-auth-webadmin

PandaAuth 管理后台——`https://auth.pandalabs.cn/admin`，同仓 BFF + React SPA（对齐 panda-webadmin 模式）。

| 组成 | 技术栈 | 说明 |
|---|---|---|
| `src/PandaAuth.WebAdmin` | .NET 10 BFF | Cookie 会话 + 防伪令牌（`X-XSRF-Token`）+ SPA 静态托管 + `/admin/healthz` |
| `frontend/` | React 19 + Vite 7 + TS strict + Tailwind 4 + shadcn/ui | 管理端 SPA；构建产物输出到 BFF `wwwroot/admin`（对齐 panda-webapp 模式） |

## 页面现状（Phase 0 = 骨架）

- `/admin/login` 登录页（品牌绿面板 + shadcn 表单；`POST /admin/api/auth/login` 返回 501，Phase 1 接入 PandaAuth Admin API）
- 占位 API：`/admin/api/antiforgery`（防伪令牌）、`/admin/healthz`

## 快速开始

```bash
# 后端
dotnet run --project src/PandaAuth.WebAdmin        # http://localhost:9006

# 前端（独立 dev server，API 代理到 9006）
cd frontend && npm install && npm run dev          # http://localhost:5171
npm run build                                      # 产物落 BFF wwwroot/admin
```

## 说明

- Token 不进 JS/localStorage：沿用 panda-webapp BFF 安全约定（HttpOnly Cookie + 防伪头）
- 组件与 shadcn 官方 registry 同步：`frontend/components.json` 已配置（new-york），后续可用 `npx shadcn add <component>` 增补
- Phase 1 页面：用户管理、客户端管理、登录审计查询（数据全部经 Server 的 Admin API，不直连数据库）
