export class BaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseUrlError";
  }
}

export function checkedBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BaseUrlError("Base URL 格式不正确。");
  }
  const localHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new BaseUrlError(
      "为避免 API Key 以明文传输，Base URL 必须使用 HTTPS（本机 localhost 除外）。",
    );
  }
  if (url.username || url.password) {
    throw new BaseUrlError("Base URL 不能包含用户名或密码。");
  }
  if (url.search || url.hash) {
    throw new BaseUrlError("Base URL 不能包含查询参数或片段。");
  }
  return url.toString().replace(/\/+$/, "");
}
