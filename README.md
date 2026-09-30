# panda-auth-admin

**PandaAuth by PandaLabs** · [English](README.en.md)

> PandaAuth 套件当前为 **Community Preview 0.2.0-preview.1**：已部署生产、面向早期社区试用；稳定版 Community Release 1.0.0 尚未发布。接入采用邀请或申请口径。

## 职责与边界

PandaAuth 管理后台，由 .NET 10 BFF 与 React 19 前端组成。生产路径为 `/admin`，后端监听 127.0.0.1:9006；管理数据计划通过 Server Admin API 访问，不直连数据库。

## 当前实现与限制

[后端入口](src/PandaAuth.Admin/Program.cs)以第一方 OIDC 客户端运行：`GET /admin/login` 是认证挑战端点（授权码 + PKCE），配合 Cookie 会话与防伪令牌；[登录页](frontend/src/pages/login.tsx)全页导航到挑战端点，本站不做凭据输入。

健康路径 `/admin/healthz` 与防伪入口 `/admin/api/antiforgery` 存在。用户、客户端、角色与审计管理页面已实现；Cookie/防伪配置存在不等于安全验收通过。

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

构建后访问 http://localhost:9006/admin/login，仅显示登录骨架。前端热更新可在另一终端从本仓根目录执行：

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
