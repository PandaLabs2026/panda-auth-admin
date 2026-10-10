using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using OpenIddict.Abstractions;
using OpenIddict.Client;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// 登录回调失败可见化与 OpenIddict 客户端密钥持久化的集成测试（真实 Program.cs）。
/// </summary>
/// <remarks>
/// <para>
/// IDP 以**静态服务端配置**替身（<c>OpenIddictClientRegistration.Configuration</c>）：
/// 挑战与回调全程离线（不发 discovery），令牌端点指向必拒的回环端口——state 校验通过后
/// 必然卡在令牌交换。于是「state 校验失败」与「state 校验通过、令牌交换失败」可以从
/// 重定向带回的 error 码区分：密钥持久化生效时旧 state 跨重启仍走到交换这一步，
/// 密钥轮换（全新目录）时同一 state 在校验即被拒。单测环境没有活体 IDP，
/// 「完成回调」的可观测面即此。
/// </para>
/// <para>
/// 回调的关联 Cookie（请求伪造防护，名字内嵌 state 派生的 nonce）随挑战下发，
/// 测试原样带到重启后的实例——真实浏览器行为等价（Cookie 存活于进程之外）。
/// </para>
/// </remarks>
public class CallbackErrorAndClientKeysTests
{
    /// <summary>端口 9（discard）本地无监听：连接即刻被拒，令牌交换必失败且不等待。</summary>
    private const string FakeIssuer = "http://127.0.0.1:9/";

