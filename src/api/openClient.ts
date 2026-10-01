/**
 * Thin Open API client — human path only (M1 shell + M2 visibility/turn,
 * M3 guest-key identity).
 * Live base: EXPO_PUBLIC_API_BASE (default production Railway).
 * Prefix: /api/open
 *
 * Guest identity: every call here is a human call, so each one carries the
 * stored guest key as `X-Lyceum-Guest` (header only, never in the body).
 */

import { getGuestKey, getGuestKeySync, isGuestKey, setGuestKey } from './guestKey';

export const DEFAULT_API_BASE =
  'https://lyceum-commons-production.up.railway.app';

export const OPEN_PREFIX = '/api/open';

export const WELCOME_ROOM_ID = 'open-welcome';

export type Party = 'human' | 'ai';

/** Room list discovery: listed in public lists; unlisted is link/member only. */
export type RoomVisibility = 'listed' | 'unlisted';

/**
 * Turn states (server openStore.TURN_STATES).
 * Human POST is not gated on turn — advisory for display only.
 */
export type TurnState = 'open' | 'input-required' | 'completed' | 'dormant';

export type Turn = {
  state: TurnState | string;
  awaiting: string[];
  note?: string | null;
  updated_at?: string;
  updated_by?: string | null;
};

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
  visibility?: RoomVisibility | string;
  turn?: Turn;
  roster?: RosterEntry[];
};

export type JoinResponse = RoomMeta & {
  roster: RosterEntry[];
  /** Present only on the join that minted a new guest key. */
  guest_key?: string;
};

/** Header carrying the guest key on human Open calls. */
export const GUEST_HEADER = 'X-Lyceum-Guest';

export type MessagesResponse = RoomMeta & {
  messages: OpenMessage[];
  roster: RosterEntry[];
};

export type PostResponse = {
  message: OpenMessage;
  turn?: Turn;
};

export type LeaveResponse = {
  ok: boolean;
  room_id?: string;
  layer?: string;
  visibility?: RoomVisibility | string;
  roster?: RosterEntry[];
  title?: string | null;
  turn?: Turn;
};

/** Case-insensitive participant id match (server sameId). */
export function sameParticipantId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Normalize turn payload from any roomMeta/post response. */
export function parseTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const state = typeof t.state === 'string' ? t.state : 'open';
  const awaiting = Array.isArray(t.awaiting)
    ? t.awaiting.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    state,
    awaiting,
    note: (t.note as string | null | undefined) ?? null,
    updated_at: typeof t.updated_at === 'string' ? t.updated_at : undefined,
    updated_by: (t.updated_by as string | null | undefined) ?? null,
  };
}

/**
 * Intersect turn.awaiting with current roster ids (case-insensitive).
 * Server leave does not prune awaiting — drop departed handles client-side.
 */
export function filterAwaitingByRoster(
  awaiting: string[] | undefined,
  roster: RosterEntry[] | null | undefined,
): string[] {
  const ids = awaiting ?? [];
  if (ids.length === 0) return [];
  if (!roster || roster.length === 0) return [];
  return ids.filter((id) =>
    roster.some((r) => sameParticipantId(r.id, id)),
  );
}

/** Cap long awaiter lists for the thin status line. */
export function formatAwaiterList(ids: string[]): string {
  if (ids.length === 0) return '';
  if (ids.length <= 2) return ids.join(', ');
  return `${ids.slice(0, 2).join(', ')} +${ids.length - 2}`;
}

/**
 * Quiet status copy for the composer strip.
 * Returns null when there is nothing useful to show (e.g. open / unknown,
 * or input-required with no still-present awaiters).
 */
export function formatTurnStatus(
  handle: string,
  turn: Turn | null | undefined,
  roster?: RosterEntry[] | null,
): string | null {
  if (!turn) return null;
  const state = turn.state;
  if (state === 'open') return null;
  if (state === 'completed') return 'Completed';
  if (state === 'dormant') return 'Dormant';
  if (state === 'input-required') {
    const awaiting = filterAwaitingByRoster(turn.awaiting, roster);
    if (awaiting.length === 0) return null;
    const mine = awaiting.some((id) => sameParticipantId(id, handle));
    const others = awaiting.filter((id) => !sameParticipantId(id, handle));
    if (mine) {
      if (others.length === 0) return 'Your turn';
      return `Your turn · also ${formatAwaiterList(others)}`;
    }
    if (awaiting.length === 1) return `${awaiting[0]}'s turn`;
    return `Waiting on ${formatAwaiterList(awaiting)}`;
  }
  return null;
}

