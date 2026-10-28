using System.Net;
namespace PandaAuth.Admin;

/// <summary>Script-free branded authentication status document; all variable text is encoded.</summary>
public static class AdminAuthPage
{
    public static string Render(string title, IEnumerable<string> messages, bool returnToConsole)
    {
        var paragraphs = string.Concat(messages.Select(message => "<p>" + WebUtility.HtmlEncode(message) + "</p>"));
        var href = returnToConsole ? "/admin/" : "/admin/login";
        var action = returnToConsole ? "返回管理台" : "继续登录";
        return $$"""
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>{{WebUtility.HtmlEncode(title)}} · PandaAuth</title>
<style>
:root{color-scheme:light;font-family:system-ui,sans-serif;background:#f7f8fa;color:#20262e}
*{box-sizing:border-box}body{margin:0;padding:clamp(1rem,5vw,4rem)}main{max-width:32rem;margin:5vh auto;background:white;border:1px solid #dce1e6;border-radius:1rem;padding:clamp(1.25rem,5vw,2.5rem);overflow-wrap:anywhere}
img{display:block;width:15rem;max-width:100%;height:auto;margin-bottom:2rem}h1{font-size:1.5rem;line-height:1.35}p{line-height:1.7}a{display:inline-block;margin-top:1rem;padding:.75rem 1rem;color:inherit;border:1px solid currentColor;border-radius:.5rem;text-underline-offset:.2em}a:focus-visible{outline:3px solid Highlight;outline-offset:4px}
</style></head><body><main aria-labelledby="status-title"><img src="/admin/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs"><h1 id="status-title">{{WebUtility.HtmlEncode(title)}}</h1>
{{paragraphs}}<a href="{{href}}">{{action}}</a></main></body></html>
""";
    }
}
