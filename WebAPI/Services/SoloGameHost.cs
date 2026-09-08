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

    /// <summary>
    /// 单次发送的最长时间。对端不读取（浏览器切后台被节流、连接半开等）时
    /// WebSocket.SendAsync 会永久挂起，进而卡死游戏线程，因此必须设上限。
    /// </summary>
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(5);

    private readonly WebSocket _socket;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private int _seq;
    private volatile bool _broken;

    public SoloWebSocketSink(WebSocket socket) => _socket = socket;

    public bool IsOpen => !_broken && _socket.State == WebSocketState.Open;

    public async Task SendAsync(string type, object data, CancellationToken ct)
    {
        if (!IsOpen) return;
        SoloEnvelope envelope = SoloEnvelope.Ok(type, Interlocked.Increment(ref _seq), data);
        byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(envelope, JsonOptions));

        // 闸门等待也要设上限：一旦某次发送挂住，不能让后续所有发送无限排队
        if (!await _gate.WaitAsync(SendTimeout, ct).ConfigureAwait(false))
        {
            MarkBroken();
            return;
        }
        try
        {
            Task send = _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
            Task finished = await Task.WhenAny(send, Task.Delay(SendTimeout, ct)).ConfigureAwait(false);
            if (finished != send)
            {
                // 发送超时：判定连接不可用并中断，避免游戏线程被永久拖住
                MarkBroken();
                return;
            }
            await send.ConfigureAwait(false);
        }
        catch
        {
            MarkBroken();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>标记连接不可用并中断底层连接（触发对局侧的 AI 托管接管）</summary>
    private void MarkBroken()
    {
        if (_broken) return;
        _broken = true;
        try
        {
            _socket.Abort();
        }
        catch
        {
            /* 忽略 */
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
