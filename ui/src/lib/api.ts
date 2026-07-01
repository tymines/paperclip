/**
 * Placeholder API client — matches the pattern used by Paperclip UI.
 * In production this connects to the backend with auth headers.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Attach auth token if available
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("paperclip_token")
      : null;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(`${BASE_URL}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody);
      message = parsed.message ?? parsed.error ?? resp.statusText;
    } catch {
      message = errorBody || resp.statusText;
    }
    throw new Error(message);
  }

  return resp.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
};
