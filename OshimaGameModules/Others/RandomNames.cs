using System.Text;

namespace Milimoe.FunGameTesting.Others
{
    /// <summary>
    /// 随机中文名生成工具（从 FunGameService 抽出，供模组自包含使用，避免依赖测试项目）
    /// </summary>
    public static class RandomNames
    {
        private const string Chars =
            "零壹贰叁肆伍陆柒捌玖拾梦影霜月星岚云雨雪风雷电光暗炎冰林森火山水土石金玉瑶琪琼琳璃琥珀珊瑚琉璃蔷薇芙蓉茉莉樱花枫叶" +
            "青云白夜晨暮朝霞夕阳暮光初雪冬夜星河银翼碧空苍穹大地深渊辉光雷霆风暴寒霜烈焰疾风迅雷惊鸿游龙凤凰麒麟玄武朱雀";

        /// <summary>
        /// 生成随机中文名
        /// <para><paramref name="random"/> 必须由调用方下传（通常是 <c>Skill.Random</c> / <c>Effect.Random</c>，最终指向本局队列的随机源）；
        /// 禁止使用进程级的 <c>Random.Shared</c>，否则同种子对局无法复现</para>
        /// </summary>
        /// <param name="random">本局随机源</param>
        public static string GenerateRandomChineseName(Random random)
        {
            int length = random.Next(2, 6);
            StringBuilder name = new();
            for (int i = 0; i < length; i++)
            {
                name.Append(Chars[random.Next(Chars.Length)]);
            }
            return name.ToString();
        }
    }
}
