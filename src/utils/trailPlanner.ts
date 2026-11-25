import philosophersData from "../data/philosophers.json";
import type { Philosopher } from "../utils/types";
import type { Trail, TrailStep } from "../data/trails";

const philosophers = philosophersData.philosophers as Philosopher[];

const STOPWORDS = new Set([
  "的",
  "了",
  "是",
  "我",
  "你",
  "他",
  "她",
  "它",
  "们",
  "和",
  "与",
  "在",
  "有",
  "没有",
  "会",
  "能",
  "要",
  "吗",
  "呢",
  "啊",
  "什么",
  "为什么",
  "怎么",
  "如何",
  "是否",
  "一个",
  "这个",
  "那个",
  "可以",
  "应该",
  "真的",
  "the",
  "a",
  "an",
  "is",
  "are",
  "am",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "for",
  "with",
  "how",
  "why",
  "what",
  "who",
  "can",
  "should",
  "would",
  "does",
  "do",
]);

interface QuestionTheme {
  id: string;
  termsZh: string[];
  termsEn: string[];
  seeds: string[];
}

const themes: QuestionTheme[] = [
  {
    id: "freedom",
    termsZh: ["自由", "自主", "选择", "决定论", "命运", "束缚", "解放"],
    termsEn: ["free will", "freedom", "liberty", "choice", "determinism", "autonomy"],
    seeds: ["zhuangzi", "epictetus", "spinoza", "mill", "sartre", "beauvoir", "camus"],
  },
  {
    id: "death",
    termsZh: ["死亡", "必死", "临终", "永生", "哀悼", "告别", "有限"],
    termsEn: ["death", "die", "dying", "mortality", "finite", "grief", "immortality"],
    seeds: ["epicurus", "seneca", "boethius", "heidegger", "levinas", "simone_weil", "camus"],
  },
  {
    id: "meaning",
    termsZh: ["意义", "虚无", "荒诞", "绝望", "无聊", "为什么活", "值得活"],
    termsEn: ["meaning", "meaningless", "absurd", "nihilism", "purpose", "why live"],
    seeds: ["socrates", "epicurus", "kierkegaard", "nietzsche", "heidegger", "camus", "beauvoir"],
  },
  {
    id: "justice",
    termsZh: ["正义", "公平", "公正", "权力", "政治", "国家", "秩序", "革命", "压迫"],
    termsEn: ["justice", "fairness", "power", "politics", "state", "order", "revolution", "oppression"],
    seeds: ["confucius", "plato", "hobbes", "locke", "rousseau", "marx", "arendt", "foucault"],
  },
  {
    id: "knowledge",
    termsZh: ["知识", "真理", "知道", "怀疑", "科学", "证据", "确定", "事实"],
    termsEn: ["knowledge", "truth", "know", "doubt", "science", "evidence", "certainty", "fact"],
    seeds: ["parmenides", "plato", "descartes", "hume", "kant", "popper", "wittgenstein"],
  },
  {
    id: "self",
    termsZh: ["我是谁", "自我", "身份", "意识", "身体", "人格", "真实的我"],
    termsEn: ["identity", "self", "consciousness", "body", "personhood", "who am i"],
    seeds: ["socrates", "augustine", "montaigne", "hume", "kierkegaard", "sartre", "beauvoir"],
  },
  {
    id: "happiness",
    termsZh: ["幸福", "快乐", "好生活", "痛苦", "安宁", "焦虑", "欲望", "满足"],
    termsEn: ["happiness", "happy", "good life", "suffering", "anxiety", "desire", "tranquility"],
    seeds: ["democritus", "epicurus", "zeno_citium", "marcus_aurelius", "montaigne", "alain", "camus"],
  },
  {
    id: "technology",
    termsZh: ["技术", "人工智能", "算法", "机器", "平台", "监控", "数据", "手机"],
    termsEn: ["technology", "artificial intelligence", "ai", "algorithm", "machine", "platform", "surveillance", "data"],
    seeds: ["bacon", "marx", "heidegger", "adorno", "foucault", "deleuze", "habermas"],
  },
  {
    id: "love",
    termsZh: ["爱", "亲密", "他者", "关系", "孤独", "友情", "共情"],
    termsEn: ["love", "intimacy", "other", "relationship", "loneliness", "friendship", "empathy"],
    seeds: ["empedocles", "mozi", "abelard", "levinas", "beauvoir", "simone_weil", "alain"],
  },
  {
    id: "faith",
    termsZh: ["信仰", "上帝", "宗教", "神", "灵魂", "死后", "超越"],
    termsEn: ["faith", "god", "religion", "soul", "afterlife", "transcendence"],
    seeds: ["anselm", "aquinas", "pascal", "kierkegaard", "al_ghazali", "levinas", "simone_weil"],
  },
  {
    id: "education",
    termsZh: ["教育", "学习", "成长", "习惯", "培养", "训练", "自修"],
    termsEn: ["education", "learning", "growth", "habit", "cultivate", "training", "self-cultivation"],
    seeds: ["confucius", "socrates", "seneca", "dewey", "feng_youlan", "mou_zongsan", "alain"],
  },
  {
    id: "work",
    termsZh: ["工作", "劳动", "异化", "资本", "效率", "内卷", "疲惫", "职业"],
    termsEn: ["work", "labor", "alienation", "capital", "productivity", "burnout", "career"],
    seeds: ["hegel", "marx", "dewey", "arendt", "foucault", "simone_weil", "habermas"],
  },
  {
    id: "art",
    termsZh: ["艺术", "美", "审美", "创作", "想象", "诗", "音乐"],
    termsEn: ["art", "beauty", "aesthetic", "creation", "imagination", "poetry", "music"],
    seeds: ["plato", "kukai", "schopenhauer", "nietzsche", "heidegger", "adorno", "derrida"],
  },
];

