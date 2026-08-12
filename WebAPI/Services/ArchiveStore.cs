using System.IO.Compression;
using System.Text.Json;
using FunGame.Core.Api;
using FunGame.Core.Model.Framework;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>
/// 回合存档仓库：懒加载 rounds_archive.zip，按文件时间戳变化自动重新加载。
/// 模拟程序每跑完一局都会覆盖 zip，因此每次请求都会比对 LastWriteTimeUtc。
/// </summary>
public class ArchiveStore(ILogger<ArchiveStore> logger, IConfiguration configuration, IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim _lock = new(1, 1);
    private Dictionary<int, RoundRecord>? _rounds;
    private DateTime _lastWriteTimeUtc = DateTime.MinValue;

    /// <summary>
    /// 存档 ZIP 路径：优先配置 Archive:ZipPath；其次发布目录内（Ubuntu 部署，zip 随发布产物复制）；
    /// 最后回退到开发目录（仓库根目录 rounds_archive.zip）
    /// </summary>
    public string ZipPath
    {
        get
        {
            string? configured = configuration["Archive:ZipPath"];
            if (!string.IsNullOrEmpty(configured))
            {
                return Path.GetFullPath(configured);
            }
            string inContent = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "rounds_archive.zip"));
            if (File.Exists(inContent))
            {
                return inContent;
            }
            return Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "rounds_archive.zip"));
        }
    }

    /// <summary>存档文件最后修改时间（本地时间，供前端展示）</summary>
    public DateTime LastWriteTime { get; private set; }

    public async Task<Dictionary<int, RoundRecord>> GetRoundsAsync(CancellationToken cancellationToken = default)
    {
        string zipPath = ZipPath;
        if (!File.Exists(zipPath))
        {
            throw new FileNotFoundException($"存档文件不存在: {zipPath}");
        }

        FileInfo fileInfo = new(zipPath);
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_rounds is null || fileInfo.LastWriteTimeUtc != _lastWriteTimeUtc)
            {
                _rounds = ReadFromZip(fileInfo.FullName);
                _lastWriteTimeUtc = fileInfo.LastWriteTimeUtc;
                LastWriteTime = fileInfo.LastWriteTime;
                logger.LogInformation("已加载存档：{Count} 个回合（{File}）", _rounds.Count, fileInfo.Name);
            }
            return _rounds;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>强制重新加载存档（模拟跑完一局后手动刷新）</summary>
    public async Task<Dictionary<int, RoundRecord>> ReloadAsync(CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            _rounds = null;
            _lastWriteTimeUtc = DateTime.MinValue;
        }
        finally
        {
            _lock.Release();
        }
        return await GetRoundsAsync(cancellationToken);
    }

    /// <summary>
    /// 从 ZIP 中读取并解压 JSON 数据，反序列化为回合记录字典（与 FunGameSimulation.ReadRoundsFromZip 相同逻辑）
    /// </summary>
    private static Dictionary<int, RoundRecord> ReadFromZip(string zipFilePath)
    {
        using FileStream zipFileStream = new(zipFilePath, FileMode.Open, FileAccess.Read);
        using ZipArchive zipArchive = new(zipFileStream, ZipArchiveMode.Read);
        ZipArchiveEntry? jsonEntry = zipArchive.GetEntry("rounds_data.json")
            ?? throw new InvalidDataException("ZIP 档案中找不到 'rounds_data.json' 条目");
        using Stream entryStream = jsonEntry.Open();
        return JsonSerializer.Deserialize<Dictionary<int, RoundRecord>>(entryStream, JsonTool.JsonSerializerOptions)
            ?? throw new InvalidDataException("存档反序列化结果为空");
    }
}
