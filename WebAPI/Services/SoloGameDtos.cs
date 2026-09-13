using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model.Framework;
using FunGame.Core.Model.Queue;

namespace FunGame.Testing.WebAPI.Services;

// ==================== 快照 DTO（输出时由 ASP.NET Core 自动转 camelCase） ====================

/// <summary>地图格子</summary>
public sealed record GridDto(long Id, int X, int Y, int Z, string Color, List<string> Characters);

/// <summary>地图</summary>
public sealed record MapDto(string Name, int Length, int Width, int Height, float Size, List<GridDto> Grids);

/// <summary>技能</summary>
public sealed record SkillDto(
    string Guid, long Id, string Name, string Description, int Level, string SkillType,
    bool IsSuperSkill, bool IsMagic, bool IsActive, bool Enable, bool IsInEffect,
    double CurrentCD, double RealCD, double RealMPCost, double RealEPCost,
    bool CanSelectEnemy, bool CanSelectTeammate, bool CanSelectSelf,
    // CastRange：施法距离（格）。CastAnywhere 为真时该值代表「全图」，UI 应显示「全图」
    int CastRange,
    // CastAnywhere：是否全图施法（此时 CastRange 不代表真实距离）
    bool CastAnywhere,
    bool Usable, string UnusableReason);

/// <summary>物品</summary>
public sealed record ItemDto(
    string Guid, long Id, string Name, string Description, string ItemType,
    bool IsActive, bool Enable, bool IsInGameItem, int RemainUseTimes,
    // CastRange：物品主动效果的施法距离（格），无主动效果时为 0
    int CastRange, bool CastAnywhere,
    bool Usable, string UnusableReason);

/// <summary>装备栏中的一件装备</summary>
public sealed record EquipmentDto(
    // 槽位键：MagicCardPack / Weapon / Armor / Shoes / Accessory1 / Accessory2
    string Slot,
    // 槽位中文名
    string SlotLabel,
    string Guid, long Id, string Name, string Description, string ItemType,
    int WeaponType, string WeaponTypeName);

/// <summary>状态效果（可点击查看描述）</summary>
public sealed record EffectDto(
    string Name,
    string Description,
    string EffectType,
    bool IsDebuff,
    bool IsDurative,
    double RemainDuration,
    int RemainDurationTurn,
    bool IsInEffect);

/// <summary>角色</summary>
public sealed record CharacterDto(
    string Guid, long Id, string Name, string FirstName, string NickName, string DisplayName,
    int Level, double HP, double MaxHP, double MP, double MaxMP, double EP, double MaxEP,
    int MOV, int ATR, string State, bool IsPlayer, bool IsAI, bool IsEliminated, long GridId,
    // TeamName：所属队伍名（团队模式；混战为 null）
    string? TeamName,
    List<SkillDto> Skills, List<ItemDto> Items, List<EffectDto> Effects,
    // Attributes：全部属性（等级/经验/攻防/力量敏捷智力/暴击闪避/回复/穿透/移动距离/攻击距离…）
    Dictionary<string, string> Attributes,
    // Equipments：装备栏（只含已装备的槽位）
    List<EquipmentDto> Equipments);

/// <summary>行动顺序表条目</summary>
public sealed record QueueEntryDto(string Guid, string DisplayName, double HardnessTime, int Order, bool IsPlayer, string? TeamName);

/// <summary>
/// 单个行动类型的配额。
/// <para><b>注意</b>：这里的 <see cref="Quota"/> 来自 <c>DecisionPoints[type]</c>，
/// <see cref="Used"/> 来自 <c>DecisionPoints.ActionTypes[type]</c>（本回合已用次数），
/// 二者之差 <see cref="Remaining"/> 才是玩家真正还能做几次。
/// 旧版把 ActionTypes 误当成“消耗”下发，导致客户端无法判断剩余配额。</para>
/// </summary>
public sealed record ActionQuotaDto(
    string ActionType,
    string Label,
    int Quota,
    int Used,
    int Remaining,
    int DecisionPointCost,
    // Available：Remaining > 0 且决策点足够时才算可用
    bool Available);

