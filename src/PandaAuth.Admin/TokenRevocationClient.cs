using System.Net.Http.Headers;
using System.Text;
using PandaAuth.Shared;

namespace PandaAuth.Admin;

/// <summary>
/// 登出撤销所需的 IDP 侧配置：issuer 与 admin-web 客户端凭据。
/// </summary>
/// <remarks>
/// 取值与 OpenIddict 客户端注册同源（同一组 <c>Auth:*</c> 配置），不引入第二份事实源。
/// 移植自 panda-auth-me 的同名类型。
/// </remarks>
public sealed record TokenRevocationOptions(Uri Issuer, string ClientId, string ClientSecret);

/// <summary>
/// 向 IDP 的撤销端点撤销保存在会话 Cookie 中的令牌（RFC 7009）。
/// </summary>
/// <remarks>
/// <para>
/// 之所以独立成可注入类型、而不是把 HTTP 调用内联在端点委托里：可以用桩
/// <see cref="HttpMessageHandler"/> 对**真实发出的请求**（URL、表单字段、认证头）做断言，
/// 而不是只数调用次数。
/// </para>
/// <para>
/// 全程尽力而为：任何失败只记 warning 日志，绝不外抛、绝不阻断登出。用户点了登出就必须登出——
/// 撤销失败的最坏后果是「令牌在自然过期前仍可用」，比「登出报错、凭据还留在浏览器里」轻得多。
/// </para>
/// </remarks>
public sealed class TokenRevocationClient(
    HttpClient httpClient,
    TokenRevocationOptions options,
    ILogger<TokenRevocationClient> logger)
{
    /// <summary>
    /// 撤销给定令牌。两个令牌都为空时不发任何请求。
    /// </summary>
    /// <remarks>
    /// 顺序是先 refresh_token 后 access_token：前者有效期 14 天，是登出后仍能换新的唯一凭据，
    /// 撤销它才真正切断链路；后者只有 10 分钟，但既然就握在手里，一并撤掉可把泄漏窗口压到零。
    /// 两次调用互不短路——前一次失败不影响后一次。
    /// </remarks>
    public async Task RevokeAsync(string? accessToken, string? refreshToken, CancellationToken cancellationToken = default)
    {
        await RevokeOneAsync(refreshToken, "refresh_token", cancellationToken);
        await RevokeOneAsync(accessToken, "access_token", cancellationToken);
    }

    private async Task RevokeOneAsync(string? token, string tokenTypeHint, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(token))
        {
            // 无令牌（例如票据里只有身份、没存令牌）直接跳过，不发请求：
            // 空令牌请求只会被 IDP 以 invalid_request 拒绝，徒增噪声与日志。
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, RevocationUri)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["token"] = token,
                    ["token_type_hint"] = tokenTypeHint,
                }),
            };
            // 机密客户端认证走 HTTP Basic（RFC 6749 §2.3.1），与 IDP 侧 admin-web 的机密客户端类型一致。
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.ClientId}:{options.ClientSecret}")));

            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                // 4xx/5xx 都不是登出的失败：令牌可能本就被 IDP 清掉了，最坏也只是没撤成。
                logger.LogWarning(
                    "登出撤销 {TokenTypeHint} 未成功：IDP 返回 {StatusCode}（不影响登出）。",
                    tokenTypeHint,
                    (int)response.StatusCode);
            }
        }
        catch (Exception exception)
        {
            // 刻意捕获全部异常：网络不可达、DNS/连接失败、HttpClient.Timeout 触发的 TaskCanceledException、
            // 以及请求中止的 OperationCanceledException 都在此列。撤销是登出路径上的后置动作，
            // 任何一类失败都不允许把用户卡在「登不出去」的状态里。
            // 日志只记令牌类型与异常信息，绝不记令牌取值——Cookie 里的凭据不进日志。
            logger.LogWarning(exception, "登出撤销 {TokenTypeHint} 失败（不影响登出）：{Reason}", tokenTypeHint, exception.Message);
        }
    }

    /// <summary>撤销端点地址：契约常量拼在 issuer 之后（<c>{issuer}/connect/revoke</c>）。</summary>
    /// <remarks>
    /// 用字符串拼接而非 <see cref="Uri"/> 相对解析：issuer 若带路径前缀（例如 <c>https://host/idp/</c>），
    /// 以 <c>/</c> 开头的契约常量会把前缀整段吃掉，拼出错误的地址。
    /// </remarks>
    private Uri RevocationUri =>
        new($"{options.Issuer.OriginalString.TrimEnd('/')}{PandaAuthEndpoints.Revocation}", UriKind.Absolute);
}
