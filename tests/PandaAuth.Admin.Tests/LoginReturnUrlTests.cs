using Xunit;

namespace PandaAuth.Admin.Tests;

/// <summary>
/// <c>/admin/login?returnUrl=</c> 的开放重定向防护测试（矩阵随 LoginReturnUrl 自 panda-auth-me 移植）。
/// </summary>
/// <remarks>
/// 每条「应回退」的用例都对应一种真实的绕过手法（外站绝对 URL、协议相对、反斜杠变体），
/// 不是对实现的重述——见 <see cref="LoginReturnUrl"/> 的 remarks。
/// </remarks>
public class LoginReturnUrlTests
{
    [Theory]
    // 外站绝对 URL：最直白的一种。
    [InlineData("https://evil.com")]
    [InlineData("http://evil.com/admin/")]
    // 协议相对：浏览器按当前 scheme 解析，等价于外站绝对 URL。
    [InlineData("//evil.com")]
    [InlineData("//evil.com/admin/")]
    // 反斜杠变体：URL 解析阶段 \ 被当作 /，于是它同样是协议相对。
    [InlineData("/\\evil.com")]
    // 非 /admin 前缀的本地路径：本服务不认，且没有放行的正当理由。
    [InlineData("/evil")]
    [InlineData("/")]
    // /admin 前缀但有反斜杠——不逐一推导归一化结果，直接回退。
    [InlineData("/admin/..\\evil.com")]
    [InlineData("/admin/\\evil.com")]
    // .. 段：归并后会得到 //evil.com，属归一化才成形的协议相对地址。
    [InlineData("/admin/..")]
    [InlineData("/admin/..//evil.com")]
    [InlineData("/admin/../users")]
    // 空值与空白。
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Sanitize_Rejects_And_Falls_Back(string? returnUrl)
    {
        Assert.Equal(LoginReturnUrl.Fallback, LoginReturnUrl.Sanitize(returnUrl));
    }

    [Theory]
    // 正常的站内回跳：带查询串也要原样保留（丢失查询串等于悄悄改变用户目的地）。
    [InlineData("/admin/users?x=1")]
    [InlineData("/admin/")]
    [InlineData("/admin")]
    [InlineData("/admin/users")]
    // 含 . 但不是 .. 段（"..b"、"..."）：不是 dot-segment，不该被误杀。
    [InlineData("/admin/a..b")]
    [InlineData("/admin/...")]
    public void Sanitize_Keeps_Local_Admin_Paths(string returnUrl)
    {
        Assert.Equal(returnUrl, LoginReturnUrl.Sanitize(returnUrl));
    }
}
