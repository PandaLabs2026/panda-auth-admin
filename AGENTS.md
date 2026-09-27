# panda-auth-admin 协作规则

## 职责与边界

本仓是 PandaAuth 管理后台，包含 .NET BFF 与 React 前端；生产路径 `/admin`，BFF 监听 `127.0.0.1:9006`。发布与 Compose 事实见 `../panda-auth/AGENTS.md`、`../panda-auth/WORKSPACE.md` 和 `../panda-auth/deploy/README.md`。

## 跨仓来源与安全

- 浏览器只调用本地 `/admin/api/` BFF，不直连 IDP 或数据库；业务授权由 Server 判定。跨仓契约以 `../panda-auth-share/` 和 Server 实现为准。
- Access/refresh token 不得进入 JavaScript、localStorage、sessionStorage、URL、日志或测试快照；不得弱化 Cookie、防伪令牌或 Data Protection 规则。
- 前端生成物进入 `src/PandaAuth.Admin/wwwroot/admin/`，禁止手工编辑或提交构建残留。品牌资产按元仓管线同步，禁止手工拷贝。
- 不提交密码、Token、私钥、真实连接串、env 内容或生产配置。

## 验证

从本仓根目录运行：

```bash
dotnet build PandaAuth.Admin.slnx
dotnet test tests/PandaAuth.Admin.Tests/PandaAuth.Admin.Tests.csproj
(cd frontend && npm ci && npm run build)
git diff --check
```

solution、测试项目及前端 `package.json` / `package-lock.json` 均存在。前端测试可用 `(cd frontend && npm test -- --run)`；当前最低构建验证不要求启动外部服务。不要将前端测试未运行报告为通过。
