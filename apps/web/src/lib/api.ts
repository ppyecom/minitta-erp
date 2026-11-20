export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

// La sesión viaja en una cookie httpOnly que puso la API: no hay token que el
// JavaScript pueda leer ni cabecera que armar. Cuando la cookie ya no sirve, la
// API contesta 401 y quien escuche acá manda al login.
type Listener = () => void;
const unauthorized = new Set<Listener>();

/** Avisa cuando la API rechaza la sesión. Devuelve la función para dejar de escuchar. */
export function onUnauthorized(fn: Listener) {
  unauthorized.add(fn);
  return () => unauthorized.delete(fn);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${url}`, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    // /auth/me y /auth/login contestan 401 de forma esperable: ahí no hay sesión
    // que avisar que venció, la pantalla de login ya está mostrándose
    if (res.status === 401 && !url.startsWith('/auth/')) {
      for (const fn of unauthorized) fn();
    }
    throw new ApiError(msg || `Error ${res.status}`, res.status, data?.fields ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Arma un query string ignorando los valores vacíos. */
export function qs(params: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
