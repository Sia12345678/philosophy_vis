import {
  PROVIDERS,
  getProvider,
  type ChatSettings,
  type LoadedSettings,
} from "./providers";

export interface ProviderSettingsLabels {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  remember: string;
  save: string;
  clear: string;
}

export interface ProviderSettingsValue {
  settings: ChatSettings;
  remember: boolean;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function renderProviderSettingsForm(
  current: LoadedSettings | null,
  labels: ProviderSettingsLabels,
): string {
  const currentId = current?.settings.providerId ?? "openai";
  const provider = getProvider(currentId) ?? PROVIDERS[0];
  const options = PROVIDERS.map(
    (candidate) =>
      `<option value="${escape(candidate.id)}"${candidate.id === currentId ? " selected" : ""}>${escape(candidate.label)}</option>`,
  ).join("");
  const apiKey = current?.settings.apiKey ?? "";
  const baseUrl =
    current?.settings.baseUrl ??
    (provider.id === "custom" ? "" : provider.baseUrl);
  const model = current?.settings.model ?? provider.defaultModel;
  const isCustom = currentId === "custom";

  return `
    <form class="provider-settings-form" data-no-close>
      <label class="chat-field">
        <span>${escape(labels.provider)}</span>
        <select name="provider" class="chat-provider-select">${options}</select>
      </label>
      <label class="chat-field">
        <span>${escape(labels.apiKey)}</span>
        <input name="apiKey" type="password" autocomplete="off" spellcheck="false"
               placeholder="${escape(provider.keyHint ?? "")}"
               value="${escape(apiKey)}" />
      </label>
      <label class="chat-field">
        <span>${escape(labels.model)}</span>
        <input name="model" type="text" autocomplete="off" spellcheck="false"
               placeholder="${escape(provider.defaultModel)}"
               value="${escape(model)}" />
      </label>
      <div class="provider-custom-row" ${isCustom ? "" : "hidden"}>
        <label class="chat-field">
          <span>${escape(labels.baseUrl)}</span>
          <input name="baseUrl" type="url" autocomplete="off" spellcheck="false"
                 placeholder="https://example.com/v1"
                 value="${escape(baseUrl)}" />
        </label>
      </div>
      <label class="provider-remember">
        <input name="remember" type="checkbox"${current?.remember ? " checked" : ""} />
        <span>${escape(labels.remember)}</span>
      </label>
      <div class="chat-settings-actions">
        <button type="button" class="chat-settings-save" data-settings-action="save">${escape(labels.save)}</button>
        <button type="button" class="chat-settings-clear" data-settings-action="clear">${escape(labels.clear)}</button>
      </div>
    </form>
  `;
}

export function syncProviderFields(form: HTMLFormElement): void {
  const providerSelect = form.querySelector<HTMLSelectElement>(
    'select[name="provider"]',
  );
  const customRow = form.querySelector<HTMLElement>(".provider-custom-row");
  if (!providerSelect || !customRow) return;
  const provider = getProvider(providerSelect.value) ?? PROVIDERS[0];
  const previousProvider = form.dataset.providerId;
  const keyInput = form.querySelector<HTMLInputElement>('input[name="apiKey"]');
  const modelInput = form.querySelector<HTMLInputElement>('input[name="model"]');
  const baseUrlInput = form.querySelector<HTMLInputElement>('input[name="baseUrl"]');
  if (keyInput) keyInput.placeholder = provider.keyHint ?? "";
  if (previousProvider && previousProvider !== providerSelect.value) {
    // Never forward a key saved for one provider to another provider.
    if (keyInput) keyInput.value = "";
    if (modelInput) modelInput.value = provider.defaultModel;
    if (baseUrlInput) {
      baseUrlInput.value = provider.id === "custom" ? "" : provider.baseUrl;
    }
  }
  form.dataset.providerId = providerSelect.value;
  customRow.hidden = providerSelect.value !== "custom";
}

export function readProviderSettings(
  form: HTMLFormElement,
): { value: ProviderSettingsValue } | { error: string } {
  const data = new FormData(form);
  const providerId = String(data.get("provider") ?? "").trim();
  const apiKey = String(data.get("apiKey") ?? "").trim();
  const provider = getProvider(providerId);
  if (!provider) return { error: "provider 配置无效，请重新选择。" };
  if (!apiKey) return { error: "请填写 API Key。" };
  const baseUrl =
    provider.id === "custom"
      ? String(data.get("baseUrl") ?? "").trim()
      : provider.baseUrl;
  const model =
    String(data.get("model") ?? "").trim() || provider.defaultModel;
  if (!baseUrl || !model) {
    return { error: "自定义模式需要填写 Base URL 和模型名。" };
  }
  return {
    value: {
      settings: { providerId, apiKey, baseUrl, model },
      remember: data.get("remember") === "on",
    },
  };
}
