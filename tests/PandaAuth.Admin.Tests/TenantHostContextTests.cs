using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using PandaAuth.Admin;
using PandaAuth.Shared;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.Admin.Tests;

public class TenantHostContextTests
{
    [Fact]
    public void TenantHost_WithMatchingClaims_IsAccepted()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = Principal("t0042", "t0042-auth.s001.pandalabs.cn");

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    [Fact]
    public void TenantHost_WithDifferentTenant_IsRejected()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = Principal("t0043", "t0043-auth.s001.pandalabs.cn");

        Assert.False(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Equal(TenantContextErrors.ContextMismatch, reason);
    }

    [Fact]
    public void TenantHost_WithMissingClaims_IsRejected()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.False(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Equal(TenantContextErrors.ContextMismatch, reason);
    }

    [Fact]
    public void DisabledTenantRouting_PreservesLegacyPassthrough()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason, enabled: false));
        Assert.Null(reason);
    }

    [Fact]
    public void Localhost_DoesNotRequireTenantClaims()
    {
        var context = Request("localhost");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    [Fact]
    public void LegacyTenantHost_IsTreatedAsNonTenantHost()
    {
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    [Fact]
    public void PlatformHost_DoesNotRequireTenantClaims()
    {
        var context = Request("auth.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    [Fact]
    public void TenantHost_UsesTheCurrentHostAsOidcIssuer()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        context.Request.Scheme = "https";

        var issuer = TenantOidcRouting.ResolveIssuer(context.Request, new Uri("https://auth.appliket.com/"));

        Assert.Equal("https://t0042-auth.s001.pandalabs.cn/", issuer.ToString());
    }

    [Fact]
    public void PlatformHost_KeepsTheConfiguredIssuer()
    {
        var context = Request("auth.appliket.com");
        context.Request.Scheme = "https";

        var issuer = TenantOidcRouting.ResolveIssuer(context.Request, new Uri("https://auth.appliket.com/"));

        Assert.Equal("https://auth.appliket.com/", issuer.ToString());
    }

    private static DefaultHttpContext Request(string host)
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString(host);
        return context;
    }

    private static ClaimsPrincipal Principal(string tenantId, string host) =>
        new(new ClaimsIdentity([
            new Claim(PandaAuthClaims.TenantId, tenantId),
            new Claim(PandaAuthClaims.TenantHost, host),
        ], "oidc"));
}
