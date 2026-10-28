using Xunit;
namespace PandaAuth.Admin.Tests;
public class AdminAuthPageTests
{
    [Fact]
    public void StatusPage_EncodesText_AndProvidesResponsiveExplicitNavigation()
    {
        var html = AdminAuthPage.Render("退出状态", ["<script>alert(1)</script>"], false);
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("name=\"viewport\"", html);
        Assert.Contains("PandaAuth by PandaLabs", html);
        Assert.Contains("href=\"/admin/login\"", html);
        Assert.Contains(":focus-visible", html);
        Assert.DoesNotContain("http-equiv=\"refresh\"", html);
    }
}