const fallbackSeeds = [
  "socrates",
  "plato",
  "descartes",
  "kant",
  "nietzsche",
  "camus",
  "beauvoir",
];

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  const normalized = term.toLowerCase();
  if (/^[a-z0-9][a-z0-9\s'-]*$/i.test(normalized)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(normalized);
}

function questionTokens(question: string): string[] {
  const tokens = new Set<string>();
  const latin = question.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  for (const token of latin) {
    if (!STOPWORDS.has(token)) tokens.add(token);
  }
  const han = question.replace(/[^\u4e00-\u9fff]/g, "");
  for (let index = 0; index < han.length - 1; index++) {
    const bigram = han.slice(index, index + 2);
    if (!STOPWORDS.has(bigram)) tokens.add(bigram);
  }
  return [...tokens];
}

function corpus(philosopher: Philosopher): string {
  return [
    philosopher.id,
    philosopher.name_zh,
    philosopher.name_en,
    philosopher.location.zh,
    philosopher.location.en,
    philosopher.schools.join(" "),
    ...philosopher.theories_zh,
    ...philosopher.theories_en,
    ...philosopher.works.flatMap((work) => [work.zh, work.en]),
    philosopher.bio_zh,
  ]
    .join("\n")
    .toLowerCase();
}

function scoreTheme(question: string): { theme: QuestionTheme | null; score: number } {
  const text = question.toLowerCase();
  let best: QuestionTheme | null = null;
  let bestScore = 0;
  for (const theme of themes) {
    let score = 0;
    for (const term of [...theme.termsZh, ...theme.termsEn]) {
      if (containsTerm(text, term)) {
        score += Math.min(5, Math.max(2, term.length));
      }
    }
    if (score > bestScore) {
      best = theme;
      bestScore = score;
    }
  }
  return { theme: best, score: bestScore };
}

function bestTheoryIndex(philosopher: Philosopher, tokens: string[]): number {
  let bestIndex = 0;
  let bestScore = 0;
  philosopher.theories_zh.forEach((theoryZh, index) => {
    const theoryEn = philosopher.theories_en[index] ?? "";
    const text = `${theoryZh} ${theoryEn}`.toLowerCase();
    const score = tokens.reduce(
      (total, token) => total + (text.includes(token) ? Math.max(2, token.length) : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function shortQuestion(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  const characters = Array.from(compact);
  return characters.length > 32 ? `${characters.slice(0, 32).join("")}…` : compact;
}

export function planCustomTrail(rawQuestion: string): Trail {
  const question = rawQuestion.replace(/\s+/g, " ").trim();
  const truncated = shortQuestion(question);
  const tokens = questionTokens(question);
  const { theme } = scoreTheme(question);
  const philosopherByLocalId = new Map(philosophers.map((p) => [p.id, p]));

  const lexicalScores = philosophers.map((philosopher) => {
    const text = corpus(philosopher);
    let score = 0;
    for (const token of tokens) {
      const matches = text.split(token).length - 1;
      if (matches > 0) score += Math.max(2, token.length) * Math.min(matches, 3);
    }
    if (question.includes(philosopher.name_zh) || question.toLowerCase().includes(philosopher.name_en.toLowerCase())) {
      score += 1000;
    }
    for (const school of philosopher.schools) {
      if (question.toLowerCase().includes(school.replace(/_/g, " "))) score += 40;
    }
    return { philosopher, score };
  });
  lexicalScores.sort((a, b) => b.score - a.score || a.philosopher.birth - b.philosopher.birth);

  const seedIds = theme?.seeds ?? fallbackSeeds;
  const selected: Philosopher[] = [];
  const seen = new Set<string>();
  for (const id of seedIds) {
    const philosopher = philosopherByLocalId.get(id);
    if (!philosopher || seen.has(id)) continue;
    selected.push(philosopher);
    seen.add(id);
  }
  for (const { philosopher, score } of lexicalScores) {
    if (selected.length >= 7) break;
    if (score === 0 && theme) continue;
    if (seen.has(philosopher.id)) continue;
    selected.push(philosopher);
    seen.add(philosopher.id);
  }
  for (const { philosopher } of lexicalScores) {
    if (selected.length >= 6) break;
    if (seen.has(philosopher.id)) continue;
    selected.push(philosopher);
    seen.add(philosopher.id);
  }

  const ordered = selected.sort(
    (first, second) => first.birth - second.birth || first.id.localeCompare(second.id),
  );

  const steps: TrailStep[] = ordered.map((philosopher, index) => {
    const next = ordered[index + 1];
    const theoryIndex = bestTheoryIndex(philosopher, tokens);
    const theoryZh = philosopher.theories_zh[theoryIndex] ?? philosopher.theories_zh[0] ?? "";
    const theoryEn = philosopher.theories_en[theoryIndex] ?? philosopher.theories_en[0] ?? theoryZh;
    const nextTheoryZh = next
      ? next.theories_zh[bestTheoryIndex(next, tokens)] ?? next.theories_zh[0] ?? ""
      : "";
    const nextTheoryEn = next
      ? next.theories_en[bestTheoryIndex(next, tokens)] ?? next.theories_en[0] ?? nextTheoryZh
      : "";
    return {
      philosopherId: philosopher.id,
      theoryIndex,
      workIndex: philosopher.works.length > 0 ? 0 : undefined,
      question_zh:
        index === 0
          ? question
          : `把问题带到${philosopher.name_zh}这里：如果「${theoryZh}」成立，它会怎样改变你的问题？`,
      question_en:
        index === 0
          ? question
          : `Bring the question to ${philosopher.name_en}: if “${theoryEn}” holds, how does it change your question?`,
      bridge_zh: next
        ? `下一站是${next.name_zh}。这里不是师承关系，而是换一个概念镜头：从「${theoryZh}」转向「${nextTheoryZh}」。`
        : `路线到这里不给出唯一答案。把「${theoryZh}」带回你的问题，看看它改变了哪一个前提。`,
      bridge_en: next
        ? `The next stop is ${next.name_en}. This is not a claim of lineage, but a change of conceptual lens: from “${theoryEn}” to “${nextTheoryEn}.”`
        : `The trail does not end with a single answer. Take “${theoryEn}” back to your question and see which premise it changes.`,
    };
  });

  return {
    id: `custom-${hashText(question)}`,
    title_zh: `关于「${truncated}」的思想路线`,
    title_en: `A philosophical trail: “${truncated}”`,
    description_zh:
      "从你写下的问题出发，在现有哲学家中自动选出一组切入点，按时间顺序展开。它不是标准答案，而是一条可以走完的思考路线。",
    description_en:
      "Starting from your question, this trail selects a set of existing philosophical positions and orders them in time. It is not an answer key, but a route you can walk through.",
    steps,
  };
}

export function customTrailTitle(question: string): string {
  return shortQuestion(question);
}
