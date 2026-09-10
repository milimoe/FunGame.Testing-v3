using FunGame.Core.Api;
using FunGame.Core.Entity;
using FunGame.Core.Library.Constant;
using FunGame.Core.Model;
using FunGame.Core.Model.Framework;
using Milimoe.FunGameTesting.Tests;

namespace FunGame.Testing.WebAPI.Services;

/// <summary>
/// 职业规划 REST 端点：会话式接口，前端以 sessionId 串联「选职业 → 升级 → 学技能 → 分配属性 → 物化 → 存档」
/// </summary>
public static class ClassPlanEndpoints
{
    /// <summary>
    /// 注册职业规划端点（/api/classplan/*）
    /// </summary>
    public static void MapClassPlanEndpoints(this WebApplication app)
    {
        RouteGroupBuilder group = app.MapGroup("/api/classplan");

        // ============ 可用职业 / 流派定义（含技能池、天赋池、模板限值） ============
        group.MapGet("/definitions", () =>
        {
            List<object> classes = [];
            foreach (string classId in ClassDefinitionRegistry.RegisteredClassIds)
            {
                Class? definition = ClassDefinitionRegistry.CreateClass(classId);
                if (definition is null)
                {
                    continue;
                }
                List<object> subClasses = [];
                foreach (string subId in ClassDefinitionRegistry.RegisteredSubClassIds)
                {
                    // 按注册时的归属筛选：不能靠 sub.Class 判断（流派工厂对任何 owner 都会构造成功）
                    if (ClassDefinitionRegistry.GetOwnerClassIdName(subId) != definition.GetIdName())
                    {
                        continue;
                    }
                    SubClass? sub = ClassDefinitionRegistry.CreateSubClass(subId, definition);
                    if (sub is null)
                    {
                        continue;
                    }
                    subClasses.Add(new
                    {
                        id = sub.GetIdName(),
                        name = sub.Name,
                        roleTypes = sub.RoleTypes.Select(r => r.ToString()).ToArray(),
                        inherentPassiveGates = sub.InherentPassives.Keys.OrderBy(k => k).ToArray(),
                        // 固有被动明细（门槛等级 -> 被动名），供前端按等级展示
                        inherentPassives = sub.InherentPassives.OrderBy(kv => kv.Key)
                            .Select(kv => new { gate = kv.Key, names = kv.Value.Select(s => s.Name).ToArray() })
                            .ToArray()
                    });
                }
                classes.Add(new
                {
                    id = definition.GetIdName(),
                    name = definition.Name,
                    // 结构化限值（前端据此约束 1 级初始分配）；attributeLimitText 仅用于展示
                    attributeLimit = ToLimitDto(definition.AttributeLimit),
                    attributeLimitText = definition.AttributeLimit?.Describe() ?? "无上下限",
                    skills = definition.Skills.Select(ToSkillDto).ToArray(),
                    passives = definition.PassiveSkills.Select(ToSkillDto).ToArray(),
                    magics = definition.Magics.Select(ToSkillDto).ToArray(),
                    superSkills = definition.SuperSkills.Select(ToSkillDto).ToArray(),
                    talents = definition.CombatTalents.ToDictionary(
                        kv => kv.Key.ToString(),
                        kv => kv.Value.Select(ToSkillDto).ToArray()),
                    subClasses
                });
            }
            return Results.Ok(new
            {
                classes,
                rules = new
                {
                    initialBudget = "30 点属性 + 3.0 成长（受职业与角色模板上下限约束）",
                    numericBoostBudget = "9 点属性 + 0.9 成长（可任意分配，不受限）",
                    selectionEnabled = true
                }
            });
        });

        // ============ 创建规划会话（可从存档恢复） ============
        group.MapPost("/sessions", async (CreateClassPlanSessionRequest request, ClassPlanSessionStore sessions, ClassPlanStore store, CancellationToken ct) =>
        {
            Character? template = ResolveTemplate(request);
            if (template is null)
            {
                return Results.NotFound(new { error = "找不到角色模板，请检查 characterId / characterName" });
            }
            Character player = template.Copy();
            Guid storeGuid = request.StoreGuid is { } guid && guid != Guid.Empty ? guid : template.Guid != Guid.Empty ? template.Guid : Guid.NewGuid();
            ClassPlanSession session = sessions.Create(player, storeGuid, request.SkillSelection);
            List<string> warnings = [];
            if (request.Restore)
            {
                ClassPlanSnapshot? snapshot = await store.LoadAsync(storeGuid, ct);
                if (snapshot is null)
                {
                    warnings.Add("未找到职业计划存档，已创建新计划。");
                }
                else
                {
                    warnings.AddRange(snapshot.ApplyTo(session.Planner.Plan, player));
                    // 对账只补发；若存档与等级不一致（水位高于等级）会整体拒绝，这里作为警告暴露给调用方
                    ClassPlanResult syncResult = session.Planner.SyncRewards();
                    if (!syncResult.Success)
                    {
                        warnings.Add(syncResult.Message);
                    }
                    session.Planner.Plan.ApplyTo(player);
                }
            }
            return Results.Ok(BuildSessionDto(session, warnings));
        });

        // ============ 查询会话状态 ============
        group.MapGet("/sessions/{id}", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            return session is null
                ? Results.NotFound(new { error = $"会话不存在：{id}" })
                : Results.Ok(BuildSessionDto(session, []));
        });

