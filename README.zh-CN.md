# panda-auth-admin

**PandaAuth by PandaLabs** · [English](README.md)

**官方主页 [pandalabs.cc](https://pandalabs.cc/products/panda-auth/)** · 中文官网 [pandalabs.cn](https://pandalabs.cn/products/panda-auth/) · [PandaLabs 产品矩阵](https://pandalabs.cc/products/)

> PandaAuth 套件当前为 **Community Preview 0.2.0-preview.1**：已部署生产、面向早期社区试用；稳定版 Community Release 1.0.0 尚未发布。接入采用邀请或申请口径。

## 职责与边界

PandaAuth 管理后台，由 .NET 10 BFF 与 React 19 前端组成。生产路径为 `/admin`，后端监听 127.0.0.1:9006；管理数据计划通过 Server Admin API 访问，不直连数据库。

前端基于 [panda-webapp-template](https://github.com/PandaLabs2026/panda-webapp-template) **v0.5.2**（2026-10-16 对齐批次）：模板正典件（`ui/`、`patterns/`、`lib/i18n|notify`、`hooks/`、`typeset.css`）零改动拷贝，应用身份留在令牌层（PandaAuth 钢蓝主题）与 BFF 契约层（`lib/api.ts` 防伪两跳 + MFA step-up + 401 全页跳转）；会话层经 `lib/auth.ts` 适配 BFF，组件层保持模板形态（AppLayout/NavUser/CommandPalette/RequireAuth/ConfirmAction/FilterToolbar/notify）。语义徽章（success/warning）为应用层组件（正典 Badge 不含该变体）。服务端错误码 en 词典在 `src/i18n/en-server.json`，UI 文案 en 词典在 `src/i18n/en.json`（自然键，zh 键即文案）。

## 当前实现与限制

[后端入口](src/PandaAuth.Admin/Program.cs)以第一方 OIDC 客户端运行：`GET /admin/challenge` 是认证挑战端点（授权码 + PKCE），配合 Cookie 会话与防伪令牌；[登录页](frontend/src/pages/login.tsx)位于 `/admin/login`，携带 `returnUrl` 到达时自动导航到挑战端点，本站不做凭据输入。

健康路径 `/admin/healthz` 与防伪入口 `/admin/api/antiforgery` 存在。用户、客户端、角色与审计管理页面已实现；Cookie/防伪配置存在不等于安全验收通过。

模板 NotificationBell（通知中心）未接线：BFF 暂无通知端点，待后端能力立项。

## 前置条件与构建运行

需要 .NET SDK，版本选择见本仓 [global.json](global.json)（当前请求 10.0.112，允许 latestFeature roll-forward）。本仓没有跨仓源码依赖，可脱离私有元仓独立构建。以下命令在本仓根目录执行。

前端使用 Node 24 与 npm（与 Docker 构建环境一致）。本仓无跨仓 ProjectReference。前端构建输出到 BFF 的 `wwwroot/admin`。

```bash
dotnet build PandaAuth.Admin.slnx
cd frontend
npm ci
npm run build
cd ..
dotnet run --project src/PandaAuth.Admin
```

构建后访问 http://localhost:9006/admin/ 进入管理台 SPA，`/admin/challenge` 发起 OIDC 登录挑战。前端热更新可在另一终端从本仓根目录执行：

```bash
cd frontend
npm run dev
```

前端开发端口 5171，API 代理到 9006；完整后端登录未实现，不能用页面打开代替接入验收。

## Roadmap 与治理

产品级路线图、发行门禁和社区/商业边界在正式公开发行前仍由维护者治理；本 README 只描述可独立复现的 admin 构建边界。

- [安全政策](SECURITY.md)：选定私密报告渠道，启用状态未核验；不公开提交漏洞细节。
- [贡献指南](CONTRIBUTING.md)：本仓检查与统一贡献规则。
- [MIT License](LICENSE)：适用于自有代码和文档，具体范围见[许可说明](LICENSING.md)；第三方许可仍适用，品牌图片除外。
