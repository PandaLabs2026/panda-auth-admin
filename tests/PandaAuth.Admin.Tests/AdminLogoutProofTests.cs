using Microsoft.AspNetCore.DataProtection;
using Xunit;
namespace PandaAuth.Admin.Tests;
public class AdminLogoutProofTests
{
    [Fact]
    public void Proof_IsShortLived_AndCannotBeForgedOrUsedByAnAuthenticatedSession()
    {
        var proof = new AdminLogoutProof(new EphemeralDataProtectionProvider());
        var now = DateTimeOffset.UtcNow;
        var token = proof.Create(now);
        Assert.True(proof.Validate(token, now, authenticated: false));
        Assert.False(proof.Validate(token, now, authenticated: true));
        Assert.False(proof.Validate(token, now.AddMinutes(2), authenticated: false));
        Assert.False(proof.Validate(token, now.AddMinutes(-1), authenticated: false));
        Assert.False(proof.Validate("true", now, authenticated: false));
        Assert.False(proof.Validate(null, now, authenticated: false));
    }
}
