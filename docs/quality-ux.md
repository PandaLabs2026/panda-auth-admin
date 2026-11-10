# Admin 质量修复验收边界

- 一次性密码、client secret 只在组件内存展示，不写 React Query、草稿或浏览器存储。绑定对象与请求代次，同对象刷新保留；切换对象、关闭或卸载后，迟到响应不能恢复展示。创建用户的生成密码绑定返回的新用户 ID。
- Claim 草稿绑定用户 ID；step-up 返回只恢复匹配对象，消费后移除，不自动重放。建号草稿沿用去密码规则。
- 审计文本筛选等待 300ms 后更新 URL；历史回退取消待提交文本，日期、结果及分页仍立即生效。
- 通知只覆盖最近 50 条；未读数限于此窗口。加载、读取失败、空结果、已读写入失败各有反馈；读取可重试，写入失败不推进本地游标，不自动重试写入。时间按当前语言、本地时区显示。
- `/500` 刷新按钮原来将纯文本交给 Slot，已移除该处 `asChild`。Button 本身支持 `asChild`，合法链接用法保留；未修改 ui/patterns 正典拷贝。
- users/roles/audit 的分页与总数使用现有具名翻译占位符。
- 现有 step-up 的 returnUrl 保留 pathname 和 query，经 BFF challenge；本次不改变认证跳转协议。

验证为隔离工作树单元测试、构建和组织门禁；不等于真实浏览器或生产账号验收。未发布、迁移或重启生产。

## UX-03 源码消费（2026-11-10）

本批基线`b20745e6bdb1be73cc21d825da13a0d185ac2e00`，app-shell从Template v0.6.20更新到正式v0.6.22（`813e5dd3beee476a29faf1d98f5ed2136fd31a6f`），metadata/not-found同版本消费，逐文件摘要在对应manifest。先dry-run再write；既有404/UI依赖逐字节核对v0.6.20正典后登记，不绕过漂移保护。

应用接入原字典及已存在的`/me`、修改密码目的地；未提供组织/通知等能力不展示假入口。缺少昵称/姓名时不再把内部subject用作姓名，subject仍在授权/防自我误操作契约中保留。未知路由使用受原AdminAuthBoundary/SessionGate保护的embedded404，初始HTML和运行时消费同一产品名配置/格式函数，直接认证状态文档也使用登记固定title。

本地：frontend43文件270/270、lint0error/15warning、tsc/Vite build通过；AdminAuthPage直接测试1/1，BrowserHost构建0警告/错误，依赖Share固定`c082df8`。真实Admin BFF+生产SPA+签名环回OIDC fixture六组通过：无JS标题、授权码/PKCE登录、Cookie刷新、1440/390px404单main/重排/返回、英文账号菜单顺序/Escape焦点、原生CSRF退出/回调及随后session401。浏览器pageerror为空。首轮探针错误等待移动端已收起侧栏身份文案，改为路由/页面状态断言后仅补验浏览器；未重跑不受影响的已过检查。

本次使用现有BrowserHost与组织已有Node Playwright作本地驱动；任务脚本/结果位于`$TMPDIR/auth-admin-protocol.mjs`、`auth-admin-protocol-results.json`，没有新增应用依赖。签名测试提供方不是生产账户/Server完整授权验收，未部署或启用UX-04业务功能，G项继续按拥有方条件保留。代码回退正常revert本批提交，连同所有manifest恢复；生产恢复仍遵循部署正本。
