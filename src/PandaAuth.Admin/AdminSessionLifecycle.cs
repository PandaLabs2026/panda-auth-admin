using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using PandaAuth.Shared;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace PandaAuth.Admin;

/// <summary>Tracks logged-out Admin sessions so a concurrent refresh cannot restore their cookie.</summary>
public sealed class AdminSessionLifecycle
{
    public const string SessionIdClaimType = "panda_admin_sid";
    public const string StartedAtClaimType = "panda_session_started_at";
    public static bool TryGetSessionId(ClaimsPrincipal? principal, out string sessionId)
    {
        sessionId = principal?.FindFirst(SessionIdClaimType)?.Value ?? string.Empty;
        return sessionId.Length > 0;
    }
    public static bool TryCreateLegacySessionId(ClaimsPrincipal? principal, AuthenticationProperties? properties, out string sessionId)
    {
        sessionId = string.Empty;
        var subject = principal?.FindFirst("sub")?.Value;
        if (string.IsNullOrWhiteSpace(subject)
            || properties?.IssuedUtc is not { } issued
            || properties.ExpiresUtc is not { } expires
            || expires <= issued)
        {
            return false;
        }

        var material = Encoding.UTF8.GetBytes($"{subject}\n{issued.UtcTicks}\n{expires.UtcTicks}");
        sessionId = "legacy-" + Convert.ToHexString(SHA256.HashData(material)).ToLowerInvariant();
        return true;
    }

    public static bool TryGetSessionStartedAt(ClaimsPrincipal? principal, AuthenticationProperties? properties, out long startedAt)
    {
        var value = principal?.FindFirst(StartedAtClaimType)?.Value;
        if (value is not null)
        {
            return long.TryParse(value, System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out startedAt);
        }

        if (properties?.IssuedUtc is { } issued)
        {
            startedAt = issued.ToUnixTimeSeconds();
            return true;
        }

        startedAt = 0;
        return false;
    }

    public static bool IsAbsoluteExpired(ClaimsPrincipal? principal, DateTimeOffset now)
    {
        var value = principal?.FindFirst(StartedAtClaimType)?.Value;
        if (!long.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var seconds)) return true;
        try { return now >= DateTimeOffset.FromUnixTimeSeconds(seconds).Add(PandaAuthSessionApi.AdminAbsoluteLifetime); }
        catch (ArgumentOutOfRangeException) { return true; }
    }

    private readonly ConcurrentDictionary<string, DateTimeOffset> _revoked = new(StringComparer.Ordinal);

    public static string NewSessionId() => Guid.NewGuid().ToString("N");

    public void Revoke(ClaimsPrincipal principal, AuthenticationProperties? properties)
    {
        var key = GetKey(principal, properties);
        if (key is not null)
        {
            _revoked[key] = properties?.ExpiresUtc ?? DateTimeOffset.UtcNow.AddHours(2);
        }
    }

    public bool IsRevoked(ClaimsPrincipal? principal, AuthenticationProperties? properties)
    {
        var key = principal is null ? null : GetKey(principal, properties);
        if (key is null || !_revoked.TryGetValue(key, out var expiresAt))
        {
            return false;
        }

        if (expiresAt > DateTimeOffset.UtcNow)
        {
            return true;
        }

        _revoked.TryRemove(new KeyValuePair<string, DateTimeOffset>(key, expiresAt));
        return false;
    }

    private static string? GetKey(ClaimsPrincipal principal, AuthenticationProperties? properties)
    {
        if (principal.FindFirst(SessionIdClaimType)?.Value is { Length: > 0 } sessionId)
        {
            return $"sid:{sessionId}";
        }

        // Compatibility for tickets minted before the session id claim was introduced.
        var subject = principal.FindFirst(Claims.Subject)?.Value;
        return subject is not null && properties?.ExpiresUtc is { } expiry
            ? $"legacy:{subject}:{expiry.UtcTicks}"
            : null;
    }
}
