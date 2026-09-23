using System.Net;
using System.Text;
using Microsoft.Extensions.Logging;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// 登出撤销客户端测试：用桩 <see cref="HttpMessageHandler"/> 断言真实发出的请求
///（随四件套自 panda-auth-me 移植，client id 换为 admin-web）。
/// </summary>
public class TokenRevocationClientTests
{
    private const string Issuer = "http://localhost:9004/";
    private const string ClientId = "admin-web";
    private const string ClientSecret = "unit-test-secret";
    private const string AccessToken = "access-token-value";
    private const string RefreshToken = "refresh-token-value";

    private static TokenRevocationClient CreateClient(
        StubHttpMessageHandler handler,
        RecordingLogger<TokenRevocationClient>? logger = null,
        string issuer = Issuer)
        => new(
            new HttpClient(handler),
            new TokenRevocationOptions(new Uri(issuer), ClientId, ClientSecret),
            logger ?? new RecordingLogger<TokenRevocationClient>());

    [Fact]
    public async Task Revoke_SendsContractEndpointWithTokensAndBasicAuth()
    {
        var handler = new StubHttpMessageHandler();

        await CreateClient(handler).RevokeAsync(AccessToken, RefreshToken);

        Assert.Equal(2, handler.Requests.Count);
        // 先撤 refresh_token（14 天，登出后仍能换新的唯一凭据），再撤 access_token。
        AssertRevocationRequest(handler.Requests[0], "refresh_token", RefreshToken);
        AssertRevocationRequest(handler.Requests[1], "access_token", AccessToken);
    }

    [Theory]
    // 末尾斜杠有无都必须拼出同一个地址（issuer 从配置来，写法不该决定成败）。
    [InlineData("http://localhost:9004/", "http://localhost:9004/connect/revoke")]
    [InlineData("http://localhost:9004", "http://localhost:9004/connect/revoke")]
    // issuer 带路径前缀时前缀必须保留：以 / 开头的契约常量若做 Uri 相对解析，会把前缀整段吃掉。
    [InlineData("https://idp.example/idp/", "https://idp.example/idp/connect/revoke")]
    public async Task Revoke_EndpointUri_FollowsIssuer(string issuer, string expectedUri)
    {
        var handler = new StubHttpMessageHandler();

        await CreateClient(handler, issuer: issuer).RevokeAsync(accessToken: null, refreshToken: RefreshToken);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(expectedUri, request.Uri.ToString());
        // 端点路径取自契约常量（share 仓 PandaAuthEndpoints.Revocation），代码侧不写字面量。
        Assert.EndsWith(PandaAuthEndpoints.Revocation, request.Uri.AbsolutePath);
    }

