using System.Net;
using Microsoft.AspNetCore.WebUtilities;

namespace PandaAuth.WebAdmin.Tests;

/// <summary>
/// 记录真实发出的 HTTP 请求的桩处理器（随四件套自 panda-auth-me 移植）。
/// </summary>
/// <remarks>
/// 断言对象是**请求本身**（URL / 方法 / 表单字段 / 认证头），而不是 mock 的调用次数：
/// 调用次数为 1 也可能是发错了地址、带错了令牌提示或漏了认证头。
/// </remarks>
internal sealed class StubHttpMessageHandler(HttpStatusCode statusCode = HttpStatusCode.OK) : HttpMessageHandler
{
    public List<RecordedRequest> Requests { get; } = [];

    /// <summary>非空时 SendAsync 抛出该异常，用于模拟网络不可达 / 超时。</summary>
    public Exception? ThrowOnSend { get; init; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // 请求内容在 SendAsync 返回后即被释放，故必须在此处读出。
        var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add(new RecordedRequest(
            request.Method,
            request.RequestUri!,
            request.Headers.Authorization?.ToString(),
            request.Content?.Headers.ContentType?.MediaType,
            body));

        if (ThrowOnSend is not null)
        {
            throw ThrowOnSend;
        }

        return new HttpResponseMessage(statusCode) { Content = new StringContent("""{"ok":true}""") };
    }

    internal sealed record RecordedRequest(HttpMethod Method, Uri Uri, string? Authorization, string? ContentType, string Body)
    {
        /// <summary>表单字段（application/x-www-form-urlencoded），按真实表单编码解析。</summary>
        public Dictionary<string, string> Form =>
            QueryHelpers.ParseQuery(Body).ToDictionary(pair => pair.Key, pair => pair.Value.ToString());
    }
}