/// <summary>决策点</summary>
public sealed record DecisionPointsDto(
    int Current, int Max, int Cost, int ActionsTaken, int Recovery,
    // ActionUsed：本回合各行动类型已用次数（键为 CharacterActionType 名称）
    Dictionary<string, int> ActionUsed,
    // Quotas：各行动类型的配额 / 剩余（含普攻、战技、爆发技、物品）
    List<ActionQuotaDto> Quotas);

/// <summary>团队（团队模式）</summary>
public sealed record TeamDto(
    string Name,
    int Score,
    int Alive,
    int Size,
    bool IsPlayerTeam,
    List<string> Members);

/// <summary>对局状态快照</summary>
public sealed record GameStateDto(
    string GameId, string Mode, int Round, double TotalTime, bool Running, bool GameOver,
    MapDto? Map, List<CharacterDto> Characters, List<QueueEntryDto> Queue,
    DecisionPointsDto? PlayerDP, string? PlayerGuid, string? CurrentActorGuid,
    Dictionary<string, List<string>> RoundRewards, bool AiEscalated = false,
    // Teams：团队模式下的红蓝两队（己方固定命名为「蓝队」）
    List<TeamDto>? Teams = null,
    // TeamMode：是否团队模式
    bool TeamMode = false,
    // MaxScoreToWin：死亡竞赛夺冠人头数（0 表示非死亡竞赛）
    int MaxScoreToWin = 0,
    // Paused：对局是否已暂停（暂停期间引擎线程不推进）
    bool Paused = false);

/// <summary>赛后结算条目</summary>
public sealed record RankingDto(
    int Rank, string Guid, string DisplayName, bool IsPlayer, bool IsWinner,
    double Rating, int Kills, int Deaths, int Assists,
    double TotalDamage, double TotalHeal, double TotalShield,
    int LiveRound, int ActionTurn, double LiveTime, string TeamName);

/// <summary>队员（团队版结算）</summary>
public sealed record TeamRankingDto(
    int Rank, string TeamName, int Score, bool IsWinner, bool IsPlayerTeam,
    int Kills, int Deaths, int Assists, List<RankingDto> Members);

/// <summary>角色选择候选项</summary>
public sealed record CharacterOptionDto(string Guid, long Id, string Name, string FirstName, string NickName, string DisplayName, string Info);

// ==================== 实体 → DTO 映射 ====================

public static class SoloGameMapper
{
    public static GridDto ToGrid(Grid g) =>
        new(g.Id, g.X, g.Y, g.Z, g.Color.Name, [.. g.Characters.Select(c => c.Guid.ToString())]);

    public static MapDto? ToMap(GameMap? map)
    {
        if (map is null) return null;
        return new MapDto(map.Name, map.Length, map.Width, map.Height, map.Size,
            [.. map.Grids.Values.OrderBy(g => g.Id).Select(ToGrid)]);
    }

    /// <summary>技能可用性判定（移植自 WPF 的 SkillUsabilityConverter）</summary>
    public static (bool Usable, string Reason) SkillUsability(Skill s, Character owner)
    {
        if (s.Level <= 0) return (false, "未学习");
        if (s.SkillType == SkillType.Passive) return (false, "被动技能");
        if (!s.Enable) return (false, "已禁用");
        if (s.IsInEffect) return (false, "生效中");
        if (s.CurrentCD > 0) return (false, $"冷却剩余 {s.CurrentCD:0.##} 秒");

        bool isEpSkill = s.SkillType is SkillType.SuperSkill or SkillType.Skill;
        bool isMpSkill = s.SkillType == SkillType.Magic;

        if (isEpSkill && s.RealEPCost > owner.EP) return (false, $"能量不足，需 {s.RealEPCost:0.##} 点");
        if (isMpSkill && s.RealMPCost > owner.MP) return (false, $"魔法不足，需 {s.RealMPCost:0.##} 点");
        if (!isEpSkill && !isMpSkill)
        {
            if (s.RealEPCost > owner.EP && s.RealMPCost > owner.MP) return (false, $"能量/魔法不足");
        }
        return (true, "");
    }