        // ============ 选择职业与流派 ============
        group.MapPost("/sessions/{id}/select-class", (string id, SelectClassRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? classDef = ClassDefinitionRegistry.CreateClass(request.ClassId);
            SubClass? subClassDef = classDef is null ? null : ClassDefinitionRegistry.CreateSubClass(request.SubClassId, classDef);
            if (classDef is null || subClassDef is null)
            {
                return Results.BadRequest(new { error = $"未注册的职业或流派：{request.ClassId} / {request.SubClassId}" });
            }
            ClassPlanResult result = session.Planner.SelectClass(classDef, subClassDef);
            return BuildActionResult(session, result);
        });

        // ============ 职业升级 ============
        group.MapPost("/sessions/{id}/upgrade-class", (string id, ClassIdRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            ClassPlanResult result = session.Planner.UpgradeClass(record);
            return BuildActionResult(session, result);
        });

        // ============ 草稿态调级（可升可降，不消耗职业点数） ============
        group.MapPost("/sessions/{id}/set-class-level", (string id, SetClassLevelRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            ClassPlanResult result = session.Planner.SetClassLevel(record, request.Level);
            return BuildActionResult(session, result);
        });

        // ============ 提交（确认）职业等级，此后不可下调 ============
        group.MapPost("/sessions/{id}/commit-class", (string id, ClassIdRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            ClassPlanResult result = session.Planner.CommitClassLevel(record);
            return BuildActionResult(session, result);
        });

        // ============ 学习职业技能 / 被动（消耗选择权） ============
        group.MapPost("/sessions/{id}/learn-skill", (string id, LearnSkillRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            Skill? skill = DefaultClassRewardSettler.AllPoolSkills(record).FirstOrDefault(s => s.Id == request.SkillId);
            if (skill is null)
            {
                return Results.BadRequest(new { error = $"技能不在该职业池中：{request.SkillId}" });
            }
            ClassPlanResult result = session.Planner.LearnClassSkill(record, skill);
            if (result.Success)
            {
                session.Planner.Plan.ApplyTo(session.Character);
            }
            return BuildActionResult(session, result);
        });

        // ============ 分配核心属性（1 级初始分配 / 4 与 9 级数值提升） ============
        group.MapPost("/sessions/{id}/allocate", (string id, AllocateRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Class? record = FindRecord(session, request.ClassId);
            if (record is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该职业记录：{request.ClassId}" });
            }
            ClassAttributeAllocation allocation = new(request.STR, request.AGI, request.INT, request.STRGrowth, request.AGIGrowth, request.INTGrowth);
            ClassPlanResult result = request.Initial
                ? session.Planner.TakeInitialAllocation(record, allocation)
                : session.Planner.TakeNumericBoost(record, allocation);
            return BuildActionResult(session, result);
        });

