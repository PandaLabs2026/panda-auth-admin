using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// 实证测试：登出侧「从会话 Cookie 取回令牌」的取法是否真的成立
///（随四件套自 panda-auth-me 移植；Cookie 名与时效对齐本仓 Program.cs）。
/// </summary>
/// <remarks>
/// <para>
/// <c>AuthenticateAsync(会话方案) → AuthenticateResult.Properties.GetTokenValue(...)</c>
/// 是设计阶段的假设。这里不靠文档推断，而是起一个真实 Kestrel：
/// 用与 <c>Program.cs</c> 相同的 Cookie 配置签入带令牌的票据 → 让 HttpClient 像浏览器那样带回 Cookie
/// → 在服务端用登出侧的**同一行代码**（<see cref="SessionTokens.Read"/>）取令牌。
/// 取法若不成立（Properties 不随票据往返、键名不一致等），本测试会失败。
/// </para>
/// <para>
/// 覆盖三种会话状态：有令牌 / 有会话但无令牌 / 未登录（含被篡改的 Cookie），
/// 后两种都必须得到 <c>(null, null)</c> 且不抛——这正是「没有令牌就不发撤销请求」的前提。
/// </para>
/// </remarks>
public class SessionCookieTokenTests
{
    private const string AccessToken = "access-token-from-cookie";
    private const string RefreshToken = "refresh-token-from-cookie";
    private const string CookieName = "PandaAuth.Admin";
    private const string NoToken = "<none>";

