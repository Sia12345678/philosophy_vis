export type ThemeId = "atlas" | "night" | "parchment";

interface ThemeChoice {
  id: ThemeId;
  labelZh: string;
  labelEn: string;
}

const STORAGE_KEY = "philosophy_vis_theme";

const themes: ThemeChoice[] = [
  { id: "atlas", labelZh: "航海图", labelEn: "Atlas" },
  { id: "night", labelZh: "夜航图", labelEn: "Night chart" },
  { id: "parchment", labelZh: "羊皮纸", labelEn: "Parchment" },
];

function isTheme(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

function savedTheme(): ThemeId {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isTheme(value)) return value;
  } catch {
    /* ignore */
  }
  return "atlas";
}

export function initTheme(): void {
  const button = document.getElementById("theme-btn") as HTMLButtonElement | null;
  let current = savedTheme();

  function apply(themeId: ThemeId): void {
    current = themeId;
    const theme = themes.find((candidate) => candidate.id === themeId) ?? themes[0];
    document.documentElement.dataset.theme = theme.id;
    button?.setAttribute(
      "title",
      `视觉风格：${theme.labelZh} / ${theme.labelEn}`,
    );
    button?.setAttribute(
      "aria-label",
      `切换视觉风格，当前：${theme.labelZh} / Change visual theme, current: ${theme.labelEn}`,
    );
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      /* ignore */
    }
  }

  apply(current);
  button?.addEventListener("click", () => {
    const index = themes.findIndex((theme) => theme.id === current);
    apply(themes[(index + 1) % themes.length].id);
  });
}
