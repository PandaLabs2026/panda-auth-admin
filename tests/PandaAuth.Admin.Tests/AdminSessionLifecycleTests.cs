using System.Security.Claims;
using PandaAuth.Admin;
using Xunit;

namespace PandaAuth.Admin.Tests;

public class AdminSessionLifecycleTests
{
    [Fact]
    public void AbsoluteLifetime_ExpiresAtTwoHoursAndRejectsMissingOrMalformedStart()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var before = Principal(now.AddHours(-2).AddSeconds(1));
        var expired = Principal(now.AddHours(-2));

        Assert.False(AdminSessionLifecycle.IsAbsoluteExpired(before, now));
        Assert.True(AdminSessionLifecycle.IsAbsoluteExpired(expired, now));
        Assert.True(AdminSessionLifecycle.IsAbsoluteExpired(new ClaimsPrincipal(new ClaimsIdentity()), now));
        Assert.True(AdminSessionLifecycle.IsAbsoluteExpired(Principal("not-a-time"), now));
    }

    [Fact]
    public void LegacySessionId_IsStableForSameTicketAndDistinctAcrossLoginTickets()
    {
        var issued = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "admin-user")], "test"));
        var properties = new Microsoft.AspNetCore.Authentication.AuthenticationProperties
        {
            IssuedUtc = issued,
            ExpiresUtc = issued.AddHours(2),
        };

        Assert.True(AdminSessionLifecycle.TryCreateLegacySessionId(principal, properties, out var first));
        Assert.True(AdminSessionLifecycle.TryCreateLegacySessionId(principal, properties, out var replay));
        Assert.Equal(first, replay);

        properties.IssuedUtc = issued.AddSeconds(1);
        Assert.True(AdminSessionLifecycle.TryCreateLegacySessionId(principal, properties, out var nextLogin));
        Assert.NotEqual(first, nextLogin);
    }

    [Fact]
    public void LegacySessionStart_UsesOriginalTicketIssueTime()
    {
        var issued = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "admin-user")], "test"));
        var properties = new Microsoft.AspNetCore.Authentication.AuthenticationProperties { IssuedUtc = issued };

        Assert.True(AdminSessionLifecycle.TryGetSessionStartedAt(principal, properties, out var startedAt));
        Assert.Equal(issued.ToUnixTimeSeconds(), startedAt);
    }

    private static ClaimsPrincipal Principal(DateTimeOffset started) => Principal(started.ToUnixTimeSeconds().ToString());
    private static ClaimsPrincipal Principal(string started) => new(new ClaimsIdentity(
        [new Claim(AdminSessionLifecycle.StartedAtClaimType, started)], "test"));
}