    public static SkillDto ToSkill(Skill s, Character owner)
    {
        (bool usable, string reason) = SkillUsability(s, owner);
        return new SkillDto(
            s.Guid.ToString(), s.Id, s.Name, s.Description ?? "", s.Level, s.SkillType.ToString(),
            s.IsSuperSkill, s.IsMagic, s.IsActive, s.Enable, s.IsInEffect,
            s.CurrentCD, s.RealCD, s.RealMPCost, s.RealEPCost,
            s.CanSelectEnemy, s.CanSelectTeammate, s.CanSelectSelf,
            s.CastRange, s.CastAnywhere,
            usable, reason);
    }

    public static (bool Usable, string Reason) ItemUsability(Item i, Character owner)
    {
        if (!i.IsActive || i.Skills.Active is null) return (false, "无主动效果");
        if (!i.Enable || !i.IsInGameItem) return (false, "不可用");
        Skill active = i.Skills.Active;
        if (!active.Enable) return (false, "已禁用");
        if (active.IsInEffect) return (false, "生效中");
        if (active.CurrentCD > 0) return (false, $"冷却剩余 {active.CurrentCD:0.##} 秒");
        if (active.RealMPCost > owner.MP) return (false, $"魔法不足，需 {active.RealMPCost:0.##} 点");
        if (active.RealEPCost > owner.EP) return (false, $"能量不足，需 {active.RealEPCost:0.##} 点");
        return (true, "");
    }

    public static ItemDto ToItem(Item i, Character owner)
    {
        (bool usable, string reason) = ItemUsability(i, owner);
        Skill? active = i.Skills.Active;
        return new ItemDto(
            i.Guid.ToString(), i.Id, i.Name, i.Description ?? "", i.ItemType.ToString(),
            i.IsActive, i.Enable, i.IsInGameItem, i.RemainUseTimes,
            active?.CastRange ?? 0, active?.CastAnywhere ?? false,
            usable, reason);
    }

    // ---- 装备槽位 ----
    private static readonly (string Slot, string Label)[] EquipSlots =
    [
        ("Weapon", "武器"),
        ("Armor", "防具"),
        ("Shoes", "鞋子"),
        ("MagicCardPack", "魔法卡包"),
        ("Accessory1", "饰品一"),
        ("Accessory2", "饰品二"),
    ];

    private static Item? SlotItem(EquipSlot slots, string slot) => slot switch
    {
        "Weapon" => slots.Weapon,
        "Armor" => slots.Armor,
        "Shoes" => slots.Shoes,
        "MagicCardPack" => slots.MagicCardPack,
        "Accessory1" => slots.Accessory1,
        "Accessory2" => slots.Accessory2,
        _ => null,
    };

    public static List<EquipmentDto> ToEquipments(Character c)
    {
        List<EquipmentDto> list = [];
        EquipSlot slots = c.EquipSlot;
        foreach ((string slot, string label) in EquipSlots)
        {
            Item? item = SlotItem(slots, slot);
            if (item is null) continue;
            list.Add(new EquipmentDto(
                slot, label, item.Guid.ToString(), item.Id, item.Name, item.Description ?? "",
                item.ItemType.ToString(),
                item.WeaponType == WeaponType.None ? 0 : (int)item.WeaponType,
                item.WeaponType == WeaponType.None ? "" : item.WeaponType.ToString()));
        }
        return list;
    }

    /// <summary>
    /// 状态效果：只取真正生效中的，按「是否减益 → 名称」排序，保证快照稳定。
    /// 名称 / 描述来自 <see cref="Effect"/>，供 UI 点击查看。
    /// </summary>
    public static List<EffectDto> ToEffects(Character c)
    {
        return [.. c.Effects
            .Where(e => e.IsInEffect && e.ShowInStatusBar)
            .OrderBy(e => e.IsDebuff)
            .ThenBy(e => e.Name)
            .Select(e => new EffectDto(
                e.Name,
                e.Description ?? "",
                e.EffectType.ToString(),
                e.IsDebuff,
                e.Durative,
                e.RemainDuration,
                e.RemainDurationTurn,
                e.IsInEffect))];
    }

