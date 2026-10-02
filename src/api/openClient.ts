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

/**
 * Neutral fallback for a 409 whose body carries no usable message. The
 * client never picks its own wording for a name conflict: whenever the
 * server sends a message, that is what is shown (same as the web client).
 */
export const NAME_IN_USE_FALLBACK = 'That name is in use right now.';

export class OpenApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: unknown;
  /** Seconds from a Retry-After header, when the response carried one. */
  retryAfterSec?: number;
  /**
   * Wall time (ms) before which this path must not be called again: the
   * longest of the Retry-After header (seconds or HTTP-date) and any body
   * retry field. Undefined when the response named no wait.
   */
  retryUntilMs?: number;
  /** True when no request was sent: a local wait from an earlier 429 is still running. */
  localWait?: boolean;
  /** Path whose wait this error set (cleared on Leave / a Join-screen join → wait over). */
  waitKind?: WaitPath;
  /** True when the failing request carried an X-Lyceum-Guest key. */
  sentGuestKey?: boolean;

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

/** Any 409 on a join — terminal for a rejoin (no retry); copy from handleConflictNote. */
export function isNameConflict(e: unknown): boolean {
  return e instanceof OpenApiError && e.status === 409;
}

/** A bare machine code such as `handle_taken` — never shown as copy. */
const ERROR_CODE_RE = /^[a-z0-9_]+$/;

/**
 * The server's own text for an error body. Bodies are nested
 * (`{ error: { code, message } }`): `error.message` first, then a top-level
 * `message`, then a top-level `error` string — unless that string is a bare
 * code (`{"error":"handle_taken"}`), which is a code, not copy. Undefined
 * when none is usable.
 */
export function serverErrorMessage(e: unknown): string | undefined {
  if (!(e instanceof OpenApiError)) return undefined;
  const p = e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {};
  const err = p.error;
  const nested =
    err && typeof err === 'object' ? (err as { message?: unknown }).message : undefined;
  const flat =
    typeof err === 'string' && !ERROR_CODE_RE.test(err.trim()) ? err : undefined;
  for (const v of [nested, p.message, flat]) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * Copy for any 409 on join / rejoin, keyed or keyless: the server's message
 * whenever there is one, else {@link NAME_IN_USE_FALLBACK}. No client-side
 * wording choice and no matching on the server's English.
 */
export function handleConflictNote(e: unknown): string {
  return serverErrorMessage(e) ?? NAME_IN_USE_FALLBACK;
}

/** Fallback copy for 403 guest_name_limit when the body carries no message. */
export const GUEST_NAME_LIMIT_NOTE =
  'This device has reached its name limit. Use a name you already have, or leave a room to free one.';

/**
 * 403 guest_name_limit — this guest key already holds the maximum number of
 * names. Not identity loss: never a reason to (silently) rejoin.
 */
export function isGuestNameLimit(e: unknown): boolean {
  return e instanceof OpenApiError && e.code === 'guest_name_limit';
}

/** Plain note for guest_name_limit: the server's message, else the fallback. */
export function guestNameLimitNote(e: unknown): string {
  return serverErrorMessage(e) ?? GUEST_NAME_LIMIT_NOTE;
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

/** Error codes treated as the server's slow-down (alongside any HTTP 429). */
export const SLOW_DOWN_CODES = ['rate_limited', 'slow_down', 'too_many_requests'];

/** Fallback copy when a slow-down carries no note of its own. */
export const SLOW_DOWN_FALLBACK = 'Slow down a moment, then send again.';

function slowDownPayload(e: OpenApiError): Record<string, unknown> {
  const p = e.payload;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}

/**
 * Server slow-down on a post: HTTP 429, or a JSON `error` (string or
 * `{ code }`) of rate_limited / slow_down / too_many_requests. Not identity
 * loss — the caller keeps the text and shows {@link slowDownNote}.
 */
export function isSlowDown(e: unknown): boolean {
  if (!(e instanceof OpenApiError)) return false;
  if (e.status === 429) return true;
  const err = slowDownPayload(e).error;
  const code =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object'
        ? (err as { code?: unknown }).code
        : e.code;
  return typeof code === 'string' && SLOW_DOWN_CODES.includes(code.toLowerCase());
}

/** Text of the server's own slow-down note: `message` / `note` / `error_description`, top level then nested. */
function slowDownServerText(e: OpenApiError): string | undefined {
  const p = slowDownPayload(e);
  const nested =
    p.error && typeof p.error === 'object' ? (p.error as Record<string, unknown>) : {};
  const pick = (o: Record<string, unknown>) =>
    [o.message, o.note, o.error_description].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
  return (pick(nested) ?? pick(p))?.trim();
}

/** Countdown when the server names a wait but sends no text. */
export function slowDownCountdown(secs: number): string {
  return `Slow down \u2014 try again in ${secs}s.`;
}

/** Longest wait the client ever honours for one 429 (bogus or huge values are clamped). */
export const MAX_WAIT_MS = 120_000;

/**
 * Whole seconds left on a slow-down wait at `nowMs`: 0 when none, passed, or
 * cleared (Leave / a Join-screen join, or a newer wait on the same path).
 */
export function slowDownSecondsLeft(e: unknown, nowMs = Date.now()): number {
  if (!(e instanceof OpenApiError) || e.retryUntilMs == null) return 0;
  if (e.waitKind && waits[e.waitKind]?.until !== e.retryUntilMs) return 0;
  return Math.max(0, Math.ceil((e.retryUntilMs - nowMs) / 1000));
}

/**
 * Plain one-line note for a slow-down (429). With a known wait still
 * running, it always carries the client's live countdown: the server's
 * message followed by "Try again in Ns.", or "Slow down — try again in Ns."
 * when there is no message. With no usable wait: the server's message, else
 * {@link SLOW_DOWN_FALLBACK}. Callers re-render each second while
 * {@link slowDownSecondsLeft} > 0.
 */
export function slowDownNote(e: unknown, nowMs = Date.now()): string {
  if (!(e instanceof OpenApiError)) return SLOW_DOWN_FALLBACK;
  const text = slowDownServerText(e);
  const left = slowDownSecondsLeft(e, nowMs);
  if (left > 0) {
    if (!text) return slowDownCountdown(left);
    const sentence = /[.!?\u2026]$/.test(text) ? text : `${text}.`;
    return `${sentence} Try again in ${left}s.`;
  }
  return text ?? SLOW_DOWN_FALLBACK;
}

/** Plain decimal only ("7", "3.7", " 4 "): no sign, hex, exponent or other forms. */
const PLAIN_DECIMAL_RE = /^\d+(?:\.\d+)?$/;

/** A positive finite number from a JSON number or a plain-decimal string; NaN otherwise. */
function numField(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : NaN;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!PLAIN_DECIMAL_RE.test(t)) return NaN;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  }
  return NaN;
}

