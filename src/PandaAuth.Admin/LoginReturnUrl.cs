namespace PandaAuth.Admin;

/// <summary>Validates local Admin business return targets; preserves the original query bytes.</summary>
public static class LoginReturnUrl
{
    public const string Fallback = "/admin/";

    public static string Sanitize(string? returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl) || returnUrl.Length > 4096 ||
            returnUrl.Contains('#') || returnUrl.Contains('\\') || returnUrl.Any(char.IsControl))
            return Fallback;

        var path = returnUrl.Split('?', 2)[0];
        // Encoded path separators/dot segments are unnecessary for registered Admin routes.
        // Query encoding remains supported for search, filters and pagination.
        if (path.Contains('%') || path.Contains("//", StringComparison.Ordinal) ||
            (!path.StartsWith("/admin/", StringComparison.Ordinal) && path != "/admin") ||
            path.Split('/').Any(segment => segment is "." or ".."))
            return Fallback;

        var route = path["/admin".Length..].Trim('/').Split('/')[0];
        if (new[] { "login", "challenge", "callback", "api", "logout", "signed-out" }
            .Contains(route, StringComparer.OrdinalIgnoreCase)) return Fallback;

        var decoded = returnUrl;
        for (var i = 0; i < 4; i++)
        {
            var next = Uri.UnescapeDataString(decoded);
            if (next.Any(char.IsControl) || next.Contains('\\')) return Fallback;
            if (next == decoded) return returnUrl;
            decoded = next;
        }
        return Fallback;
    }
}
