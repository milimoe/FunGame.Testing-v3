using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>单例注册表：当前仅维护一局单人游戏（后续联机可扩展为多会话字典）</summary>
public sealed class SoloGameRegistry
{
    private readonly object _lock = new();
    private SoloGameSession? _current;

    public SoloGameSession? Current
    {
        get { lock (_lock) return _current; }
    }

    public SoloGameSession Create(SoloGameOptions options)
    {
        lock (_lock)
        {
            _current?.Stop();
            _current?.Dispose();
            SoloGameSession session = new();
            _current = session;
            return session;
        }
    }

    public void Stop()
    {
        lock (_lock)
        {
            _current?.Stop();
        }
    }

    public void Clear(SoloGameSession session)
    {
        lock (_lock)
        {
            if (ReferenceEquals(_current, session))
            {
                _current.Dispose();
                _current = null;
            }
        }
    }
}

/// <summary>
/// WebSocket 事件出口实现。联机模式下替换为 Server-v3 的会话广播即可，
/// 上层 <see cref="SoloGameSession"/> 无需改动。
/// </summary>
public sealed class SoloWebSocketSink : IGameEventSink
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private readonly WebSocket _socket;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private int _seq;

    public SoloWebSocketSink(WebSocket socket) => _socket = socket;

    public bool IsOpen => _socket.State == WebSocketState.Open;

    public async Task SendAsync(string type, object data, CancellationToken ct)
    {
        if (!IsOpen) return;
        SoloEnvelope envelope = SoloEnvelope.Ok(type, Interlocked.Increment(ref _seq), data);
        byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(envelope, JsonOptions));
        await _gate.WaitAsync(ct);
        try
        {
            await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task SendErrorAsync(string type, string code, string message, CancellationToken ct)
    {
        if (!IsOpen) return Task.CompletedTask;
        SoloEnvelope envelope = SoloEnvelope.Fail(type, Interlocked.Increment(ref _seq), code, message);
        byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(envelope, JsonOptions));
        return _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }
}