/** A wait in ms → whole seconds (rounded up), at most {@link MAX_WAIT_MS}; 0 = no wait. */
function clampWaitMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(MAX_WAIT_MS, Math.ceil(ms / 1000) * 1000);
}

/**
 * Wait (ms) named by a 429 body, if any: `retry_after` / `retryAfter`
 * (seconds) or `retry_after_ms` / `retryAfterMs` (ms), inside `error` or at
 * the top level. The longest one found wins (clamped by the caller).
 */
function bodyRetryAfterMs(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const top = body as Record<string, unknown>;
  const nested =
    top.error && typeof top.error === 'object' ? (top.error as Record<string, unknown>) : {};
  let best: number | undefined;
  for (const o of [nested, top]) {
    for (const [k, scale] of [
      ['retry_after', 1000],
      ['retryAfter', 1000],
      ['retry_after_ms', 1],
      ['retryAfterMs', 1],
    ] as const) {
      const n = numField(o[k]);
      if (Number.isFinite(n) && n > 0) best = Math.max(best ?? 0, n * scale);
    }
  }
  return best;
}

/** Looks like a number but isn't plain decimal (sign, hex, exponent, …): never a date either. */
const NUMBERISH_RE = /^[+-]?[\d.]/;

/**
 * Retry-After header → seconds: plain decimal delta-seconds, or an HTTP-date
 * in the future. Zero, negative, past, hex / exponent forms and garbage →
 * undefined (no wait). Not clamped here.
 */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (PLAIN_DECIMAL_RE.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (NUMBERISH_RE.test(t)) return undefined;
  const at = Date.parse(t);
  if (!Number.isFinite(at)) return undefined;
  const secs = (at - Date.now()) / 1000;
  return secs > 0 ? secs : undefined;
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

/**
 * Error bodies are nested (`{ error: { code, message } }`); read
 * `error.code` / `error.message`, falling back to a top-level `error` string
 * (as the code) and top-level `message`.
 */
function errorFromBody(status: number, body: unknown): OpenApiError {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    const nested =
      b.error && typeof b.error === 'object'
        ? (b.error as { code?: unknown; message?: unknown })
        : undefined;
    const code =
      typeof nested?.code === 'string'
        ? nested.code
        : typeof b.error === 'string'
          ? b.error
          : undefined;
    const message =
      typeof nested?.message === 'string' && nested.message.length > 0
        ? nested.message
        : typeof b.message === 'string' && b.message.length > 0
          ? b.message
          : undefined;
    if (message) return new OpenApiError(status, message, code, body);
    if (code) return new OpenApiError(status, `Open API error (${status})`, code, body);
  }
  return new OpenApiError(status, `Open API error (${status})`, undefined, body);
}

