using FunGame.Core.Entity;
using Milimoe.FunGameTesting.OshimaGameModules;
using Milimoe.FunGameTesting.OshimaGameModules.Characters;
using Milimoe.FunGameTesting.Tests;

CharacterModule characterModule = new();
characterModule.Load();
SkillModule skillModule = new();
skillModule.Load();
ItemModule itemModule = new();
itemModule.Load();
FunGameService.InitFunGame();

// 起始等级：默认与旧版硬编码一致（角色 10 / 技能 2 / 普攻 2）。
// 平衡测试可经环境变量直接拉满到标尺口径（角色 60 / 技能 6 / 普攻 8）：
//   OSHIMA_CHAR_LEVEL=60 OSHIMA_SKILL_LEVEL=6 OSHIMA_NA_LEVEL=8
// 不设或设为非正数时回落到默认值。
// 周期空投：OSHIMA_PERIODIC_DROP=0 关闭局内周期空投（只保留开局一次），得到「定态」环境。
static int EnvInt(string key, int fallback)
{
    string? raw = Environment.GetEnvironmentVariable(key);
    return int.TryParse(raw, out int v) && v > 0 ? v : fallback;
}
int clevel = EnvInt("OSHIMA_CHAR_LEVEL", 10);
int slevel = EnvInt("OSHIMA_SKILL_LEVEL", 2);
int nlevel = EnvInt("OSHIMA_NA_LEVEL", 2);
bool periodicDrop = Environment.GetEnvironmentVariable("OSHIMA_PERIODIC_DROP") != "0";
long fixedWeapon = EnvInt("OSHIMA_FIXED_WEAPON", 0);
Console.WriteLine($"[StartLevels] 角色 {clevel} / 技能 {slevel} / 普攻 {nlevel}"
    + (clevel >= 60 ? "（已拉满，实测口径对齐判定基准标尺）" : "（局内会由空投逐步提升）")
    + $" | 周期空投 {(periodicDrop ? "开（实战态：装备/技能池持续变化）" : "关（定态：仅开局一次）")}"
    + $" | 固定武器 {(fixedWeapon != 0 ? fixedWeapon.ToString() : "无（随机）")}");

// 示例角色
Character a = new XinYin(); // 敏捷
Character b = new ColdBlue(); // 力量
Character c = new QingXiang(); // 智力
a.Level = 60;
b.Level = 60;
c.Level = 60;
a.NormalAttack.Level = 8;
b.NormalAttack.Level = 8;
c.NormalAttack.Level = 8;
Console.WriteLine("基准设计只考虑原始值");
Console.WriteLine("==============================================");
Console.WriteLine("爆发技和被动将用敏捷角色参考\r\n" + a.GetInfo());
Console.WriteLine("战技用力量角色参考\r\n" + b.GetInfo());
Console.WriteLine("魔法用智力角色参考\r\n" + c.GetInfo());
// 爆发技用敏捷角色参考
foreach (Skill s in FunGameService.SuperSkills.Union(FunGameService.CommonSuperSkills))
{
    s.Level = 6;
    s.AddSkillToCharacter(a);
    Console.WriteLine(s.GetInfo());
}
// 战技用力量角色参考
foreach (Skill s in FunGameService.Skills)
{
    s.Level = 6;
    s.AddSkillToCharacter(b);
    Console.WriteLine(s.GetInfo());
}
// 被动用敏捷角色参考
foreach (Skill s in FunGameService.PassiveSkills.Union(FunGameService.CommonPassiveSkills))
{
    s.Level = 1;
    s.AddSkillToCharacter(a);
    Console.WriteLine(s.GetInfo());
}
// 魔法用智力角色参考
foreach (Skill s in FunGameService.Magics)
{
    s.Level = 8;
    s.AddSkillToCharacter(c);
    Console.WriteLine(s.GetInfo());
}
Console.WriteLine("==============================================");

while (true)
{
    int seed = 0;
    Console.WriteLine("Input a seed to start a simulation (empty for random) or 'quit' to exit:");
    string input = await Console.In.ReadLineAsync() ?? "";
    if (input == "quit")
    {
        break;
    }
    if (input != "" && !int.TryParse(input, out seed))
    {
        Console.WriteLine("Invalid seed.");
        continue;
    }

    try
    {
        FunGameSimulation.IsDebug = true;
        FunGameSimulation.SeedOverride = seed;

        DateTime start = DateTime.Now;

        await Task.Run(async () => await FunGameSimulation.StartSimulationGame(new SimulationOptions
        {
            PrintOut = true,
            IsWeb = true,
            IsTeam = true,
            BindToCharacter = true,
            CharacterLevel = clevel,
            SkillLevel = slevel,
            NormalAttackLevel = nlevel,
            EnablePeriodicDrop = periodicDrop,
            FixedWeaponId = fixedWeapon
        }));
        double elapsed = (DateTime.Now - start).TotalSeconds;

        Console.WriteLine($"Seed: {seed}; Total Cost: {elapsed} seconds");
    }
    catch (Exception e)
    {
        Console.WriteLine(e);
    }
}
