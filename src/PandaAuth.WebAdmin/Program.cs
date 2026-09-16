using System.Net;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using PandaAuth.WebAdmin;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAntiforgery(options => options.HeaderName = "X-XSRF-Token");
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "PandaAuth.WebAdmin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.LoginPath = "/admin/login";
    });

// 会话 Cookie 与防伪令牌由 DataProtection 保护。Auth:DataProtectionKeyPath 非空时持久化密钥环
// （生产由 compose 注入卷路径），容器重建后既有登录态不失效；默认空串 = 临时密钥，仅限开发环境。
// 应用名固定为 PandaAuth.WebAdmin：不同服务不共用密钥环，各服务的卷本就独立。
var dataProtectionKeyPath = builder.Configuration["Auth:DataProtectionKeyPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionKeyPath))
{
    // 路径必须已存在：生产由 compose 命名卷挂载保证；不存在即说明「配置路径与卷挂载点不一致」，
    // 此时绝不能静默创建到容器临时层（密钥随容器重建即丢），必须失败关闭。
    // PersistKeysToFileSystem 自身会静默创建缺失目录且不告警，故守卫必须显式。
    if (!Directory.Exists(dataProtectionKeyPath))
    {
        throw new InvalidOperationException(
            $"DataProtection 密钥目录不存在：{dataProtectionKeyPath}（生产应由 compose 命名卷挂载到该路径）");
    }

    builder.Services
        .AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeyPath))
        .SetApplicationName("PandaAuth.WebAdmin");
}

// 默认拒绝：未显式声明授权的端点一律要求已认证用户。
// Phase 0 的四个端点全部匿名，而 AddAuthorization() 不带 FallbackPolicy 时的默认是「放行」——
// Phase 1 每新增一个 API 都要记得补 RequireAuthorization，漏一处的后果是**管理数据默认公开**：
// 漏掉的默认值是失败开放，且不会有人发现。FallbackPolicy 把默认值翻转成失败关闭。
// 代价是匿名端点必须显式列出（下面三处 + SPA 静态文件与回退），漏列的后果是「自己打不开」，
// 开发期立刻暴露——两类错误的可见性天差地别，这是选它的理由。
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});
builder.Services.AddHealthChecks();

var app = builder.Build();

// Caddy 以 HTTP 反代到 127.0.0.1:9006 并终结 TLS，需还原真实 Scheme 与客户端 IP。
// 仅信任回环代理（Caddy 与容器同 host network，真实代理永远是回环地址）：伪造发生在 XFF 头链而非连接层，
// 端口绑定 127.0.0.1 不能消除伪造风险，全量网段信任属失败开放配置。
// ForwardLimit=1：只消费 Caddy 追加的最右一跳真实客户端 IP，攻击者伪造的最左值无法污染 IP 限流与审计。
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1,
    KnownProxies = { IPAddress.Loopback, IPAddress.IPv6Loopback },
});

app.UseMiddleware<SecurityHeadersMiddleware>();

// SPA 静态资源（frontend/ 构建产物落在 wwwroot/admin）。
// 必须排在认证/授权之前：静态文件中间件命中文件即短路，其后的授权中间件根本不会执行，
// 于是 js/css/图标天然豁免 FallbackPolicy。反过来若授权先跑，请求没有匹配到端点，
// FallbackPolicy 会把它们一并拦下——登录页的 HTML 能拿到、脚本却 401，
// 表现是「登录页白屏」，且因为 HTML 本身是 200，排查时极易误判成前端故障。
// 因此这两个中间件的位置在这里显式写死，而不是交给框架的自动插入顺序。
// 该顺序是实测确认的：加上 FallbackPolicy 后 /admin/assets/*.js 与登录页图标仍为 200（静态文件先短路），
// 而带授权要求的端点未登录为 302。
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

var antiforgery = app.Services.GetRequiredService<IAntiforgery>();

// BFF 占位 API（Phase 1 实装：会话查询、用户管理、客户端管理、审计查询）。
// 以下三处是 FallbackPolicy 下的匿名豁免清单，每一条都必须有「为什么可以匿名」的理由。
app.MapGet("/admin/api/antiforgery", (HttpContext context) =>
{
    // 匿名是必需而非让步：这个端点的作用就是在登录**之前**把防伪令牌发给登录页，
    // 要求认证会形成鸡生蛋（要令牌先登录、要登录先有令牌）。
    var tokens = antiforgery.GetAndStoreTokens(context);
    return Results.Ok(new { token = tokens.RequestToken });
}).AllowAnonymous();

app.MapPost("/admin/api/auth/login", () =>
    // 登录入口本身不能要求已认证。
    Results.Problem(statusCode: StatusCodes.Status501NotImplemented,
        title: "Not implemented",
        detail: "管理后台登录将在 Phase 1 通过 PandaAuth Admin API 实现。")).AllowAnonymous();

// 探活匿名：容器 healthcheck 由 docker 发起，不带任何凭据；它只回 healthy/unhealthy，不泄露管理数据。
app.MapHealthChecks("/admin/healthz").AllowAnonymous();

// /admin/api 命名空间不参与 SPA 回退——**这是默认拒绝能否成立的关键一条**。
// 少写它，未映射的 API 路径就会被下面的 SPA 回退接走并返回 200 + index.html：
// 于是探不到 401，也分不清「路径拼错」与「端点漏加授权」，FallbackPolicy 在 API 面上形同虚设
// （实测未加本行时 /admin/api/session、/admin/api/users 均返回 200）。
// 显式 RequireAuthorization：即使将来有人去掉 FallbackPolicy，API 命名空间的默认归属也不变。
// 认证过的调用方拿到 404（路径确实不存在），匿名调用方先在授权阶段被拦下。
app.MapFallback("/admin/api/{**path}", () => Results.NotFound()).RequireAuthorization();

// SPA 回退：/admin 下非文件路径一律返回 index.html（前端路由接管）。
// 匿名是必需的：登录页 /admin/login 就是由这里返回的，它若是 401，登录入口直接不存在。
// 注意放行的是**外壳**，不是数据——页面能加载不代表能拿到管理 API 的任何响应。
// 路由优先级：/admin/api/* 由上面那条更具体的回退接管（字面量段 api 胜过 catch-all），
// 与本行的注册先后无关。
app.MapFallbackToFile("/admin/{*path:nonfile}", "admin/index.html").AllowAnonymous();

app.Run();
