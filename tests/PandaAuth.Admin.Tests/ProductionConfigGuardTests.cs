using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// 生产环境 IDP 地址配置的失败关闭守卫（真实 Program.cs）。
/// </summary>
/// <remarks>
/// Auth:Issuer / Auth:IdpInternalBaseAddress 缺失**或仍是开发默认值**时生产不得静默放行——
/// 镜像烤着的 appsettings.json 让键永远「存在」，绕过 compose 直跑容器时只有按值判定才拦得住；
/// 把公网流量指向开发地址是配置事故，应启动即失败而非运行期偶发故障（与 ClientSecret
/// 同款哲学）。断言三层：缺 Issuer / 缺内网基址 / 开发默认值各自拒绝启动，真实值可启动
/// （守卫不得误伤正常生产配置）。
/// </remarks>
public class ProductionConfigGuardTests
{
    private static WebApplicationFactory<Program> Factory(Action<IWebHostBuilder> configure) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            // ClientSecret 的失败关闭先于本守卫：注入之以隔离被测的两个键。
            builder.UseSetting("Auth:ClientSecret", "unit-test-secret");
            configure(builder);
        });

    [Fact]
    public void Production_WithoutIssuer_RefusesToStart()
    {
        // 空串覆盖 appsettings 里的开发值，模拟部署环境未注入。
        using var factory = Factory(builder =>
        {
            builder.UseSetting("Auth:Issuer", "");
            builder.UseSetting("Auth:IdpInternalBaseAddress", "http://127.0.0.1:6000/");
        });

        var exception = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(exception);
        Assert.Contains("Auth:Issuer", exception.ToString());
    }

    [Fact]
    public void Production_WithoutIdpInternalBaseAddress_RefusesToStart()
    {
        using var factory = Factory(builder =>
        {
            builder.UseSetting("Auth:Issuer", "https://auth.pandalabs.cn/");
            builder.UseSetting("Auth:IdpInternalBaseAddress", "");
        });

        var exception = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(exception);
        Assert.Contains("Auth:IdpInternalBaseAddress", exception.ToString());
    }

    [Fact]
    public void Production_WithBakedDevelopmentDefaults_RefusesToStart()
    {
        // 镜像直跑（无 compose 环境变量）时 appsettings 的开发值原样生效——按值拦截。
        using var factory = Factory(_ => { });

        var exception = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(exception);
        Assert.Contains("Auth:Issuer", exception.ToString());
    }

    [Fact]
    public async Task Production_WithRealEndpoints_StartsUp()
    {
        using var factory = Factory(builder =>
        {
            builder.UseSetting("Auth:Issuer", "https://auth.pandalabs.cn/");
            // 内网基址在 host-network 生产形态本就是回环地址（compose 注入 127.0.0.1:6000），
            // 守卫只拦开发默认端口 9004，不按「是否回环」一刀切。
            builder.UseSetting("Auth:IdpInternalBaseAddress", "http://127.0.0.1:6000/");
        });
        using var client = factory.CreateClient();

        // 探活匿名端点：能响应即证明守卫没有把合法生产配置一并拒掉。
        using var response = await client.GetAsync("/admin/healthz");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