    [Fact]
    public async Task Revoke_SuccessStatusCode_LogsNothing()
    {
        var logger = new RecordingLogger<TokenRevocationClient>();

        await CreateClient(new StubHttpMessageHandler(HttpStatusCode.OK), logger).RevokeAsync(AccessToken, RefreshToken);

        Assert.Empty(logger.Entries);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("", null)]
    [InlineData(null, "")]
    public async Task Revoke_WithoutTokens_SendsNoRequest(string? accessToken, string? refreshToken)
    {
        var handler = new StubHttpMessageHandler();

        await CreateClient(handler).RevokeAsync(accessToken, refreshToken);

        // 没有令牌就不该发请求：空令牌请求只会被 IDP 以 invalid_request 拒绝，徒增噪声。
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Revoke_OnlyRefreshToken_SendsSingleRequest()
    {
        var handler = new StubHttpMessageHandler();

        await CreateClient(handler).RevokeAsync(accessToken: null, refreshToken: RefreshToken);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("refresh_token", request.Form["token_type_hint"]);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Revoke_ErrorResponse_DoesNotThrowAndLogsWarning(HttpStatusCode statusCode)
    {
        var handler = new StubHttpMessageHandler(statusCode);
        var logger = new RecordingLogger<TokenRevocationClient>();

        // 不外抛即为通过：撤销失败绝不能把登出流程卡住。
        await CreateClient(handler, logger).RevokeAsync(AccessToken, RefreshToken);

        Assert.Equal(2, logger.Entries.Count);
        Assert.All(logger.Entries, entry => Assert.Equal(LogLevel.Warning, entry.Level));
        Assert.Contains(logger.Entries, entry => entry.Message.Contains("refresh_token") && entry.Message.Contains(((int)statusCode).ToString()));
        // 第一次失败不得短路第二次：access_token 仍要尝试撤销。
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task Revoke_TransportFailure_DoesNotThrowAndLogsWarningWithException()
    {
        var handler = new StubHttpMessageHandler { ThrowOnSend = new HttpRequestException("connection refused") };
        var logger = new RecordingLogger<TokenRevocationClient>();

        await CreateClient(handler, logger).RevokeAsync(AccessToken, RefreshToken);

        Assert.Equal(2, logger.Entries.Count);
        Assert.All(logger.Entries, entry =>
        {
            Assert.Equal(LogLevel.Warning, entry.Level);
            Assert.NotNull(entry.Exception);
        });
        // 请求确实发过了（失败发生在发送时），不是被静默跳过。
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task Revoke_Timeout_DoesNotThrow()
    {
        // HttpClient.Timeout 触发的是 TaskCanceledException：它与其它失败一视同仁，不得打断登出。
        var handler = new StubHttpMessageHandler { ThrowOnSend = new TaskCanceledException("timeout") };
        var logger = new RecordingLogger<TokenRevocationClient>();

        await CreateClient(handler, logger).RevokeAsync(AccessToken, RefreshToken);

        Assert.Equal(2, logger.Entries.Count);
        Assert.All(logger.Entries, entry => Assert.Equal(LogLevel.Warning, entry.Level));
    }

    [Fact]
    public async Task Revoke_Logs_NeverContainTokenValues()
    {
        // 覆盖成功分支（无日志）、错误响应分支与异常分支：令牌取值属于凭据，一律不得进日志。
        var logger = new RecordingLogger<TokenRevocationClient>();
        await CreateClient(new StubHttpMessageHandler(HttpStatusCode.BadRequest), logger)
            .RevokeAsync(AccessToken, RefreshToken);
        await CreateClient(new StubHttpMessageHandler { ThrowOnSend = new HttpRequestException("boom") }, logger)
            .RevokeAsync(AccessToken, RefreshToken);

        Assert.NotEmpty(logger.Entries);
        Assert.DoesNotContain(
            logger.Entries,
            entry => entry.Message.Contains(AccessToken, StringComparison.Ordinal)
                || entry.Message.Contains(RefreshToken, StringComparison.Ordinal)
                || (entry.Exception?.ToString().Contains(AccessToken, StringComparison.Ordinal) ?? false)
                || (entry.Exception?.ToString().Contains(RefreshToken, StringComparison.Ordinal) ?? false));
        // 认证头里含客户端密钥，同样不得进日志。
        Assert.DoesNotContain(logger.Entries, entry => entry.Message.Contains(ClientSecret, StringComparison.Ordinal));
    }

    private static void AssertRevocationRequest(
        StubHttpMessageHandler.RecordedRequest request,
        string expectedTokenTypeHint,
        string expectedToken)
    {
        // 线上地址：issuer + 契约常量（share 仓 PandaAuthEndpoints.Revocation），代码侧不写字面量。
        Assert.Equal($"{Issuer.TrimEnd('/')}{PandaAuthEndpoints.Revocation}", request.Uri.ToString());
        Assert.Equal("/connect/revoke", request.Uri.AbsolutePath);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("application/x-www-form-urlencoded", request.ContentType);
        Assert.Equal(expectedToken, request.Form["token"]);
        Assert.Equal(expectedTokenTypeHint, request.Form["token_type_hint"]);
        // 机密客户端认证走 HTTP Basic：用户名 = client_id，口令 = client_secret。
        var expectedBasic = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{ClientId}:{ClientSecret}"));
        Assert.Equal(expectedBasic, request.Authorization);
    }
}
