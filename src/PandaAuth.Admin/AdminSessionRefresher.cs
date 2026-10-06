using OpenIddict.Client;

namespace PandaAuth.Admin;

/// <summary>一次成功刷新换出的新令牌（任一字段理论可为 null，由调用方按缺失处理）。</summary>
public sealed record RefreshedTokens(string? AccessToken, string? RefreshToken);

/// <summary>
/// 会话刷新通道：用 refresh token 向 IDP 换新令牌。
/// </summary>
/// <remarks>
/// 之所以抽接口：OpenIddictClientService 是具体类且 AuthenticateWithRefreshTokenAsync
/// 非虚方法，测试无法桩掉（此前「401 → 刷新 → 重试」链路因此完全依赖生产浏览器验收，
/// 刷新单飞这类并发行为回归无从钉住）。接口只暴露代理需要的最小面，
/// issuer 解析与 provider 绑定留在实现内部。
/// </remarks>
public interface IAdminSessionRefresher
{
    /// <summary>执行刷新；失败以异常抛出，由调用方（AdminApiProxy）折算为未认证。</summary>
    Task<RefreshedTokens> RefreshAsync(HttpContext context, string refreshToken, CancellationToken cancellationToken);
}

/// <summary>
/// 生产实现：直连 OpenIddict 客户端刷新（授权服务器地址按租户路由解析）。
/// </summary>
public sealed class OpenIddictAdminSessionRefresher(
    OpenIddictClientService openIddict,
    IConfiguration configuration) : IAdminSessionRefresher
{
    private const string ProviderName = "pandaauth";

    // issuer 从配置读取而非构造注入 Uri——与 AdminApiProxy 同款约束的延续：依赖链上有
    // DI 激活的 typed client，保持 IConfiguration 注入形态一致（2026-09-19 生产实测
    // Uri 注入激活即 500，此处不再重蹈）。
    private Uri PlatformIssuer { get; } = new(configuration["Auth:Issuer"] ?? "http://localhost:9004/");

    public async Task<RefreshedTokens> RefreshAsync(HttpContext context, string refreshToken, CancellationToken cancellationToken)
    {
        var result = await openIddict.AuthenticateWithRefreshTokenAsync(new OpenIddictClientModels.RefreshTokenAuthenticationRequest
        {
            Issuer = TenantOidcRouting.ResolveIssuer(context.Request, PlatformIssuer),
            ProviderName = ProviderName,
            RefreshToken = refreshToken,
            CancellationToken = cancellationToken,
        });

        return new RefreshedTokens(result.AccessToken, result.RefreshToken);
    }
}