        // ============ 物化到角色（按已习得挂载） ============
        // ============ 物化到角色（物化即确认职业等级，此后不可下调） ============
        group.MapPost("/sessions/{id}/apply", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            // 物化即确认：先确认全部职业等级（按净增级数扣职业点数），再重挂技能 / 特效 / 天赋
            ClassPlanResult applied = session.Planner.ApplyToCharacter(session.Character);
            bool valid = session.Planner.ValidateState(out string? error);
            return Results.Ok(new
            {
                ok = applied.Success,
                valid,
                error = applied.Success ? error : applied.Message,
                message = applied.Message,
                plan = ClassPlanSnapshot.Capture(session.Planner.Plan)
            });
        });

        // ============ 洗点 ============
        group.MapPost("/sessions/{id}/reset", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            ClassPlanResult result = session.Planner.ResetPlan();
            return BuildActionResult(session, result);
        });

        // ============ 学习战斗天赋（按定位，消耗天赋额度） ============
        group.MapPost("/sessions/{id}/learn-talent", (string id, LearnTalentRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            if (!Enum.TryParse(request.RoleType, out RoleType roleType))
            {
                return Results.BadRequest(new { error = $"无效定位：{request.RoleType}" });
            }
            Skill? talent = FindTalent(session, request.TalentId);
            if (talent is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该战斗天赋：{request.TalentId}" });
            }
            ClassPlanResult result = session.Planner.LearnCombatTalent(roleType, talent);
            return BuildActionResult(session, result);
        });

        // ============ 遗忘战斗天赋（不消耗也不退还资源） ============
        group.MapPost("/sessions/{id}/forget-talent", (string id, TalentIdRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Skill? talent = FindTalent(session, request.TalentId);
            if (talent is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该战斗天赋：{request.TalentId}" });
            }
            ClassPlanResult result = session.Planner.ForgetCombatTalent(talent);
            return BuildActionResult(session, result);
        });

        // ============ 激活战斗天赋（切换主要定位；核心天赋自带全等级 +1） ============
        group.MapPost("/sessions/{id}/activate-talent", (string id, ActivateTalentRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            Skill? talent = FindTalent(session, request.TalentId);
            if (talent is null)
            {
                return Results.BadRequest(new { error = $"计划中没有该战斗天赋：{request.TalentId}" });
            }
            ClassPlanResult result = session.Planner.ActivateCombatTalent(talent);
            return BuildActionResult(session, result);
        });

        // ============ 整体应用快照（兜底通道）：前端本地算完但内核没有对应动作时（撤销职业 / 遗忘技能），
        // 把本地结果导出为 ClassPlanSnapshot 全量提交，避免「前端已撤销、服务端仍保留」的状态撕裂 ============
        group.MapPost("/sessions/{id}/apply-snapshot", (string id, ApplySnapshotRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            if (request.Snapshot is null)
            {
                return Results.BadRequest(new { error = "快照为空。" });
            }
            List<string> errors = request.Snapshot.ApplyTo(session.Planner.Plan, session.Character);
            return Results.Ok(new
            {
                ok = true,
                message = errors.Count == 0 ? "已整体应用职业计划快照。" : "已应用快照，但有部分条目未注册。",
                errors,
                plan = ClassPlanSnapshot.Capture(session.Planner.Plan)
            });
        });

        // ============ 设置角色等级（重算职业点数；会话角色默认取 1 级模板，需手动提升才能推进规划） ============
        group.MapPost("/sessions/{id}/set-character-level", (string id, SetCharacterLevelRequest request, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            int level = Math.Clamp(request.Level, 1, 60);
            session.Character.Level = level;
            // 职业点数按等级档重算（1 / 5 / 10 … 各 1 点）
            session.Character.Class.OnLevelUp();
            return BuildActionResult(session, session.Planner.SyncRewards());
        });

        // ============ 按已选流派重推主要 / 次要定位 ============
        group.MapPost("/sessions/{id}/refresh-roles", (string id, ClassPlanSessionStore sessions) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            ClassPlanResult result = session.Planner.RefreshRoleTypes();
            return BuildActionResult(session, result);
        });

        // ============ 保存 / 删除存档 ============
        group.MapPost("/sessions/{id}/save", async (string id, ClassPlanSessionStore sessions, ClassPlanStore store, CancellationToken ct) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            await store.SaveAsync(session.StoreGuid, ClassPlanSnapshot.Capture(session.Planner.Plan), ct);
            return Results.Ok(new { ok = true, storeGuid = session.StoreGuid, path = store.GetPath(session.StoreGuid) });
        });

        group.MapDelete("/sessions/{id}", async (string id, ClassPlanSessionStore sessions, ClassPlanStore store, CancellationToken ct) =>
        {
            ClassPlanSession? session = sessions.Get(id);
            if (session is null)
            {
                return Results.NotFound(new { error = $"会话不存在：{id}" });
            }
            bool deleted = await store.DeleteAsync(session.StoreGuid, ct);
            sessions.Remove(id);
            return Results.Ok(new { ok = true, archiveDeleted = deleted });
        });
    }

    private static Character? ResolveTemplate(CreateClassPlanSessionRequest request)
    {
        List<Character> templates = [.. FunGameService.Characters];
        if (templates.Count == 0)
        {
            return null;
        }
        if (request.CharacterId is { } id && templates.FirstOrDefault(c => c.Id == id) is { } byId)
        {
            return byId;
        }
        if (!string.IsNullOrWhiteSpace(request.CharacterName) && templates.FirstOrDefault(c => c.Name == request.CharacterName || c.NickName == request.CharacterName) is { } byName)
        {
            return byName;
        }
        return templates[0];
    }

    private static Class? FindRecord(ClassPlanSession session, string classId)
    {
        return session.Planner.Plan.Classes.FirstOrDefault(c => c.GetIdName() == classId);
    }

    /// <summary>
    /// 按 IdName 在计划的职业记录里查找战斗天赋（天赋绑定于职业，遍历全部记录）
    /// </summary>
    private static Skill? FindTalent(ClassPlanSession session, string talentId)
    {
        return session.Planner.Plan.Classes
            .SelectMany(c => c.CombatTalents.Values)
            .SelectMany(list => list)
            .FirstOrDefault(t => t.GetIdName() == talentId);
    }

    /// <summary>
    /// 反查天赋所属定位（激活天赋需要定位参数）
    /// </summary>
    private static RoleType? FindTalentRole(ClassPlanSession session, string talentId)
    {
        foreach (Class c in session.Planner.Plan.Classes)
        {
            foreach (KeyValuePair<RoleType, HashSet<Skill>> kv in c.CombatTalents)
            {
                if (kv.Value.Any(t => t.GetIdName() == talentId))
                {
                    return kv.Key;
                }
            }
        }
        return null;
    }

    private static object ToSkillDto(Skill skill) => new
    {
        id = skill.Id,
        name = skill.Name,
        skillType = skill.SkillType.ToString(),
        level = skill.Level,
        description = skill.Description,
        requiredSubClass = skill.RequiredSubClass?.GetIdName(),
        requiredAttribute = skill.RequiredAttribute?.ToString(),
        requiredAttributeValue = skill.RequiredAttributeValue
    };

    /// <summary>
    /// 把职业模板属性上下限序列化为结构化对象（前端据此约束 1 级初始分配）；null 表示不限
    /// </summary>
    private static object? ToLimitDto(ClassAttributeLimit? limit)
    {
        if (limit is null)
        {
            return null;
        }
        return new
        {
            strMin = limit.STRMin,
            strMax = limit.STRMax,
            agiMin = limit.AGIMin,
            agiMax = limit.AGIMax,
            intMin = limit.INTMin,
            intMax = limit.INTMax,
            strGrowthMin = limit.STRGrowthMin,
            strGrowthMax = limit.STRGrowthMax,
            agiGrowthMin = limit.AGIGrowthMin,
            agiGrowthMax = limit.AGIGrowthMax,
            intGrowthMin = limit.INTGrowthMin,
            intGrowthMax = limit.INTGrowthMax
        };
    }

    private static IResult BuildActionResult(ClassPlanSession session, ClassPlanResult result)
    {
        return result.Success
            ? Results.Ok(new { ok = true, message = result.Message, plan = ClassPlanSnapshot.Capture(session.Planner.Plan) })
            : Results.BadRequest(new { ok = false, message = result.Message });
    }

    private static object BuildSessionDto(ClassPlanSession session, List<string> warnings)
    {
        CharacterClass plan = session.Planner.Plan;
        return new
        {
            sessionId = session.Id,
            storeGuid = session.StoreGuid,
            character = new
            {
                id = session.Character.Id,
                name = session.Character.Name,
                nickName = session.Character.NickName,
                level = session.Character.Level,
                primaryAttribute = session.Character.PrimaryAttribute.ToString(),
                initialSTR = session.Character.InitialSTR,
                initialAGI = session.Character.InitialAGI,
                initialINT = session.Character.InitialINT,
                strGrowth = session.Character.STRGrowth,
                agiGrowth = session.Character.AGIGrowth,
                intGrowth = session.Character.INTGrowth
            },
            plan = ClassPlanSnapshot.Capture(plan),
            skillSelectionEnabled = plan.SkillSelectionEnabled,
            classPoints = plan.ClassPoints,
            warnings
        };
    }
}

