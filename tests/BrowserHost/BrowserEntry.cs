using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc.Testing;
namespace PandaAuth.Admin.BrowserTests;

// Test-only entrypoint. Never referenced by the application or Docker image.
public static class BrowserEntry
{
    public static async Task Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Expected repository root and private temporary metadata path.");
        var root = Path.GetFullPath(args[0]);
        if (!File.Exists(Path.Combine(root, "src/PandaAuth.Admin/wwwroot/admin/index.html")))
            throw new InvalidOperationException("Build the actual frontend first.");
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = X509CertificateLoader.LoadPkcs12(request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(1)).Export(X509ContentType.Pfx), null);
        await using var identity = new FixtureIdentity();
        await identity.StartAsync(certificate);
        await using var factory = new WebApplicationFactory<global::Program>().WithWebHostBuilder(builder =>
        {
            builder.UseContentRoot(Path.Combine(root, "src/PandaAuth.Admin"));
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:Issuer", identity.Issuer);
            builder.UseSetting("Auth:IdpInternalBaseAddress", identity.Issuer);
            builder.UseSetting("Auth:ClientId", "admin-web");
            builder.UseSetting("Auth:ClientSecret", "browser-fixture-only");
            builder.UseSetting("Auth:SessionState:ClientSecret", "browser-fixture-session-only");
            builder.ConfigureLogging(logging => logging.ClearProviders());
            builder.ConfigureServices(services => {
                HttpClientHandler Handler() => new() { ServerCertificateCustomValidationCallback = (message, cert, _, _) =>
                    message.RequestUri?.IsLoopback == true && cert?.GetCertHashString() == certificate.GetCertHashString() };
                services.AddOpenIddict().AddClient(options => options.UseSystemNetHttp().ConfigureHttpClientHandler(handler => {
                    handler.ServerCertificateCustomValidationCallback = (message, cert, _, _) => message.RequestUri?.IsLoopback == true && cert?.GetCertHashString() == certificate.GetCertHashString();
                }));
                services.AddHttpClient<PandaAuth.Admin.AdminApiProxy>().ConfigurePrimaryHttpMessageHandler(Handler);
                services.AddHttpClient<PandaAuth.Admin.TokenRevocationClient>().ConfigurePrimaryHttpMessageHandler(Handler);
                services.AddHttpClient("session-state").ConfigurePrimaryHttpMessageHandler(Handler);
            });
        });
        factory.UseKestrel(options => options.Listen(IPAddress.Loopback, 0, listener => listener.UseHttps(certificate)));
        factory.StartServer();
        var origin = factory.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        identity.ClientOrigin = origin;
        File.WriteAllText(args[1], JsonSerializer.Serialize(new { origin, issuer = identity.Issuer, fixture = "admin-browser-https" }));
        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
        try { await Task.Delay(Timeout.Infinite, stop.Token); } catch (OperationCanceledException) { }
    }
}