    [Fact]
    public async Task SessionCookie_RoundTrip_ExposesStoredTokens()
    {
        await using var host = await TestHost.StartAsync();

        // ① 回调侧写入：与 Program.cs 的回调同样用 SessionTokens 的名称 StoreTokens。
        using var browser = host.CreateBrowser();
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("signin")).StatusCode);

        // 令牌确实随 Cookie 走了一个往返（HttpClient 的 CookieContainer 即浏览器行为）。
        var cookie = host.Cookies.GetCookies(host.BaseAddress)[CookieName];
        Assert.NotNull(cookie);
        Assert.True(cookie.HttpOnly);

        Assert.Equal($"{AccessToken}|{RefreshToken}", await browser.GetStringAsync("read"));
    }

    [Fact]
    public async Task SessionCookie_WithoutTokens_YieldsNullsAndDoesNotThrow()
    {
        await using var host = await TestHost.StartAsync();

        using var browser = host.CreateBrowser();
        await browser.GetAsync("signin-without-tokens");

        Assert.Equal($"{NoToken}|{NoToken}", await browser.GetStringAsync("read"));
    }

    [Fact]
    public async Task NoSession_OrTamperedCookie_YieldsNullsAndDoesNotThrow()
    {
        await using var host = await TestHost.StartAsync();

        // 未登录：没有 Cookie。
        using var anonymous = host.CreateBrowser();
        Assert.Equal($"{NoToken}|{NoToken}", await anonymous.GetStringAsync("read"));

        // 被篡改的 Cookie：解保护失败走认证失败分支，同样不得抛。
        using var tampered = host.CreateBrowser();
        tampered.DefaultRequestHeaders.Add("Cookie", $"{CookieName}=not-a-valid-ticket");
        Assert.Equal($"{NoToken}|{NoToken}", await tampered.GetStringAsync("read"));
    }

    /// <summary>
    /// 登出路径是「先 AuthenticateAsync 取令牌、再清 Cookie」的顺序，
    /// 而滑动续期同样在认证时判定并会写入新 Cookie。本测试钉住两者叠加时的结果：
    /// 会话 Cookie 最终必须是**被删除**，管理员真的登出。
    /// （行为结论已在 me 仓同款测试实测，此处同构验证本仓 Cookie 名与配置。）
    /// </summary>
    [Fact]
    public async Task Logout_DeletesSessionCookie_EvenWhenSlidingRenewalIsDue()
    {
        await using var host = await TestHost.StartAsync(expireTimeSpan: TimeSpan.FromSeconds(10));

        using var browser = host.CreateBrowser();
        // stale=1：票据签发时间回拨 6 秒，使登出请求本身落在滑动续期窗口内。
        await browser.GetAsync("signin?stale=1");

        using var response = await browser.PostAsync("logout", new StringContent(string.Empty));
        // 登出端点回显它取到的令牌：能取到，说明那一刻会话仍是活的（本测试的前提成立，不是空跑）。
        Assert.Equal($"{AccessToken}|{RefreshToken}", await response.Content.ReadAsStringAsync());

        var setCookies = response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.Where(value => value.StartsWith($"{CookieName}=", StringComparison.Ordinal)).ToList()
            : [];
        Assert.NotEmpty(setCookies);
        // 针对本 Cookie 的最后一条 Set-Cookie 必须是删除（取值为空），否则登出等于没登出。
        var lastValue = setCookies[^1].Split(';')[0][(CookieName.Length + 1)..];
        Assert.Equal(string.Empty, lastValue);

        // 行为侧的同一条结论：此后的请求必须回到未登录。
        Assert.Equal($"{NoToken}|{NoToken}", await browser.GetStringAsync("read"));
    }

    /// <summary>最小真实宿主：只装 Cookie 认证，读写两侧与 Program.cs 用同一组 API 与常量。</summary>
    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private TestHost(WebApplication app, CookieContainer cookies, Uri baseAddress)
        {
            _app = app;
            Cookies = cookies;
            BaseAddress = baseAddress;
        }

        public CookieContainer Cookies { get; }

        public Uri BaseAddress { get; }

        public static async Task<TestHost> StartAsync(TimeSpan? expireTimeSpan = null)
        {
            var builder = WebApplication.CreateBuilder();
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Services
                .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
                .AddCookie(options =>
                {
                    options.Cookie.Name = CookieName;
                    options.Cookie.HttpOnly = true;
                    options.Cookie.SameSite = SameSiteMode.Lax;
                    // 与 Program.cs 逐项对齐，唯一例外是 SecurePolicy：测试走回环 HTTP，Secure Cookie 不会被带回。
                    // 该差异与票据内容无关——令牌存在票据的 Properties 里，与 Cookie 传输属性无关。
                    options.Cookie.SecurePolicy = CookieSecurePolicy.None;
                    // 默认与 Program.cs 一致（闲置 2 小时、滑动续期）；传参可把窗口压到秒级，
                    // 用于逼出「滑动续期与清 Cookie 落在同一响应」这一交互。
                    options.ExpireTimeSpan = expireTimeSpan ?? TimeSpan.FromHours(2);
                    options.SlidingExpiration = true;
                });

            var app = builder.Build();

            app.MapGet("signin", async (HttpContext context) =>
            {
                var properties = new AuthenticationProperties();
                properties.StoreTokens(
                [
                    new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = AccessToken },
                    new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = RefreshToken },
                ]);
                if (context.Request.Query.ContainsKey("stale"))
                {
                    // 把签发时间推早，制造「已过半、该续期」的票据。
                    properties.IssuedUtc = DateTimeOffset.UtcNow.AddSeconds(-6);
                }
                await context.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "user-1")], CookieAuthenticationDefaults.AuthenticationScheme)),
                    properties);
                return Results.Ok();
            });

            app.MapGet("signin-without-tokens", async (HttpContext context) =>
            {
                await context.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "user-2")], CookieAuthenticationDefaults.AuthenticationScheme)));
                return Results.Ok();
            });

            // 登出端点的等价物：先取令牌（触发认证），再清会话 Cookie；回显取到的令牌以便测试判定会话是活的。
            app.MapPost("logout", async (HttpContext context) =>
            {
                var (accessToken, refreshToken) = SessionTokens.Read(
                    await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme));
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Results.Text($"{accessToken ?? NoToken}|{refreshToken ?? NoToken}");
            });

            // 读取侧就是登出端点里的那一行：SessionTokens.Read(AuthenticateAsync(会话方案))。
            app.MapGet("read", async (HttpContext context) =>
            {
                var (accessToken, refreshToken) = SessionTokens.Read(
                    await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme));
                return Results.Text($"{accessToken ?? NoToken}|{refreshToken ?? NoToken}");
            });

            await app.StartAsync();
            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            return new TestHost(app, new CookieContainer(), new Uri(address));
        }

        public HttpClient CreateBrowser()
        {
            var handler = new HttpClientHandler
            {
                CookieContainer = Cookies,
                UseCookies = true,
                AllowAutoRedirect = false,
            };
            return new HttpClient(handler) { BaseAddress = BaseAddress };
        }

        public async ValueTask DisposeAsync() => await _app.DisposeAsync();
    }
}
