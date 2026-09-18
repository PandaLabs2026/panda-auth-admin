using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.WebAdmin.Tests;

/// <summary>
/// BFF 路由守卫集成测试（真实 Program.cs，经 WebApplicationFactory）。
/// </summary>
/// <remarks>
/// <para>
/// 钉住两组既有缺陷的回归：①FallbackPolicy 默认拒绝——未映射的 /admin/api/* 路径必须
/// 被授权拦下，而不是被 SPA 回退接走返回 200 + index.html（2026-09-16 在 /admin/api/session、
/// /admin/api/users 上实测发生过）；②已删除的 501 登录端点不得以任何形态复活。
/// </para>
/// <para>
/// 挑战方案替换为桩：OpenIddict 客户端的挑战需要连真实 IDP 做 discovery，测试环境没有。
/// 替换只改「挑战的表现形式」（302 → 确定性 401/403），不改变任何端点的授权判定本身。
/// </para>
/// </para>
/// </remarks>
public class RouteGuardTests
{
    private sealed class GuardFactory(bool authenticated) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // Development 环境提供 dev ClientSecret（appsettings.Development.json）；
            // Program.cs 对空密钥失败关闭，用 Production 配置起不来。
            builder.UseEnvironment("Development");
            builder.ConfigureServices(services =>
            {
                services.AddAuthentication()
                    .AddScheme<AuthenticationSchemeOptions, StubChallengeHandler>("StubChallenge", _ => { })
                    .AddScheme<AuthenticationSchemeOptions, StubAuthenticatedHandler>("StubAuthenticated", _ => { });
                // PostConfigure 在 Program.cs 的 AddAuthentication 之后执行，覆盖默认方案。
                services.PostConfigure<AuthenticationOptions>(options =>
                {
                    options.DefaultChallengeScheme = "StubChallenge";
                    if (authenticated)
                    {
                        // 认证桩：所有请求自动携带 admin 身份，验证「已认证」分支的 404/200 行为。
                        options.DefaultAuthenticateScheme = "StubAuthenticated";
                    }
                });
            });
        }
    }

    [Fact]
    public async Task Anonymous_SessionEndpoint_Returns401_NotLoginRedirect()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/session");

        // 刻意的 401（端点内手动返回）：走 FallbackPolicy 会得到 302 登录跳转，
        // 前端拿到登录页 HTML 无法判定「未登录」。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_UnknownApiPath_Returns401_NotSpaFallback()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/unknown");

        // 受保护前缀兜底 + 授权：匿名先被拦（401），绝不能落到 SPA 回退返回 200 + index.html。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_RemovedLoginApiEndpoint_Returns401_NotSpaFallback()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        // 旧 501 占位端点已删除：匿名访问落到受保护兜底（401），而不是 501 或登录页 HTML。
        using var response = await client.PostAsync("/admin/api/auth/login", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_LoginChallengeEndpoint_IsAnonymousAndChallenges()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/login");

        // 401 来自挑战桩（真实环境是 302 到 IDP 授权端点）：证明端点匿名可达且触发挑战，
        // 不是 403（被授权拒）或 404（路由缺失）。
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AntiforgeryEndpoint_ReturnsToken()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/antiforgery");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<AntiforgeryResponse>();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrEmpty(payload.Token));
    }

    [Fact]
    public async Task HealthCheckEndpoint_ReturnsHealthy()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SpaFallback_ServesIndexHtml_ForNonFileNonApiPaths()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/users");

        // SPA 外壳匿名可达（登录页由它承载）；放行的是外壳，不是数据。
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Authenticated_UnknownApiPath_Returns404()
    {
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/unknown");

        // 已认证 → 越过授权，路径确实不存在 → 404（区分「路径拼错」与「端点漏加授权」的前提）。
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Authenticated_SessionEndpoint_ReturnsIdentityWithRoles()
    {
        using var factory = new GuardFactory(authenticated: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/admin/api/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<SessionResponse>();
        Assert.NotNull(payload);
        Assert.Equal("stub-admin", payload.Subject);
        Assert.Contains("admin", payload.Roles);
    }

    [Fact]
    public async Task LoginChallenge_RateLimited_AfterTenPerMinute()
    {
        using var factory = new GuardFactory(authenticated: false);
        using var client = factory.CreateClient();

        // 前 10 次（PermitLimit=10）：挑战桩 → 401。
        for (var i = 0; i < 10; i++)
        {
            using var response = await client.GetAsync("/admin/login");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        // 第 11 次：429。分区键是 RemoteIpAddress（TestServer 下恒定），串行请求计数确定。
        using var limited = await client.GetAsync("/admin/login");
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);

        // 限流只挂在 /admin/login：其他匿名端点不受该分区影响。
        using var session = await client.GetAsync("/admin/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, session.StatusCode);
    }

    private sealed record AntiforgeryResponse(string Token);

    private sealed record SessionResponse(string Subject, string? Name, string? Email, string? Nickname, string[] Roles);

    /// <summary>挑战桩：把「需要登录」表现成确定性 401（真实环境是 302 到 IDP）。</summary>
    private sealed class StubChallengeHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public StubChallengeHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
            => Task.FromResult(AuthenticateResult.NoResult());

        protected override Task HandleChallengeAsync(AuthenticationProperties properties)
        {
            Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        }

        protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
        {
            Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }
    }

    /// <summary>认证桩：携带 admin 身份（sub/name/roles 与 OIDC 短名 ClaimType 对齐）。</summary>
    private sealed class StubAuthenticatedHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public StubAuthenticatedHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var identity = new ClaimsIdentity(
            [
                new Claim(Claims.Subject, "stub-admin"),
                new Claim(Claims.Name, "Stub Admin"),
                new Claim(Claims.Role, "admin"),
            ], Scheme.Name, Claims.Name, Claims.Role);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
