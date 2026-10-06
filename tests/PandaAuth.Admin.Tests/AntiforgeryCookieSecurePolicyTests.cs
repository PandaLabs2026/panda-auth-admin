using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// 防伪 Cookie SecurePolicy 环境分层的真实应用行为测试。
/// </summary>
/// <remarks>
/// <para>
/// 存在的理由：Antiforgery 对 <c>CookieSecurePolicy.Always</c> 是服务端 fail-closed——
/// 非 SSL 请求直接抛 <c>InvalidOperationException</c>（<c>DefaultAntiforgery.CheckSSLConfig</c>），
/// <c>/admin/api/antiforgery</c> 与 <c>/admin/api/logout</c> 都会 500，后者还不被
/// <c>AntiforgeryValidationException</c> 的 catch 接住。本地开发是 launchSettings 直连
/// http://localhost:9006（无 TLS），无条件 Always 会打断登出链路；生产的恒 Secure 又不能松。
/// 两层约束各钉断言：Development 下防伪端点不 500、Production 下 SecurePolicy 必为 Always。
/// </para>
/// <para>
/// 走真实 <c>Program.cs</c>（WebApplicationFactory&lt;Program&gt;，TestServer 即 http），
/// 不是在本文件重抄注册：环境判别挪错位置、Always 被删、catch 被挪走都会在这里红灯。
/// </para>
/// </remarks>
public class AntiforgeryCookieSecurePolicyTests
{
    private static WebApplicationFactory<Program> Factory(string environment, bool authenticated = false)
        => new GuardFactory(environment, authenticated);

    /// <summary>与 RouteGuardTests 同款认证桩：logout 端点不匿名豁免，须带身份才走到防伪校验。</summary>
    private sealed class GuardFactory(string environment, bool authenticated) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(environment);
            // Program.cs 对机密客户端密钥失败关闭，Production 无 Development 覆盖文件，须显式注入。
            builder.UseSetting("Auth:ClientSecret", "unit-test-secret");
            builder.ConfigureServices(services =>
            {
                services.AddAuthentication()
                    .AddScheme<AuthenticationSchemeOptions, StubAuthenticatedHandler>("StubAuthenticated", _ => { });
                services.PostConfigure<AuthenticationOptions>(options =>
                {
                    if (authenticated)
                    {
                        options.DefaultAuthenticateScheme = "StubAuthenticated";
                    }
                });
            });
        }
    }

    [Fact]
    public async Task Development_HttpRequest_AntiforgeryEndpoint_Returns200WithCookie()
    {
        using var factory = Factory("Development");

        var response = await factory.CreateClient().GetAsync("/admin/api/antiforgery");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // 防伪令牌必须真的下发：只断 200 的话端点空转也能过，盖不住 CheckSSLConfig 的抛出路径。
        var hasAntiforgeryCookie = response.Headers.TryGetValues("Set-Cookie", out var cookies)
            && cookies.Any(c => c.Contains("Antiforgery", StringComparison.Ordinal));
        Assert.True(hasAntiforgeryCookie, "响应应携带防伪 Set-Cookie（否则 200 只是端点空转，未盖住 CheckSSLConfig 路径）。");
    }

    [Fact]
    public async Task Development_HttpRequest_LogoutWithoutToken_Returns400Not500()
    {
        // 登出端点的防伪失败必须落在 AntiforgeryValidationException → 400；若 SecurePolicy
        // 在 Development 也收紧为 Always，CheckSSLConfig 的 InvalidOperationException 会
        // 直接 500——这正是本测试要钉住的区别。
        using var factory = Factory("Development", authenticated: true);

        var response = await factory.CreateClient().PostAsync("/admin/api/logout", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public void Production_AntiforgeryCookieSecurePolicy_IsAlways()
    {
        using var factory = Factory("Production");

        var securePolicy = factory.Services
            .GetRequiredService<IOptions<AntiforgeryOptions>>()
            .Value.Cookie.SecurePolicy;

        // 生产经 Caddy TLS 反代（X-Forwarded-Proto 还原 https），Always 不打断请求；
        // 松回 SameAsRequest 会让防伪令牌在 http 降级路径下落明文 Cookie。
        Assert.Equal(CookieSecurePolicy.Always, securePolicy);
    }

    /// <summary>认证桩：携带 admin 身份（与 RouteGuardTests 的同款实现，sub/name/roles 与 OIDC 短名 ClaimType 对齐）。</summary>
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