    public static CharacterDto ToCharacter(
        Character c, GameMap? map, string? playerGuid, GamingQueue? queue,
        ICollection<Character>? eliminated = null, string? teamName = null)
    {
        Grid? grid = map?.GetCharacterCurrentGrid(c);
        bool isAI = queue?.IsCharacterInAIControlling(c) ?? false;
        // v3 的 Skills / Items / Effects 均为 HashSet，需显式排序保证快照稳定
        List<SkillDto> skills = [.. c.Skills
            .Where(s => s.SkillType != SkillType.Passive)
            .OrderBy(s => s.SkillType.ToString()).ThenBy(s => s.Name)
            .Select(s => ToSkill(s, c))];
        List<ItemDto> items = [.. c.Items
            .Where(i => i.IsActive)
            .OrderBy(i => i.Name)
            .Select(i => ToItem(i, c))];
        List<EffectDto> effects = ToEffects(c);

        return new CharacterDto(
            c.Guid.ToString(), c.Id, c.Name, c.FirstName, c.NickName, c.ToStringWithLevel(),
            c.Level, c.HP, c.MaxHP, c.MP, c.MaxMP, c.EP,
            General.GameplayEquilibriumConstant.MaxEP,
            c.MOV, c.ATR, c.CharacterState.ToString(),
            c.Guid.ToString() == playerGuid, isAI,
            eliminated?.Contains(c) ?? false,
            grid?.Id ?? -1,
            teamName,
            skills, items, effects,
            c.GetAttributeValues(),
            ToEquipments(c));
    }

    public static DecisionPointsDto? ToDP(DecisionPoints? dp)
    {
        if (dp is null) return null;
        Dictionary<string, int> used = [];
        foreach (KeyValuePair<CharacterActionType, int> kv in dp.ActionTypes)
        {
            used[kv.Key.ToString()] = kv.Value;
        }

        // 与引擎的实际记账保持一致（见 GamingQueue 的 PreCastSkill 分支）：
        //   普通攻击     → ActionTypes[NormalAttack]，配额 dp[NormalAttack]
        //   战技         → ActionTypes[CastSkill]，配额 dp[CastSkill]
        //   魔法         → ActionTypes[PreCastSkill]，配额 dp[PreCastSkill]（魔法不校验配额，但决策点要够）
        //   爆发技       → ActionTypes[CastSuperSkill]，配额 dp[CastSuperSkill]
        //   物品         → ActionTypes[UseItem]，配额 dp[UseItem]
        var eq = dp.GameplayEquilibriumConstant;
        List<ActionQuotaDto> quotas =
        [
            Quota(dp, used, CharacterActionType.NormalAttack, "普通攻击", eq.DecisionPointsCostNormalAttack),
            Quota(dp, used, CharacterActionType.CastSkill, "战技", eq.DecisionPointsCostSkill),
            Quota(dp, used, CharacterActionType.PreCastSkill, "魔法", eq.DecisionPointsCostMagic),
            Quota(dp, used, CharacterActionType.CastSuperSkill, "爆发技", eq.DecisionPointsCostSuperSkill),
            Quota(dp, used, CharacterActionType.UseItem, "物品", eq.DecisionPointsCostItem),
        ];

        return new DecisionPointsDto(
            dp.CurrentDecisionPoints, dp.MaxDecisionPoints, dp.DecisionPointsCost,
            dp.ActionsTaken, dp.RecoverDecisionPointsPerRound, used, quotas);
    }

    private static ActionQuotaDto Quota(
        DecisionPoints dp, Dictionary<string, int> used, CharacterActionType type, string label, int cost)
    {
        int quota = dp[type];
        int usedCount = used.GetValueOrDefault(type.ToString());
        int remaining = Math.Max(0, quota - usedCount);
        return new ActionQuotaDto(
            type.ToString(), label, quota, usedCount, remaining, cost,
            remaining > 0 && dp.CurrentDecisionPoints >= cost);
    }

    public static CharacterOptionDto ToOption(Character c) =>
        new(c.Guid.ToString(), c.Id, c.Name, c.FirstName, c.NickName, c.ToStringWithLevel(), c.GetInfo(false, false));
}