/** Request paths a 429 wait applies to (leave is never held back). */
type WaitPath = 'join' | 'post' | 'poll';

function waitPathOf(method: string, path: string): WaitPath | null {
  if (method === 'POST' && /\/join$/.test(path)) return 'join';
  if (method === 'POST' && /\/post$/.test(path)) return 'post';
  if (method === 'GET' && /\/messages$/.test(path)) return 'poll';
  return null;
}

/**
 * Per-path 429 waits: until `until`, no request goes out on that path; the
 * caller gets a local 429 (same payload, `localWait`) instead. So every path
 * (rejoin, post, poll, Join) honours Retry-After without its own timer.
 */
const waits: Partial<Record<WaitPath, { until: number; status: number; payload: unknown; message: string; code?: string }>> = {};

function localWaitError(kind: WaitPath, now: number): OpenApiError | null {
  const w = waits[kind];
  if (!w) return null;
  if (now >= w.until) {
    delete waits[kind];
    return null;
  }
  const err = new OpenApiError(w.status, w.message, w.code, w.payload);
  err.retryUntilMs = w.until;
  err.retryAfterSec = (w.until - now) / 1000;
  err.localWait = true;
  err.waitKind = kind;
  return err;
}

/**
 * Drop every 429 wait (join, post, poll). Called only when the user ends or
 * starts a session explicitly: after a Leave that succeeded (or Leave
 * anyway), and after a join from the Join screen succeeds — so a wait never
 * outlives the session it came from. Silent / poll / foreground rejoins and
 * background / unload leaves keep them; so does a failed Leave.
 */
export function clearWaits(): void {
  delete waits.join;
  delete waits.post;
  delete waits.poll;
}

/** Test/diagnostic: time (ms) a path is held back until, or 0. */
export function waitUntilFor(kind: WaitPath): number {
  const w = waits[kind];
  return w && w.until > Date.now() ? w.until : 0;
}

async function request<T>(
  method: string,
  path: string,
  init?: { body?: unknown; query?: Record<string, string | undefined> },
): Promise<T> {
  const kind = waitPathOf(method, path);
  if (kind) {
    const held = localWaitError(kind, Date.now());
    if (held) throw held;
  }
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
    const err = errorFromBody(res.status, parsed);
    const now = Date.now();
    err.retryAfterSec = parseRetryAfter(res.headers.get('Retry-After'));
    err.sentGuestKey = Boolean(guestKey);
    if (isSlowDown(err)) {
      const headerMs = err.retryAfterSec != null ? err.retryAfterSec * 1000 : 0;
      const waitMs = clampWaitMs(Math.max(headerMs, bodyRetryAfterMs(parsed) ?? 0));
      if (waitMs > 0) {
        err.retryAfterSec = waitMs / 1000;
        err.retryUntilMs = now + waitMs;
        if (kind) {
          err.waitKind = kind;
          waits[kind] = {
            until: err.retryUntilMs,
            status: err.status,
            payload: err.payload,
            message: err.message,
            code: err.code,
          };
        }
      }
    }
    throw err;
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
 * Sent synchronously and never throws; fire-and-forget. The returned promise
 * settles (never rejects) once the request is done, for callers that must
 * order a later join after it.
 */
export function leaveRoomBestEffort(roomId: string, handle: string): Promise<void> {
  const url = openUrl(`/rooms/${encodeURIComponent(roomId)}/leave`);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const guestKey = getGuestKeySync();
  if (guestKey) headers[GUEST_HEADER] = guestKey;
  try {
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ handle }),
      keepalive: true,
    }).then(
      () => undefined,
      () => undefined, // ignore — best effort
    );
  } catch {
    // ignore — best effort
    return Promise.resolve();
  }
}

export function getApiBase(): string {
  return apiBase();
}
