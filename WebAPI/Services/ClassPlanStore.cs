using System.Text.Json;
using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Model;
using FunGame.Core.Model.Framework;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>
/// 职业计划存档仓库：按角色 Guid 把 <see cref="ClassPlanSnapshot"/> 落盘为 JSON
/// <para>只存 IdName 与状态，读档时经 <see cref="ClassDefinitionRegistry"/> 重建</para>
/// </summary>
public class ClassPlanStore(ILogger<ClassPlanStore> logger, IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim _lock = new(1, 1);

    /// <summary>存档目录（内容根下 classplans/）</summary>
    public string StoreDirectory => Path.Combine(environment.ContentRootPath, "classplans");

    /// <summary>取某角色的存档路径</summary>
    public string GetPath(Guid characterGuid) => Path.Combine(StoreDirectory, $"{characterGuid:N}.json");

    /// <summary>存档是否存在</summary>
    public bool Exists(Guid characterGuid) => File.Exists(GetPath(characterGuid));

    /// <summary>写入存档（覆盖）</summary>
    public async Task SaveAsync(Guid characterGuid, ClassPlanSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(StoreDirectory);
            string json = JsonSerializer.Serialize(snapshot, JsonTool.JsonSerializerOptions);
            await File.WriteAllTextAsync(GetPath(characterGuid), json, cancellationToken);
            logger.LogInformation("已保存职业计划：{Guid}", characterGuid);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>读取存档；不存在返回 null</summary>
    public async Task<ClassPlanSnapshot?> LoadAsync(Guid characterGuid, CancellationToken cancellationToken = default)
    {
        string path = GetPath(characterGuid);
        if (!File.Exists(path))
        {
            return null;
        }
        await _lock.WaitAsync(cancellationToken);
        try
        {
            string json = await File.ReadAllTextAsync(path, cancellationToken);
            return JsonSerializer.Deserialize<ClassPlanSnapshot>(json, JsonTool.JsonSerializerOptions);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "职业计划存档解析失败：{Path}", path);
            return null;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>删除存档</summary>
    public async Task<bool> DeleteAsync(Guid characterGuid, CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            string path = GetPath(characterGuid);
            if (!File.Exists(path))
            {
                return false;
            }
            File.Delete(path);
            logger.LogInformation("已删除职业计划：{Guid}", characterGuid);
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }
}

/// <summary>
/// 职业规划会话：内存中的玩家角色 + 规划器（REST 端点以 sessionId 串联多次操作）
/// </summary>
public class ClassPlanSession
{
    /// <summary>会话 Id</summary>
    public string Id { get; } = Guid.NewGuid().ToString("N");

    /// <summary>玩家角色（由模板 Copy 而来）</summary>
    public Character Character { get; }

    /// <summary>职业规划器</summary>
    public ClassPlanner Planner { get; }

    /// <summary>存档键（角色 Guid）</summary>
    public Guid StoreGuid { get; }

    /// <summary>会话创建时间</summary>
    public DateTime CreatedAt { get; } = DateTime.Now;

    public ClassPlanSession(Character character, ClassPlanner planner, Guid storeGuid)
    {
        Character = character;
        Planner = planner;
        StoreGuid = storeGuid;
    }
}

/// <summary>
/// 职业规划会话仓库（内存；进程重启后由存档恢复）
/// </summary>
public class ClassPlanSessionStore
{
    private readonly Dictionary<string, ClassPlanSession> _sessions = [];
    private readonly Lock _lock = new();

    /// <summary>创建会话</summary>
    public ClassPlanSession Create(Character character, Guid storeGuid, bool selectionEnabled = true)
    {
        ClassPlanner planner = new(character) { SkillSelectionEnabled = selectionEnabled };
        ClassPlanSession session = new(character, planner, storeGuid);
        using (_lock.EnterScope())
        {
            _sessions[session.Id] = session;
        }
        return session;
    }

    /// <summary>取会话</summary>
    public ClassPlanSession? Get(string sessionId)
    {
        using (_lock.EnterScope())
        {
            return _sessions.GetValueOrDefault(sessionId);
        }
    }

    /// <summary>移除会话</summary>
    public bool Remove(string sessionId)
    {
        using (_lock.EnterScope())
        {
            return _sessions.Remove(sessionId);
        }
    }

    /// <summary>活动会话数</summary>
    public int Count
    {
        get
        {
            using (_lock.EnterScope())
            {
                return _sessions.Count;
            }
        }
    }
}
