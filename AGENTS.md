# panda-auth-admin 协作规则

PandaAuth 管理后台，生产路径 `/admin`，BFF 监听 127.0.0.1:9006。跨仓发布和 Compose 规则以 `../panda-auth/AGENTS.md`、`WORKSPACE.md` 和 `deploy/README.md` 为准。

- 浏览器只调用本地 `/admin/api/` BFF，不直连 IDP 或数据库；业务授权由 Server 判定。
- Access/refresh token 不进入 JavaScript、localStorage、sessionStorage、URL、日志或测试快照；Cookie、防伪令牌和 Data Protection 规则不得弱化。
- 前端生成物进入 `src/PandaAuth.Admin/wwwroot/admin/`，禁止手工编辑或提交构建残留。
- 验证：`dotnet build PandaAuth.Admin.slnx`、`dotnet test tests/PandaAuth.Admin.Tests/PandaAuth.Admin.Tests.csproj`、`(cd frontend && npm ci && npm run build)` 和 `git diff --check`。
