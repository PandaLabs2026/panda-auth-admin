using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using OpenIddict.Abstractions;
using PandaAuth.Shared;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.WebAdmin;

/// <summary>
/// OIDC 回调结果 → 管理后台会话 Cookie 身份的构建（含 AdminRole 门禁判定）。
/// internal 而非端点内联：角色门禁是 0.2 的安全核心，必须可单元测试
/// （先例：server 的 <c>AuthorizationController.CreatePrincipalAsync</c> 同为 internal 可测）。
/// </summary>
/// <remarks>
/// <para>
/// 声明来源的事实（2026-09-18 核实）：IDP 的 <c>CreatePrincipalAsync</c> 把 name/email/nickname/roles
/// **只写入 Access Token**（<c>SetDestinations(_ => [Destinations.AccessToken])</c>），ID token 仅有
/// <c>sub</c>。因此本函数读到的这些声明依赖 OpenIddict 客户端在交互式认证中**自动发出的 userinfo
/// 请求**把声明并入 Principal（<c>InteractiveAuthenticationResult.UserInfoTokenPrincipal</c> 与
/// <c>DisableUserInfo</c> 开关佐证该机制；panda-auth-me 与 DemoClient 的回调同款取法）。
/// </para>
/// <para>
/// 若该机制在某次部署中不生效（roles 未到达），门禁按**失败关闭**处理：<c>IsAdmin=false</c> → 403。
/// 这是有意设计：宁可管理员登不进并从日志定位，也不能让无角色判定变成放行。
/// </para>
/// </remarks>
internal static class AdminSessionIdentity
{
    /// <summary>
    /// 从 OIDC 客户端认证结果的 Principal 构建会话身份，并判定是否具备 admin 角色。
    /// </summary>
    /// <param name="principal">回调 <c>AuthenticateAsync(OpenIddictClient)</c> 的 Principal（ID token + userinfo 合并结果）。</param>
    /// <returns>Cookie 身份与门禁判定；门禁不通过时身份仍返回（供审计日志记 sub），调用方不得 SignIn。</returns>
    public static (ClaimsIdentity Identity, bool IsAdmin) Build(ClaimsPrincipal principal)
    {
        // 显式声明 name/role 的 ClaimType：Cookie 身份默认值是 ClaimTypes.Name/Role（长 URI 形态），
        // 而 OIDC 声明是短名（"name"/"role"）。不设置的话 User.Identity.Name 与 User.IsInRole 全部落空。
        var identity = new ClaimsIdentity(
            CookieAuthenticationDefaults.AuthenticationScheme, Claims.Name, Claims.Role);

        identity.AddClaim(new Claim(Claims.Subject, principal.GetClaim(Claims.Subject) ?? string.Empty));

        AddIfPresent(identity, principal, Claims.Name);
        AddIfPresent(identity, principal, Claims.Email);
        AddIfPresent(identity, principal, PandaAuthClaims.Nickname);

        // 角色全量复制（不止 admin 一个）：会话端点回显 roles，管理侧功能将来按角色细分。
        // 门禁判定只认 PandaAuthRoles.Admin（share 契约常量，与 server 的 AdminRole 值一致）。
        var roles = principal.FindAll(Claims.Role).ToList();
        identity.AddClaims(roles);

        return (identity, roles.Any(role => string.Equals(role.Value, PandaAuthRoles.Admin, StringComparison.Ordinal)));
    }

    private static void AddIfPresent(ClaimsIdentity target, ClaimsPrincipal source, string claimType)
    {
        var value = source.GetClaim(claimType);
        if (!string.IsNullOrEmpty(value))
        {
            target.AddClaim(new Claim(claimType, value));
        }
    }
}
