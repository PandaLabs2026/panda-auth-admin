using System.Net;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
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
    builder.Services
        .AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeyPath))
        .SetApplicationName("PandaAuth.WebAdmin");
}

builder.Services.AddAuthorization();
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
app.UseStaticFiles();

var antiforgery = app.Services.GetRequiredService<IAntiforgery>();

// BFF 占位 API（Phase 1 实装：会话查询、用户管理、客户端管理、审计查询）。
app.MapGet("/admin/api/antiforgery", (HttpContext context) =>
{
    var tokens = antiforgery.GetAndStoreTokens(context);
    return Results.Ok(new { token = tokens.RequestToken });
});

app.MapPost("/admin/api/auth/login", () =>
    Results.Problem(statusCode: StatusCodes.Status501NotImplemented,
        title: "Not implemented",
        detail: "管理后台登录将在 Phase 1 通过 PandaAuth Admin API 实现。"));

app.MapHealthChecks("/admin/healthz");

// SPA 回退：/admin 下非文件路径一律返回 index.html（前端路由接管）。
app.MapFallbackToFile("/admin/{*path:nonfile}", "admin/index.html");

app.Run();
