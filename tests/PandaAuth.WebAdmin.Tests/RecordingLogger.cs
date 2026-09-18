using Microsoft.Extensions.Logging;

namespace PandaAuth.WebAdmin.Tests;

/// <summary>
/// 捕获日志条目（级别 / 文本 / 异常）的测试用 <see cref="ILogger{T}"/>（随四件套自 panda-auth-me 移植）。
/// </summary>
/// <remarks>
/// 撤销失败必须「只记 warning、不外抛」，因此日志本身就是要断言的产物之一；
/// 同时它也是泄漏面——测试会断言日志里不出现令牌取值。
/// </remarks>
internal sealed class RecordingLogger<T> : ILogger<T>
{
    public List<LogEntry> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
        => Entries.Add(new LogEntry(logLevel, formatter(state, exception), exception));

    internal sealed record LogEntry(LogLevel Level, string Message, Exception? Exception);
}
