import type { Philosopher } from "../utils/types";
import {
  PROVIDERS,
  getProvider,
  loadSettings,
  saveSettings,
  clearSettings,
  type ChatSettings,
} from "./providers";
import { streamChat, ChatError, type ChatMessage } from "./llm";
import { buildSystemPrompt } from "./systemPrompt";

const REPO_URL = "https://github.com/Sia12345678/philosophy_vis";

interface PanelState {
  philosopher: Philosopher;
  messages: ChatMessage[];
  abort: AbortController | null;
  settingsOpen: boolean;
}

export function mountChatPanel(
  p: Philosopher,
  container: HTMLElement,
): () => void {
  const state: PanelState = {
    philosopher: p,
    messages: [],
    abort: null,
    settingsOpen: false,
  };

  container.innerHTML = renderShell(p);
  const settingsEl = container.querySelector(".chat-settings") as HTMLElement;
  const messagesEl = container.querySelector(".chat-messages") as HTMLElement;
  const errorEl = container.querySelector(".chat-error") as HTMLElement;
  const form = container.querySelector(".chat-input-row") as HTMLFormElement;
  const textarea = container.querySelector(
    ".chat-textarea",
  ) as HTMLTextAreaElement;
  const sendBtn = container.querySelector(
    ".chat-send-btn",
  ) as HTMLButtonElement;
  const settingsToggle = container.querySelector(
    ".chat-settings-toggle",
  ) as HTMLButtonElement;

  function renderSettings(): void {
    const current = loadSettings();
    settingsEl.innerHTML = renderSettingsForm(current);
    wireSettingsForm();
  }

  function wireSettingsForm(): void {
    const providerSelect = settingsEl.querySelector(
      "select.chat-provider-select",
    ) as HTMLSelectElement | null;
    const customRow = settingsEl.querySelector(
      ".chat-custom-row",
    ) as HTMLElement | null;

    function updateCustomVisibility(): void {
      if (!providerSelect || !customRow) return;
      const isCustom = providerSelect.value === "custom";
      customRow.hidden = !isCustom;
    }
    providerSelect?.addEventListener("change", updateCustomVisibility);
    updateCustomVisibility();

    const saveBtn = settingsEl.querySelector(
      ".chat-settings-save",
    ) as HTMLButtonElement | null;
    const clearBtn = settingsEl.querySelector(
      ".chat-settings-clear",
    ) as HTMLButtonElement | null;

    saveBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      const fd = new FormData(
        settingsEl.querySelector("form.chat-settings-form") as HTMLFormElement,
      );
      const providerId = String(fd.get("provider") || "");
      const apiKey = String(fd.get("apiKey") || "").trim();
      const provider = getProvider(providerId);
      if (!provider || !apiKey) {
        showError("请填写 API Key");
        return;
      }
      const baseUrl =
        provider.id === "custom"
          ? String(fd.get("baseUrl") || "").trim()
          : provider.baseUrl;
      const model =
        provider.id === "custom"
          ? String(fd.get("model") || "").trim()
          : String(fd.get("model") || "").trim() || provider.defaultModel;
      if (provider.id === "custom" && (!baseUrl || !model)) {
        showError("自定义模式需要填 baseUrl 和模型名");
        return;
      }
      const settings: ChatSettings = { providerId, apiKey, baseUrl, model };
      saveSettings(settings);
      state.settingsOpen = false;
      settingsEl.hidden = true;
      hideError();
      textarea.focus();
    });

    clearBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      clearSettings();
      renderSettings();
    });
  }

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function hideError(): void {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function appendMessageEl(role: ChatMessage["role"], text: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = `chat-msg chat-msg-${role}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function setBusy(busy: boolean): void {
    textarea.disabled = busy;
    sendBtn.textContent = busy ? "■" : "↑";
    sendBtn.classList.toggle("is-stop", busy);
    sendBtn.setAttribute("aria-label", busy ? "停止" : "发送");
  }

  async function send(text: string): Promise<void> {
    const settings = loadSettings();
    if (!settings) {
      state.settingsOpen = true;
      settingsEl.hidden = false;
      showError("请先在 ⚙ 设置中填入 provider 和 API key");
      return;
    }
    const provider = getProvider(settings.providerId);
    if (!provider) {
      showError("provider 配置丢失,请重新设置");
      return;
    }

    hideError();
    state.messages.push({ role: "user", content: text });
    appendMessageEl("user", text);

    const bubble = appendMessageEl("assistant", "");
    bubble.classList.add("is-streaming");
    let acc = "";

    const ctrl = new AbortController();
    state.abort = ctrl;
    setBusy(true);

    try {
      const systemPrompt = buildSystemPrompt(state.philosopher);
      for await (const chunk of streamChat({
        provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        systemPrompt,
        messages: state.messages,
        signal: ctrl.signal,
      })) {
        if (chunk.delta) {
          acc += chunk.delta;
          bubble.textContent = acc;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (chunk.done) break;
      }
      if (acc) {
        state.messages.push({ role: "assistant", content: acc });
      } else {
        bubble.parentElement?.remove();
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        if (acc) {
          state.messages.push({ role: "assistant", content: acc });
        } else {
          bubble.parentElement?.remove();
        }
      } else if (err instanceof ChatError) {
        bubble.parentElement?.remove();
        const hint =
          err.kind === "auth"
            ? "Key 无效或已撤销,请检查"
            : err.kind === "rate"
            ? "请求过频或额度耗尽,稍后再试"
            : err.kind === "network"
            ? err.message
            : err.message;
        showError(hint);
        // pop user message back so they can retry without retyping
        state.messages.pop();
      } else {
        bubble.parentElement?.remove();
        showError(err instanceof Error ? err.message : String(err));
        state.messages.pop();
      }
    } finally {
      bubble.classList.remove("is-streaming");
      state.abort = null;
      setBusy(false);
    }
  }

  // Wire UI events
  settingsToggle.addEventListener("click", (e) => {
    e.preventDefault();
    state.settingsOpen = !state.settingsOpen;
    settingsEl.hidden = !state.settingsOpen;
    if (state.settingsOpen) renderSettings();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.abort) {
      state.abort.abort();
      return;
    }
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    void send(text);
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // If no settings, open the panel up-front so user knows what to do
  if (!loadSettings()) {
    state.settingsOpen = true;
    settingsEl.hidden = false;
    renderSettings();
  }

  // Unmount: abort any running stream
  return () => {
    state.abort?.abort();
    state.abort = null;
    state.messages = [];
    container.innerHTML = "";
  };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
      ? "&lt;"
      : c === ">"
      ? "&gt;"
      : c === '"'
      ? "&quot;"
      : "&#39;",
  );
}

function renderShell(p: Philosopher): string {
  return `
    <div class="chat-header">
      <span class="chat-title">💬 与 ${escape(p.name_zh)} 对话</span>
      <button type="button" class="chat-settings-toggle" aria-label="设置">⚙</button>
    </div>
    <div class="chat-settings" hidden></div>
    <div class="chat-error" hidden role="alert"></div>
    <div class="chat-messages" aria-live="polite"></div>
    <form class="chat-input-row">
      <textarea class="chat-textarea" rows="2" placeholder="输入消息,Enter 发送 / Shift+Enter 换行"></textarea>
      <button type="submit" class="chat-send-btn" aria-label="发送">↑</button>
    </form>
  `;
}

function renderSettingsForm(current: ChatSettings | null): string {
  const currentId = current?.providerId ?? "openai";
  const options = PROVIDERS.map(
    (p) =>
      `<option value="${p.id}"${p.id === currentId ? " selected" : ""}>${escape(p.label)}</option>`,
  ).join("");
  const provider = getProvider(currentId);
  const apiKey = current?.apiKey ?? "";
  const baseUrl =
    current?.baseUrl ??
    (provider?.id === "custom" ? "" : provider?.baseUrl ?? "");
  const model = current?.model ?? provider?.defaultModel ?? "";
  const isCustom = currentId === "custom";

  return `
    <form class="chat-settings-form">
      <label class="chat-field">
        <span>Provider</span>
        <select name="provider" class="chat-provider-select">${options}</select>
      </label>
      <label class="chat-field">
        <span>API Key</span>
        <input name="apiKey" type="password" autocomplete="off" spellcheck="false"
               placeholder="${escape(provider?.keyHint ?? "")}"
               value="${escape(apiKey)}" />
      </label>
      <label class="chat-field">
        <span>Model</span>
        <input name="model" type="text" autocomplete="off" spellcheck="false"
               placeholder="${escape(provider?.defaultModel ?? "")}"
               value="${escape(model)}" />
      </label>
      <div class="chat-custom-row" ${isCustom ? "" : "hidden"}>
        <label class="chat-field">
          <span>Base URL</span>
          <input name="baseUrl" type="url" autocomplete="off" spellcheck="false"
                 placeholder="https://example.com/v1"
                 value="${escape(baseUrl)}" />
        </label>
      </div>
      <div class="chat-settings-actions">
        <button type="button" class="chat-settings-save">保存</button>
        <button type="button" class="chat-settings-clear">清除</button>
      </div>
      <p class="chat-privacy-hint">
        Key 仅保存于您本地浏览器(localStorage),不会发送到任何第三方服务器。
        本项目代码完全开源,可在 <a href="${REPO_URL}" target="_blank" rel="noreferrer">GitHub</a> 审计。
        建议为试用 key 设置消费上限。
      </p>
    </form>
  `;
}