/// <summary>创建规划会话请求</summary>
public record CreateClassPlanSessionRequest(long? CharacterId = null, string? CharacterName = null, Guid? StoreGuid = null, bool Restore = false, bool SkillSelection = true);

/// <summary>选择职业与流派请求（均为 IdName）</summary>
public record SelectClassRequest(string ClassId, string SubClassId);

/// <summary>职业 IdName 请求</summary>
public record ClassIdRequest(string ClassId);

/// <summary>草稿态调级请求：可升可降，不消耗职业点数</summary>
public record SetClassLevelRequest(string ClassId, int Level);

/// <summary>学习技能请求</summary>
public record LearnSkillRequest(string ClassId, long SkillId);

/// <summary>核心属性分配请求</summary>
public record AllocateRequest(string ClassId, bool Initial = false, double STR = 0, double AGI = 0, double INT = 0, double STRGrowth = 0, double AGIGrowth = 0, double INTGrowth = 0);

/// <summary>学习战斗天赋：定位 + 天赋 IdName</summary>
public record LearnTalentRequest(string RoleType, string TalentId);

/// <summary>按天赋 IdName 操作（遗忘 / 激活）</summary>
public record TalentIdRequest(string TalentId);

/// <summary>激活战斗天赋：按 IdName 定位后切换主要定位</summary>
public record ActivateTalentRequest(string TalentId);

/// <summary>设置会话角色的等级（1–60），用于重算职业点数</summary>
public record SetCharacterLevelRequest(int Level);

/// <summary>整体应用职业计划快照（前端本地动作的兜底同步通道）</summary>
public record ApplySnapshotRequest(ClassPlanSnapshot? Snapshot);
