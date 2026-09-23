using Microsoft.AspNetCore.Authentication;

namespace PandaAuth.Admin;

/// <summary>
/// 会话 Cookie 票据中保存的 IDP 令牌。
/// </summary>
/// <remarks>
/// 写入侧（OIDC 回调的 <c>StoreTokens</c>）与读取侧（登出撤销）共用这里的名称常量，
/// 避免两侧各写一份字面量后悄悄漂移——漂移的后果是「登出看起来成功，令牌其实没撤」。
/// 移植自 panda-auth-me 的同名类型。
/// </remarks>
public static class SessionTokens
{
    public const string AccessTokenName = "access_token";

    public const string RefreshTokenName = "refresh_token";

    /// <summary>
    /// 从会话票据中解出令牌；未登录或票据不含令牌时返回 <c>(null, null)</c>，
    /// 由调用方按「无令牌即不撤销」处理。
    /// </summary>
    /// <remarks>
    /// 取法与写入侧对称：回调把令牌经 <c>AuthenticationProperties.StoreTokens</c> 存进票据，
    /// 这里用同一认证方案 <c>AuthenticateAsync</c> 取回 <c>AuthenticateResult.Properties</c>，
    /// 再 <c>GetTokenValue</c>。
    /// </remarks>
    public static (string? AccessToken, string? RefreshToken) Read(AuthenticateResult? result)
    {
        var properties = result?.Properties;
        return (properties?.GetTokenValue(AccessTokenName), properties?.GetTokenValue(RefreshTokenName));
    }
}
