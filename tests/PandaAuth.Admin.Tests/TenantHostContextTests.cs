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
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = Principal("t0042", "t0042.auth.pandalabs.cn");

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    [Fact]
    public void TenantHost_WithDifferentTenant_IsRejected()
    {
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = Principal("t0043", "t0043.auth.pandalabs.cn");

        Assert.False(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Equal(TenantContextErrors.ContextMismatch, reason);
    }

    [Fact]
    public void TenantHost_WithMissingClaims_IsRejected()
    {
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.False(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Equal(TenantContextErrors.ContextMismatch, reason);
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
        var context = Request("t0042.auth.pandalabs.cn");
        context.Request.Scheme = "https";

        var issuer = TenantOidcRouting.ResolveIssuer(context.Request, new Uri("https://auth.pandalabs.cn/"));

        Assert.Equal("https://t0042.auth.pandalabs.cn/", issuer.ToString());
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
