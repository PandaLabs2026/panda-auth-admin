using System.Net;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
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
builder.Services.AddAuthorization();
builder.Services.AddHealthChecks();

var app = builder.Build();

// Caddy 以 HTTP 反代到 127.0.0.1:9006 并终结 TLS，需还原真实 Scheme 与客户端 IP。
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    KnownIPNetworks =
    {
        new System.Net.IPNetwork(IPAddress.Any, 0),
        new System.Net.IPNetwork(IPAddress.IPv6Any, 0),
    },
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
