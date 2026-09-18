using System.Security.Claims;
using PandaAuth.Shared;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.WebAdmin.Tests;

/// <summary>
/// 管理后台会话身份构建与 AdminRole 门禁判定测试——0.2 的安全核心。
/// </summary>
/// <remarks>
/// 门禁语义：**失败关闭**。roles 未到达（userinfo 不并入 Principal 的场景）等同无角色，
/// <c>IsAdmin=false</c> → 回调 403。绝不允许「拿不到角色就放行」。
/// </remarks>
public class AdminSessionIdentityTests
{
    private static ClaimsPrincipal OidcPrincipal(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, "OpenIddictClient"));

    [Fact]
    public void Build_WithAdminRole_PassesGateAndCopiesClaims()
    {
        var principal = OidcPrincipal(
            new Claim(Claims.Subject, "user-1"),
            new Claim(Claims.Name, "admin"),
            new Claim(Claims.Email, "admin@pandalabs.cc"),
            new Claim(PandaAuthClaims.Nickname, "PandaAdmin"),
            new Claim(Claims.Role, PandaAuthRoles.Admin));

        var (identity, isAdmin) = AdminSessionIdentity.Build(principal);

        Assert.True(isAdmin);
        // Cookie 身份显式设置 OIDC 短名 ClaimType：User.Identity.Name / User.IsInRole 依赖它。
        Assert.Equal(Claims.Name, identity.NameClaimType);
        Assert.Equal(Claims.Role, identity.RoleClaimType);
        Assert.Equal("user-1", identity.FindFirst(Claims.Subject)?.Value);
        Assert.Equal("admin", identity.FindFirst(Claims.Name)?.Value);
        Assert.Equal("admin@pandalabs.cc", identity.FindFirst(Claims.Email)?.Value);
        Assert.Equal("PandaAdmin", identity.FindFirst(PandaAuthClaims.Nickname)?.Value);
        Assert.Equal(PandaAuthRoles.Admin, identity.FindFirst(Claims.Role)?.Value);
    }

    [Fact]
    public void Build_MultipleRolesIncludingAdmin_PassesGateAndCopiesAll()
    {
        var principal = OidcPrincipal(
            new Claim(Claims.Subject, "user-1"),
            new Claim(Claims.Role, "operator"),
            new Claim(Claims.Role, PandaAuthRoles.Admin));

        var (identity, isAdmin) = AdminSessionIdentity.Build(principal);

        // 角色全量复制（会话端点回显、后续功能按角色细分），门禁只认 admin。
        Assert.True(isAdmin);
        Assert.Equal(["operator", PandaAuthRoles.Admin], identity.FindAll(Claims.Role).Select(claim => claim.Value));
    }

    [Fact]
    public void Build_WithoutAdminRole_FailsGate()
    {
        var principal = OidcPrincipal(
            new Claim(Claims.Subject, "user-1"),
            new Claim(Claims.Name, "普通用户"),
            new Claim(Claims.Role, "operator"));

        var (identity, isAdmin) = AdminSessionIdentity.Build(principal);

        // 身份仍返回（供审计日志记 sub），但调用方必须凭 IsAdmin=false 拒绝 SignIn。
        Assert.False(isAdmin);
        Assert.Equal("user-1", identity.FindFirst(Claims.Subject)?.Value);
    }

    /// <summary>
    /// **失败关闭的关键用例**：IDP 把 name/email/roles 只写入 AT（不进 ID token），
    /// 这些声明依赖 OpenIddict 客户端的自动 userinfo 并入。若该机制不生效，
    /// Principal 只剩 sub——此时门禁必须拒绝，而不是把「无角色」当「无需角色」。
    /// </summary>
    [Fact]
    public void Build_WithOnlySubjectClaim_FailsClosed()
    {
        var principal = OidcPrincipal(new Claim(Claims.Subject, "user-1"));

        var (identity, isAdmin) = AdminSessionIdentity.Build(principal);

        Assert.False(isAdmin);
        Assert.Equal("user-1", identity.FindFirst(Claims.Subject)?.Value);
        Assert.Empty(identity.FindAll(Claims.Role));
    }

    [Fact]
    public void Build_EmptyOrNullClaims_AreNotCopied()
    {
        // 空串声明不进身份：会话端点据 null/缺省渲染「未绑定邮箱」等占位，而不是空串。
        var principal = OidcPrincipal(
            new Claim(Claims.Subject, "user-1"),
            new Claim(Claims.Name, ""),
            new Claim(Claims.Email, ""),
            new Claim(PandaAuthClaims.Nickname, ""),
            new Claim(Claims.Role, PandaAuthRoles.Admin));

        var (identity, isAdmin) = AdminSessionIdentity.Build(principal);

        Assert.True(isAdmin);
        Assert.Null(identity.FindFirst(Claims.Name));
        Assert.Null(identity.FindFirst(Claims.Email));
        Assert.Null(identity.FindFirst(PandaAuthClaims.Nickname));
    }

    [Fact]
    public void Build_MissingSubject_FallsBackToEmpty()
    {
        // sub 是 ID token 的必含声明，缺失属协议异常；兜底空串让身份仍可审计（而非抛异常打断 403 路径）。
        var (identity, isAdmin) = AdminSessionIdentity.Build(OidcPrincipal(new Claim(Claims.Role, PandaAuthRoles.Admin)));

        Assert.True(isAdmin);
        Assert.Equal(string.Empty, identity.FindFirst(Claims.Subject)?.Value);
    }
}
