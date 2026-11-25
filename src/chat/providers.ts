export type Schema = "openai" | "anthropic";

export interface ProviderConfig {
  id: string;
  label: string;
  schema: Schema;
  baseUrl: string;
  defaultModel: string;
  keyHint?: string;
  signupUrl?: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    schema: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyHint: "sk-…",
    signupUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    schema: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    keyHint: "sk-ant-…",
    signupUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek 深度求索",
    schema: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    keyHint: "sk-…",
    signupUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "qwen",
    label: "通义 Qwen (DashScope)",
    schema: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-turbo",
    keyHint: "sk-…",
    signupUrl: "https://dashscope.console.aliyun.com/apiKey",
  },
  {
    id: "moonshot",
    label: "Moonshot Kimi 月之暗面",
    schema: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    keyHint: "sk-…",
    signupUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    schema: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    keyHint: "JWT…",
    signupUrl: "https://bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "custom",
    label: "自定义 (OpenAI 兼容)",
    schema: "openai",
    baseUrl: "",
    defaultModel: "",
    keyHint: "key + baseUrl + 模型名都自填",
  },
];

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

const LS_PROVIDER = "philosophy_vis_llm_provider";
const LS_KEY = "philosophy_vis_llm_key";
const LS_BASE_URL = "philosophy_vis_llm_base_url";
const LS_MODEL = "philosophy_vis_llm_model";
const SETTINGS_KEY = "philosophy_vis_llm_settings_v2";

export interface ChatSettings {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LoadedSettings {
  settings: ChatSettings;
  remember: boolean;
}

interface StoredSettings extends ChatSettings {
  version: 2;
}

function normalizeSettings(value: unknown): ChatSettings | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StoredSettings>;
  if (typeof raw.providerId !== "string" || typeof raw.apiKey !== "string") {
    return null;
  }
  const apiKey = raw.apiKey.trim();
  const provider = getProvider(raw.providerId);
  if (!provider || !apiKey) return null;
  const baseUrl =
    typeof raw.baseUrl === "string" && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : provider.baseUrl;
  const model =
    typeof raw.model === "string" && raw.model.trim()
      ? raw.model.trim()
      : provider.defaultModel;
  if (!baseUrl || !model) return null;
  return { providerId: provider.id, apiKey, baseUrl, model };
}

function storageFor(kind: "session" | "local"): Storage | null {
  try {
    return kind === "session" ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function readStoredSettings(storage: Storage | null): ChatSettings | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readLegacySettings(): ChatSettings | null {
  try {
    return normalizeSettings({
      providerId: localStorage.getItem(LS_PROVIDER),
      apiKey: localStorage.getItem(LS_KEY),
      baseUrl: localStorage.getItem(LS_BASE_URL),
      model: localStorage.getItem(LS_MODEL),
    });
  } catch {
    return null;
  }
}

function clearLegacySettings(): void {
  try {
    localStorage.removeItem(LS_PROVIDER);
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_BASE_URL);
    localStorage.removeItem(LS_MODEL);
  } catch {
    /* ignore */
  }
}

export function loadSettingsState(): LoadedSettings | null {
  const session = readStoredSettings(storageFor("session"));
  if (session) {
    clearLegacySettings();
    return { settings: session, remember: false };
  }
  const local = readStoredSettings(storageFor("local"));
  if (local) {
    clearLegacySettings();
    return { settings: local, remember: true };
  }
  const legacy = readLegacySettings();
  if (!legacy) {
    clearLegacySettings();
    return null;
  }
  try {
    storageFor("session")?.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 2, ...legacy } satisfies StoredSettings),
    );
  } catch {
    /* The key stays in memory for this page; never keep the old long-lived copy. */
  }
  clearLegacySettings();
  return { settings: legacy, remember: false };
}

export function loadSettings(): ChatSettings | null {
  return loadSettingsState()?.settings ?? null;
}

export function saveSettings(s: ChatSettings, remember = false): void {
  const payload = JSON.stringify({ version: 2, ...s } satisfies StoredSettings);
  const session = storageFor("session");
  const local = storageFor("local");
  try {
    if (remember && local) {
      local.setItem(SETTINGS_KEY, payload);
      session?.removeItem(SETTINGS_KEY);
    } else if (session) {
      session.setItem(SETTINGS_KEY, payload);
      local?.removeItem(SETTINGS_KEY);
    }
  } catch {
    /* Storage can be unavailable in private or restricted contexts. */
  }
  clearLegacySettings();
}

export function clearSettings(): void {
  try {
    storageFor("session")?.removeItem(SETTINGS_KEY);
    storageFor("local")?.removeItem(SETTINGS_KEY);
  } catch {
    /* ignore */
  }
  clearLegacySettings();
}
