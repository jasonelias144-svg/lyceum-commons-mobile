/**
 * Thin Open API client — human path only for M1.
 * Live base: EXPO_PUBLIC_API_BASE (default production Railway).
 * Prefix: /api/open
 */

export const DEFAULT_API_BASE =
  'https://lyceum-commons-production.up.railway.app';

export const OPEN_PREFIX = '/api/open';

export const WELCOME_ROOM_ID = 'open-welcome';

export type Party = 'human' | 'ai';

export type OpenMessage = {
  id: string;
  room_id: string;
  author: string;
  party: Party;
  body: string;
  created_at: string;
  awaiting?: string[];
  implicit_turn?: boolean;
};

export type RosterEntry = {
  id: string;
  party: Party;
  joined_at: string;
};

export type RoomMeta = {
  room_id: string;
  title?: string | null;
  layer?: string;
  visibility?: string;
  turn?: unknown;
  roster?: RosterEntry[];
};

export type JoinResponse = RoomMeta & {
  roster: RosterEntry[];
};

export type MessagesResponse = RoomMeta & {
  messages: OpenMessage[];
  roster: RosterEntry[];
};

export type PostResponse = {
  message: OpenMessage;
  turn?: unknown;
};

export type LeaveResponse = {
  ok: boolean;
  room_id?: string;
  layer?: string;
  roster?: RosterEntry[];
  title?: string | null;
  turn?: unknown;
};

export class OpenApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: unknown;

  constructor(status: number, message: string, code?: string, payload?: unknown) {
    super(message);
    this.name = 'OpenApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function apiBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE?.trim();
  const base = (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_API_BASE).replace(
    /\/+$/,
    '',
  );
  return base;
}

function openUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${apiBase()}${OPEN_PREFIX}${p}`;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function errorFromBody(status: number, body: unknown): OpenApiError {
  if (body && typeof body === 'object') {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    if (err?.message) {
      return new OpenApiError(status, err.message, err.code, body);
    }
    const message = (body as { message?: string }).message;
    if (typeof message === 'string') {
      return new OpenApiError(status, message, undefined, body);
    }
  }
  return new OpenApiError(status, `Open API error (${status})`, undefined, body);
}

async function request<T>(
  method: string,
  path: string,
  init?: { body?: unknown; query?: Record<string, string | undefined> },
): Promise<T> {
  let url = openUrl(path);
  if (init?.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== '') qs.set(k, v);
    }
    const s = qs.toString();
    if (s) url = `${url}?${s}`;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  const res = await fetch(url, { method, headers, body });
  const parsed = await parseJson(res);
  if (!res.ok) {
    throw errorFromBody(res.status, parsed);
  }
  return parsed as T;
}

/** POST /rooms/:id/join { party: "human", handle } */
export async function joinRoom(
  roomId: string,
  handle: string,
): Promise<JoinResponse> {
  return request<JoinResponse>('POST', `/rooms/${encodeURIComponent(roomId)}/join`, {
    body: { party: 'human', handle },
  });
}

/** GET /rooms/:id/messages?handle= */
export async function listMessages(
  roomId: string,
  handle: string,
  after?: string,
): Promise<MessagesResponse> {
  return request<MessagesResponse>(
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/messages`,
    { query: { handle, after } },
  );
}

/** POST /rooms/:id/post { handle, body } */
export async function postMessage(
  roomId: string,
  handle: string,
  body: string,
): Promise<PostResponse> {
  return request<PostResponse>('POST', `/rooms/${encodeURIComponent(roomId)}/post`, {
    body: { handle, body },
  });
}

/** POST /rooms/:id/leave { handle } — optional for M1 */
export async function leaveRoom(
  roomId: string,
  handle: string,
): Promise<LeaveResponse> {
  return request<LeaveResponse>('POST', `/rooms/${encodeURIComponent(roomId)}/leave`, {
    body: { handle },
  });
}

export function getApiBase(): string {
  return apiBase();
}
