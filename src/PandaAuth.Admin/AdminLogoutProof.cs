using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
namespace PandaAuth.Admin;

/// <summary>Presentation evidence for local logout only; never an authorization or IdP logout credential.</summary>
public sealed class AdminLogoutProof(IDataProtectionProvider provider)
{
    public const string CookieName = "__Secure-PandaAuth.Admin.LocalLogout";
    private readonly IDataProtector protector = provider.CreateProtector("PandaAuth.Admin.LocalLogout.v1");
    public string Create(DateTimeOffset now) => protector.Protect(now.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
    public bool Validate(string? token, DateTimeOffset now, bool authenticated)
    {
        if (authenticated || string.IsNullOrEmpty(token)) return false;
        try
        {
            if (!long.TryParse(protector.Unprotect(token), NumberStyles.None, CultureInfo.InvariantCulture, out var issued)) return false;
            var age = now.ToUnixTimeSeconds() - issued;
            return age is >= 0 and <= 60;
        }
        catch (CryptographicException) { return false; }
    }
    public static CookieOptions CookieOptions => new() {
        HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax,
        Path = "/admin/signed-out", MaxAge = TimeSpan.FromSeconds(60), IsEssential = true
    };
}
