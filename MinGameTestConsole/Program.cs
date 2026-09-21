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

        await Task.Run(async () => await FunGameSimulation.StartSimulationGame(new SimulationOptions { PrintOut = true, IsWeb = true, IsTeam = true, BindToCharacter = true }));
        double elapsed = (DateTime.Now - start).TotalSeconds;

        Console.WriteLine($"Seed: {seed}; Total Cost: {elapsed} seconds");
    }
    catch (Exception e)
    {
        Console.WriteLine(e);
    }
}
