import schoolsData from "../data/schools.json";
import type { School } from "../utils/types";
import { store } from "../utils/store";

const schools = schoolsData.schools as School[];

interface Family {
  label_zh: string;
  label_en: string;
  schoolIds: string[];
}

const FAMILIES: Family[] = [
  {
    label_zh: "古希腊 — 罗马",
    label_en: "Greek & Roman",
    schoolIds: ["pre_socratic", "greek_classical", "hellenistic", "neoplatonism"],
  },
  {
    label_zh: "中世纪 — 伊斯兰",
    label_en: "Medieval & Islamic",
    schoolIds: ["christian_medieval", "islamic_golden"],
  },
  {
    label_zh: "近代欧洲",
    label_en: "Early Modern Europe",
    schoolIds: ["renaissance", "rationalism", "empiricism", "enlightenment", "german_idealism"],
  },
  {
    label_zh: "19—20 世纪",
    label_en: "19th–20th Century",
    schoolIds: [
      "utilitarianism",
      "marxism",
      "continental",
      "existentialism",
      "phenomenology",
      "analytic",
      "pragmatism",
      "critical_theory",
    ],
  },
  {
    label_zh: "中国",
    label_en: "Chinese",
    schoolIds: [
      "confucianism",
      "neo_confucianism",
      "daoism",
      "legalism",
      "mohism",
      "modern_chinese",
    ],
  },
  {
    label_zh: "佛教 · 印度教 · 耆那",
    label_en: "Indian Traditions",
    schoolIds: ["buddhism", "zen", "hinduism_vedanta", "jainism"],
  },
  {
    label_zh: "日本",
    label_en: "Japanese",
    schoolIds: ["kyoto_school"],
  },
];

export function initFilterBar(): void {
  const select = document.getElementById("school-filter") as HTMLSelectElement | null;
  if (!select) return;

  const schoolById = new Map(schools.map((s) => [s.id, s]));
  for (const family of FAMILIES) {
    const og = document.createElement("optgroup");
    og.label = `${family.label_zh} · ${family.label_en}`;
    for (const sid of family.schoolIds) {
      const s = schoolById.get(sid);
      if (!s) continue;
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name_zh} · ${s.name_en}`;
      og.appendChild(opt);
    }
    select.appendChild(og);
  }

  select.addEventListener("change", () => {
    const v = select.value || null;
    store.set({ schoolFilter: v });
  });

  store.subscribe((s, prev) => {
    if (s.schoolFilter !== prev.schoolFilter) {
      select.value = s.schoolFilter ?? "";
    }
  });
}