/** Parse turn.updated_at to epoch ms; null if missing/invalid. */
export function turnUpdatedAtMs(turn: Turn | null | undefined): number | null {
  if (!turn?.updated_at) return null;
  const ms = Date.parse(turn.updated_at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Monotonic turn accept: prefer stamped turns; never let an older/unstamped
 * payload overwrite a newer stamped one.
 */
export function shouldAcceptTurn(
  incoming: Turn,
  current: Turn | null | undefined,
): boolean {
  const inMs = turnUpdatedAtMs(incoming);
  const curMs = turnUpdatedAtMs(current);
  if (inMs == null && curMs == null) return true;
  if (inMs == null) return false;
  if (curMs == null) return true;
  return inMs >= curMs;
}

/** Stable id for a turn body (state + awaiting + stamp) — used for equality / heal. */
export function turnFingerprint(turn: Turn | null | undefined): string {
  if (!turn) return '';
  const awaiting = [...(turn.awaiting ?? [])].map((s) => s.toLowerCase()).sort();
  return `${turn.state}|${awaiting.join(',')}|${turn.updated_at ?? ''}`;
}

/** True when two turns are the same for status/roster purposes. */
export function turnsEqual(
  a: Turn | null | undefined,
  b: Turn | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return turnFingerprint(a) === turnFingerprint(b);
}

/** Consecutive fresh rejected polls before accepting an older/unstamped turn. */
export const STALE_TURN_HEAL_POLLS = 3;

/** Human name is held by another guest key (join / rejoin). */
export const HELD_NAME_NOTE = 'That name is held by someone else.';

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

/** 409 handle_taken — the name is held by another guest (or a lookalike). */
export function isHandleTaken(e: unknown): boolean {
  return e instanceof OpenApiError && e.status === 409 && e.code === 'handle_taken';
}

/**
 * Lost identity for this name: not present in the room any more (403
 * not_joined, e.g. presence expiry) or the key was not accepted (401
 * guest_key_required). A silent rejoin with the stored key can fix either.
 */
export function isIdentityLoss(e: unknown): boolean {
  if (!(e instanceof OpenApiError)) return false;
  return (
    (e.status === 403 && e.code === 'not_joined') ||
    (e.status === 401 && e.code === 'guest_key_required')
  );
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
  const guestKey = await getGuestKey();
  if (guestKey) headers[GUEST_HEADER] = guestKey;
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

/** Strip zero-width / invisible / bidi control characters then trim. */
export function sanitizeHandle(raw: string): string {
  return raw
    .replace(
      /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g,
      '',
    )
    .trim();
}

/**
 * POST /rooms/:id/join { party: "human", handle } (+ X-Lyceum-Guest when stored).
 * If the server minted a key (`guest_key`), it is written to storage before
 * this resolves — callers can navigate as soon as the await returns. With no
 * `guest_key` in the reply the stored key is left as is.
 */
export async function joinRoom(
  roomId: string,
  handle: string,
): Promise<JoinResponse> {
  const res = await request<JoinResponse>(
    'POST',
    `/rooms/${encodeURIComponent(roomId)}/join`,
    { body: { party: 'human', handle } },
  );
  if (res && isGuestKey(res.guest_key)) {
    await setGuestKey(res.guest_key);
  }
  return res;
}

/** GET /rooms/:id/messages?handle=&after= */
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

/** POST /rooms/:id/leave { handle } */
export async function leaveRoom(
  roomId: string,
  handle: string,
): Promise<LeaveResponse> {
  return request<LeaveResponse>('POST', `/rooms/${encodeURIComponent(roomId)}/leave`, {
    body: { handle },
  });
}

/**
 * Best-effort leave for unload / background: keepalive fetch carrying the
 * guest key header. (No sendBeacon — beacons cannot set headers.)
 * Synchronous and never throws; fire-and-forget.
 */
export function leaveRoomBestEffort(roomId: string, handle: string): void {
  const url = openUrl(`/rooms/${encodeURIComponent(roomId)}/leave`);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const guestKey = getGuestKeySync();
  if (guestKey) headers[GUEST_HEADER] = guestKey;
  try {
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ handle }),
      keepalive: true,
    }).catch(() => {
      // ignore — best effort
    });
  } catch {
    // ignore — best effort
  }
}

export function getApiBase(): string {
  return apiBase();
}
