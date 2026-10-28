using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PandaAuth.Shared;
namespace PandaAuth.Admin.BrowserTests;

internal sealed class FixtureIdentity : IAsyncDisposable
{
    private readonly RSA key = RSA.Create(2048);
    private readonly ConcurrentDictionary<string, Dictionary<string,string>> codes = new();
    private WebApplication app = null!;
    public string Issuer { get; private set; } = "";
    public string ClientOrigin { get; set; } = "";
    public int AuthorizationRequests { get; private set; }
    public int TokenRequests { get; private set; }
    public int Exchanges { get; private set; }
    public bool PkceVerified { get; private set; }
    public bool LogoutSeen { get; private set; }
    private const string Access = "synthetic-browser-access";
    private const string Sid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    public async Task StartAsync(X509Certificate2 certificate)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, 0, o => o.UseHttps(certificate)));
        app = builder.Build();
        app.MapGet("/.well-known/openid-configuration", () => Results.Json(new {
            issuer = Issuer, authorization_response_iss_parameter_supported = true, authorization_endpoint = Issuer + "connect/authorize", token_endpoint = Issuer + "connect/token",
            userinfo_endpoint = Issuer + "connect/userinfo", jwks_uri = Issuer + "jwks", end_session_endpoint = Issuer + "connect/logout",
            revocation_endpoint = Issuer + "connect/revoke", response_types_supported = new[] { "code" },
            response_modes_supported = new[] { "query" }, grant_types_supported = new[] { "authorization_code", "refresh_token", "client_credentials" },
            subject_types_supported = new[] { "public" }, id_token_signing_alg_values_supported = new[] { "RS256" },
            token_endpoint_auth_methods_supported = new[] { "client_secret_post" }, code_challenge_methods_supported = new[] { "S256" },
            scopes_supported = new[] { "openid", "profile", "email", "roles", "offline_access", PandaAuthAdminApi.Scope }
        }));
        app.MapGet("/jwks", () => {
            var p = key.ExportParameters(false);
            return Results.Json(new { keys = new[] { new { kty = "RSA", kid = "browser-fixture", use = "sig", alg = "RS256", n = Base64UrlEncoder.Encode(p.Modulus!), e = Base64UrlEncoder.Encode(p.Exponent!) } } });
        });
        app.MapGet("/connect/authorize", (HttpContext c) => {
            AuthorizationRequests++;
            var q = c.Request.Query;
            if (q["client_id"] != "admin-web" || q["response_type"] != "code" || q["code_challenge_method"] != "S256" ||
                q["redirect_uri"] != ClientOrigin + "/admin/callback/login/pandaauth") return Results.BadRequest();
            var code = Guid.NewGuid().ToString("N");
            codes[code] = q.ToDictionary(p => p.Key, p => p.Value.ToString());
            return Results.Redirect(QueryHelpers.AddQueryString(q["redirect_uri"].ToString(), new Dictionary<string,string?> {
                ["code"] = code, ["state"] = q["state"], ["iss"] = Issuer
            }));
        });
        app.MapPost("/connect/token", async (HttpContext c) => {
            TokenRequests++;
            var f = await c.Request.ReadFormAsync();
            if (f["grant_type"] == "client_credentials") return Results.Json(new { access_token = "synthetic-session-access", token_type = "Bearer", expires_in = 300 });
            if (f["client_secret"] != "browser-fixture-only" || f["client_id"] != "admin-web" ||
                !codes.TryRemove(f["code"].ToString(), out var q) || f["redirect_uri"] != q["redirect_uri"]) return Results.BadRequest();
            var challenge = Base64UrlEncoder.Encode(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(f["code_verifier"].ToString())));
            if (challenge != q["code_challenge"]) return Results.BadRequest();
            PkceVerified = true; Exchanges++;
            var jwt = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor {
                Issuer = Issuer, Audience = "admin-web", IssuedAt = DateTime.UtcNow, NotBefore = DateTime.UtcNow.AddSeconds(-10), Expires = DateTime.UtcNow.AddMinutes(5),
                SigningCredentials = new SigningCredentials(new RsaSecurityKey(key) { KeyId = "browser-fixture" }, SecurityAlgorithms.RsaSha256),
                Claims = new Dictionary<string,object> { ["sub"] = "browser-user", ["nonce"] = q["nonce"], ["at_hash"] = Base64UrlEncoder.Encode(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(Access))[..16]), [PandaAuthClaims.SsoSessionId] = Sid }
            });
            return Results.Json(new { access_token = Access, refresh_token = "synthetic-browser-refresh", token_type = "Bearer", expires_in = 300, id_token = jwt, scope = q["scope"] });
        });
        app.MapGet("/connect/userinfo", () => Results.Json(new Dictionary<string,object> { ["sub"] = "browser-user", ["name"] = "Browser Admin", ["role"] = new[] { "admin" }, [PandaAuthClaims.SsoSessionId] = Sid }));
        app.MapGet("/connect/logout", (HttpContext c) => {
            if (c.Request.Query["post_logout_redirect_uri"] != ClientOrigin + "/admin/callback/logout/pandaauth") return Results.BadRequest();
            LogoutSeen = true;
            return Results.Redirect(QueryHelpers.AddQueryString(c.Request.Query["post_logout_redirect_uri"].ToString(), "state", c.Request.Query["state"].ToString()));
        });
        app.MapPost("/connect/revoke", () => Results.NoContent());
        app.MapGet("/fixture/evidence", () => Results.Json(new { Exchanges, PkceVerified, LogoutSeen, AuthorizationRequests, TokenRequests }));
        app.MapFallback((HttpContext c) => Results.Json(c.Request.Path.Value!.Contains("mfa/capability", StringComparison.Ordinal)
            ? (object)new { totpBound = true, mfaSatisfied = true } : c.Request.Method == "POST" ? new { revoked = false } : new { items = Array.Empty<object>(), total = 0, page = 1, pageSize = 20 }));
        await app.StartAsync();
        Issuer = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single().TrimEnd('/') + "/";
    }
    public async ValueTask DisposeAsync() { await app.DisposeAsync(); key.Dispose(); }
}
