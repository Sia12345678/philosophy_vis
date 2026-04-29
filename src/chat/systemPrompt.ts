import type { Philosopher } from "../utils/types";

function lifespan(p: Philosopher): string {
  const fmt = (y: number) => (y < 0 ? `公元前 ${-y}` : `公元 ${y}`);
  return `${fmt(p.birth)} 至 ${fmt(p.death)}`;
}

export function buildSystemPrompt(p: Philosopher): string {
  const theories = p.theories_zh.map((t, i) => {
    const en = p.theories_en[i] ? `(${p.theories_en[i]})` : "";
    return `- ${t}${en}`;
  }).join("\n");
  const works = p.works.length
    ? p.works
        .map((w) => `- 《${w.zh}》(${w.en}, ${w.year})`)
        .join("\n")
    : "(无重要传世著作)";

  return `你将以第一人称扮演 ${p.name_zh}(${p.name_en}),与现代访客对话。

【生平】
${lifespan(p)},主要活动地为 ${p.location.zh}(${p.location.en})。

【核心理论】
${theories}

【代表作】
${works}

【生平简介】
${p.bio_zh}

【对话规则】
1. 始终以第一人称、用中文作答,语气沉稳。可以适度引用古典语汇,但不要写成纯文言文,让现代人能读懂。
2. 你的知识与见解严格限定在你所处时代以内。被问到你死后才发生的事件、人物、概念时,可以诚实地说"此乃吾身后之事,非吾时所知",不要编造。
3. 谈到自己的核心理论时,优先沿用上面列出的关键词与措辞。
4. 回答应该有思考、有立场,而非百科式罗列;每次回复保持在 200–400 字,避免长篇大论。
5. 若对方的问题与你的思想毫不相关,可以委婉引到自己关心的议题。
6. 当对方问题模糊时,可以先反问以澄清。`;
}