    private sealed class CallbackFactory(string? keyDirectory) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "unit-test-secret");
            builder.UseSetting("Auth:Issuer", FakeIssuer);
            if (keyDirectory is not null)
            {
                builder.UseSetting("Auth:DataProtectionKeyPath", keyDirectory);
            }

            builder.ConfigureServices(services =>
            {
                services.PostConfigure<OpenIddictClientOptions>(options =>
                {
                    // 静态服务端配置必须连同 ConfigurationManager 一起替换：OpenIddict 在注册
                    // 构建期就把 Configuration 折算成检索管理器，事后只设 Configuration 不生效。
                    var configuration = new OpenIddictConfiguration
                    {
                        Issuer = new Uri(FakeIssuer),
                        AuthorizationEndpoint = new Uri(FakeIssuer + "connect/authorize"),
                        TokenEndpoint = new Uri(FakeIssuer + "connect/token"),
                    };
                    // 挑战前的能力协商完全依赖配置宣告（授权码 + PKCE + 机密客户端认证）。
                    configuration.GrantTypesSupported.Add(GrantTypes.AuthorizationCode);
                    configuration.GrantTypesSupported.Add(GrantTypes.RefreshToken);
                    configuration.ResponseTypesSupported.Add(ResponseTypes.Code);
                    configuration.ResponseModesSupported.Add(ResponseModes.Query);
                    configuration.CodeChallengeMethodsSupported.Add(CodeChallengeMethods.Sha256);
                    configuration.TokenEndpointAuthMethodsSupported.Add(ClientAuthenticationMethods.ClientSecretPost);
                    configuration.ScopesSupported.Add(Scopes.OpenId);
                    configuration.ScopesSupported.Add(Scopes.Profile);
                    configuration.ScopesSupported.Add(Scopes.Email);
                    configuration.ScopesSupported.Add(Scopes.Roles);
                    configuration.ScopesSupported.Add(Scopes.OfflineAccess);
                    var registration = options.Registrations.Single(r => r.ProviderName == "pandaauth");
                    registration.Configuration = configuration;
                    registration.ConfigurationManager = new StaticConfigurationManager<OpenIddictConfiguration>(configuration);
                });
            });
        }
    }

    private static WebApplicationFactoryClientOptions NoRedirect() => new()
    {
        AllowAutoRedirect = false,
        HandleCookies = false,
    };

    /// <summary>
    /// TestServer 直连是 http，而生产经 Caddy TLS 反代、由 X-Forwarded-Proto 还原 https：
    /// OpenIddict 客户端对挑战/回调强制传输安全且回调端点按 scheme 匹配 RedirectUri，
    /// 不带该头即 500（endpoint 判为 Unknown）。显式还原生链路形态。
    /// </summary>
    private static HttpClient CreateClientBehindTlsProxy(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient(NoRedirect());
        client.DefaultRequestHeaders.Add("X-Forwarded-Proto", "https");
        return client;
    }

    /// <summary>从（可能是相对的）Location 取 error 查询参数。</summary>
    private static string? ErrorOfLocation(string? location)
    {
        if (location is null)
        {
            return null;
        }

        // Location 是相对路径（/admin/challenge?error=…）：挂到哑主机上只为解析查询串。
        return QueryHelpers.ParseQuery(new Uri("http://localhost" + location).Query)["error"].ToString();
    }

    private static (string? State, string? CorrelationCookie) ParseChallenge(HttpResponseMessage challenge)
    {
        var query = QueryHelpers.ParseQuery(challenge.Headers.Location!.Query);
        var state = query["state"].ToString();

        // Set-Cookie → "name=value"（丢弃 Path/Expires 等属性），回调时原样回带。
        var cookie = challenge.Headers.GetValues("Set-Cookie")
            .FirstOrDefault(c => c.Contains("OpenIddict", StringComparison.OrdinalIgnoreCase));
        var pair = cookie?.Split(';')[0];
        return (state, pair);
    }

    private static async Task<(HttpStatusCode Status, string? Error, string? Location)> GetCallbackAsync(
        WebApplicationFactory<Program> factory,
        string state,
        string? correlationCookie)
    {
        using var client = CreateClientBehindTlsProxy(factory);
        using var request = new HttpRequestMessage(HttpMethod.Get,
            "/admin/callback/login/pandaauth?code=stub-code&state=" + Uri.EscapeDataString(state));
        if (correlationCookie is not null)
        {
            request.Headers.TryAddWithoutValidation("Cookie", correlationCookie);
        }

        using var response = await client.SendAsync(request);
        var location = response.Headers.Location?.ToString();
        return (response.StatusCode, ErrorOfLocation(location), location);
    }

    private static string TempKeyDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "panda-auth-admin-clientkeys-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public async Task LoginEndpoint_WithErrorParam_RendersReadableErrorPage()
    {
        using var factory = new CallbackFactory(keyDirectory: null);
        using var client = factory.CreateClient();

        using var denied = await client.GetAsync("/admin/challenge?error=access_denied");
        Assert.Equal(HttpStatusCode.OK, denied.StatusCode);
        Assert.Equal("text/html", denied.Content.Headers.ContentType?.MediaType);
        var body = await denied.Content.ReadAsStringAsync();
        // 人话文案 + 重试入口都在页面上（此前系统性失败全程无提示）。
        Assert.Contains("授权被拒绝", body);
        Assert.Contains("重试登录", body);

        // 白名单外的任何串（含注入尝试）折算固定文案，原文绝不进页面/查询串。
        using var injected = await client.GetAsync(
            "/admin/challenge?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
        Assert.Equal(HttpStatusCode.OK, injected.StatusCode);
        var fallback = await injected.Content.ReadAsStringAsync();
        Assert.DoesNotContain("<script", fallback, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(LoginError.Describe(LoginError.Unknown), fallback);
    }

    [Fact]
    public async Task CallbackFailure_RedirectsToLoginWithWhitelistedError()
    {
        using var factory = new CallbackFactory(keyDirectory: null);
        using var client = CreateClientBehindTlsProxy(factory);

        // 无有效 state 的回调（本地校验失败）：带回白名单错误码，而非裸 302 无声打转。
        using var response = await client.GetAsync(
            "/admin/callback/login/pandaauth?code=stub-code&state=not-a-real-state");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);

        var location = response.Headers.Location?.ToString() ?? string.Empty;
        Assert.StartsWith("/admin/challenge?error=", location, StringComparison.Ordinal);
        // OpenIddict 对无法校验的 state 以 invalid_token 拒绝（白名单成员，页面上是固定人话文案）。
        Assert.Equal("invalid_token", ErrorOfLocation(location));
    }

    [Fact]
    public async Task ClientKeys_PersistedAcrossRestart_OldStateStillCompletesCallback()
    {
        var keyDirectory = TempKeyDirectory();
        var rotatedKeyDirectory = TempKeyDirectory();
        try
        {
            // 第一进程：挑战签发 state（由持久化客户端密钥保护），密钥文件随启动落盘。
            string state;
            string? correlationCookie;
            using (var first = new CallbackFactory(keyDirectory))
            using (var client = CreateClientBehindTlsProxy(first))
            {
                using var challenge = await client.GetAsync("/admin/challenge?returnUrl=/admin/");
                Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
                Assert.StartsWith(FakeIssuer + "connect/authorize", challenge.Headers.Location!.ToString(), StringComparison.Ordinal);
                var (challengeState, challengeCookie) = ParseChallenge(challenge);
                state = challengeState ?? throw new InvalidOperationException("挑战响应缺少 state。");
                correlationCookie = challengeCookie;
            }

            Assert.True(File.Exists(Path.Combine(keyDirectory, "client-keys.json")),
                "Auth:DataProtectionKeyPath 已配置时客户端密钥应落盘。");

            // 第二进程（重启，同密钥目录、同 DP 密钥环）：旧 state 应通过校验并推进到
            // 令牌交换——离线端点必拒，错误码落在交换失败族，而非 state 校验失败族。
            HttpStatusCode statusAfterRestart;
            string? errorAfterRestart;
            using (var second = new CallbackFactory(keyDirectory))
            {
                (statusAfterRestart, errorAfterRestart, _) = await GetCallbackAsync(second, state, correlationCookie);
            }

            Assert.Equal(HttpStatusCode.Redirect, statusAfterRestart);
            Assert.Equal("server_error", errorAfterRestart);

            // 对照组：密钥轮换（全新目录 = ephemeral 重启的等价物）——同一 state 在校验即被拒。
            HttpStatusCode statusRotated;
            string? errorRotated;
            using (var rotated = new CallbackFactory(rotatedKeyDirectory))
            {
                (statusRotated, errorRotated, _) = await GetCallbackAsync(rotated, state, correlationCookie);
            }

            Assert.Equal(HttpStatusCode.Redirect, statusRotated);
            // 轮换后旧 state 无法解密/验签：落在 state 校验失败族（invalid_token）。
            Assert.Equal("invalid_token", errorRotated);

            // 两族错误码必须可区分——这正是「重启丢在途登录」能否被测出的观测面。
            Assert.NotEqual(errorAfterRestart, errorRotated);
        }
        finally
        {
            Directory.Delete(keyDirectory, recursive: true);
            Directory.Delete(rotatedKeyDirectory, recursive: true);
        }
    }
}
