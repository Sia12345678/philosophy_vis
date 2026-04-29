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

export interface ChatSettings {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadSettings(): ChatSettings | null {
  const providerId = localStorage.getItem(LS_PROVIDER);
  const apiKey = localStorage.getItem(LS_KEY);
  if (!providerId || !apiKey) return null;
  const provider = getProvider(providerId);
  if (!provider) return null;
  const baseUrl = localStorage.getItem(LS_BASE_URL) || provider.baseUrl;
  const model = localStorage.getItem(LS_MODEL) || provider.defaultModel;
  if (!baseUrl || !model) return null;
  return { providerId, apiKey, baseUrl, model };
}

export function saveSettings(s: ChatSettings): void {
  localStorage.setItem(LS_PROVIDER, s.providerId);
  localStorage.setItem(LS_KEY, s.apiKey);
  localStorage.setItem(LS_BASE_URL, s.baseUrl);
  localStorage.setItem(LS_MODEL, s.model);
}

export function clearSettings(): void {
  localStorage.removeItem(LS_PROVIDER);
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_BASE_URL);
  localStorage.removeItem(LS_MODEL);
}
