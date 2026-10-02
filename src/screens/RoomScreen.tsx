import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
  type AppStateStatus,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  OpenApiError,
  STALE_TURN_HEAL_POLLS,
  formatTurnStatus,
  guestNameLimitNote,
  handleConflictNote,
  isGuestNameLimit,
  isIdentityLoss,
  isNameConflict,
  joinRoom,
  leaveRoom,
  leaveRoomBestEffort,
  listMessages,
  parseTurn,
  postMessage,
  serverErrorMessage,
  shouldAcceptTurn,
  turnFingerprint,
  turnsEqual,
  type OpenMessage,
  type RosterEntry,
  type RoomVisibility,
  type Turn,
} from '../api/openClient';
import { Composer } from '../components/Composer';
import { MessageRow } from '../components/MessageRow';
import { colors } from '../theme/colors';
import { LIST_BOTTOM_PAD, styles } from './roomScreenStyles';

const NEAR_BOTTOM_PX = 80;
const POLL_MS = 4000;

/** Identity lost again right after a rejoin, and the server said nothing usable. */
const REJOIN_FAILED_NOTE = "Couldn't rejoin. Join again.";

/** In-room banner while a failed silent rejoin waits for the next poll to retry. */
const REJOIN_RETRYING_NOTE = "Couldn't rejoin yet. Trying again.";

/**
 * A rejoin failure that ends the session: any 409 (the server's message, else
 * the neutral fallback — see handleConflictNote) or 403 guest_name_limit (the
 * server's note). Null for anything retryable.
 */
function rejoinExitNote(e: unknown): string | null {
  if (isNameConflict(e)) return handleConflictNote(e);
  if (isGuestNameLimit(e)) return guestNameLimitNote(e);
  return null;
}

/**
 * Identity lost again right after a 200 rejoin (the rejoin didn't stick):
 * the server's message whenever there is one, keyed or keyless, else a
 * neutral "couldn't rejoin". No client-chosen "held" wording.
 */
function lostAgainNote(e: unknown): string {
  return serverErrorMessage(e) ?? REJOIN_FAILED_NOTE;
}

type Props = {
  roomId: string;
  handle: string;
  onLeave: () => void;
  /**
   * Identity could not be recovered (name held by someone else, or the silent
   * rejoin failed): polling has stopped; go back to join with `note`.
   */
  onIdentityLost: (note: string) => void;
};

/**
 * rejoined: identity is back (or another rejoin already restored it).
 * exited: session handed back to Join (terminal), or rejoin not allowed now.
 * failed: this rejoin failed for a retryable reason; the session stays and a
 *   later poll tries again (one rejoin at a time, at most one per poll tick).
 */
type RejoinOutcome = 'rejoined' | 'exited' | 'failed';

export function RoomScreen({ roomId, handle, onLeave, onIdentityLost }: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<OpenMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [visibility, setVisibility] = useState<RoomVisibility | string | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  const listRef = useRef<FlatList<OpenMessage>>(null);
  const nearBottomRef = useRef(true);
  const mountedRef = useRef(true);
  /** Scroll-to-end on content size until first settle; then only if near bottom. */
  const initialScrollPendingRef = useRef(true);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const leftForBackgroundRef = useRef(false);
  const sessionActiveRef = useRef(true);
  /**
   * Leave in flight or sent (button, Leave anyway, unload). Set — and polling
   * stopped — BEFORE the leave is awaited or fired, so a poll landing after
   * the leave (403 not_joined) can't silently rejoin a ghost member.
   */
  const leavingRef = useRef(false);
  /** Wall time the latest leave began; 403s from polls started earlier are ignored. */
  const leaveStartedAtRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Wall time of the latest post send start — stale polls begun before this skip turn. */
  const lastPostAtRef = useRef(0);
  /** Latest turn we applied (ref so poll can compare without stale closure). */
  const turnRef = useRef<Turn | null>(null);
  /**
   * Self-heal: after a stamped turn is held, older/unstamped polls are rejected.
   * If the *same* rejected body arrives on N consecutive *fresh* polls (~12s),
   * accept it (server redeploy / clock skew without remount).
   */
  const staleTurnHealRef = useRef<{ key: string; count: number }>({
    key: '',
    count: 0,
  });
  /**
   * Silent rejoin (guest identity). Bumped each time a rejoin lands; a poll or
   * post that started under an older generation and then fails with
   * not_joined / guest_key_required is stale (sent before the rejoin) and is
   * not counted as a second failure.
   */
  const rejoinGenRef = useRef(0);
  /** Single-flight: concurrent failing polls share one rejoin. */
  const rejoinInFlightRef = useRef<Promise<RejoinOutcome> | null>(null);
  /**
   * True after a silent rejoin until a poll/post started after it succeeds.
   * Another identity loss in that window means the rejoin didn't stick —
   * stop instead of looping.
   */
  const rejoinUnverifiedRef = useRef(false);
  /** Generation we already re-polled for (one immediate poll per rejoin). */
  const repolledGenRef = useRef(0);
  /**
   * Wall time the latest retryable rejoin failure finished. A call that
   * started before it already had its rejoin attempt — it doesn't start
   * another, so overlapping polls can't stack rejoins (≤ 1 per poll tick).
   */
  const rejoinFailedAtRef = useRef(0);
  const onIdentityLostRef = useRef(onIdentityLost);
  onIdentityLostRef.current = onIdentityLost;

  /**
   * Silent rejoin is allowed only in a live, foreground session: never while
   * leaving / after leave, or while backgrounded (AppState not 'active').
   */
  const canSilentRejoin = useCallback(
    () =>
      mountedRef.current &&
      sessionActiveRef.current &&
      !leavingRef.current &&
      !leftForBackgroundRef.current &&
      AppState.currentState === 'active',
    [],
  );

  /** Stop polling and hand back to the join screen (name prefilled by App). */
  const exitToJoin = useCallback((note: string) => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    leftForBackgroundRef.current = false;
    if (mountedRef.current) onIdentityLostRef.current(note);
  }, []);

  /**
   * A human call made under generation `startGen` (sent at `startedAt`)
   * failed with not_joined / guest_key_required. Rejoin once with the stored
   * handle and key (header added by the client), single-flight.
   * - 409 or guest_name_limit → back to Join with the note (terminal).
   * - Any other failure (network, 5xx, …) → 'failed': stay in the room; the
   *   next poll that hits identity loss tries one rejoin again (like web).
   * - Identity lost again after a 200 rejoin, before anything succeeded →
   *   back to Join (no rejoin-200 / 403 loop).
   */
  const recoverIdentity = useCallback(
    async (startGen: number, cause?: unknown, startedAt = Date.now()): Promise<RejoinOutcome> => {
      if (!sessionActiveRef.current) return 'exited';
      // Leaving / left / backgrounded: no rejoin, and no exit-to-join either.
      if (!canSilentRejoin()) return 'exited';
      const inFlight = rejoinInFlightRef.current;
      if (inFlight) return inFlight;
      // A rejoin already landed after this call was sent — just carry on.
      if (startGen !== rejoinGenRef.current) return 'rejoined';
      // A rejoin already failed after this call was sent — wait for the next tick.
      if (startedAt < rejoinFailedAtRef.current) return 'failed';
      if (rejoinUnverifiedRef.current) {
        exitToJoin(lostAgainNote(cause));
        return 'exited';
      }
      const attempt = (async (): Promise<RejoinOutcome> => {
        try {
          await joinRoom(roomId, handle);
          rejoinGenRef.current += 1;
          rejoinUnverifiedRef.current = true;
          return 'rejoined';
        } catch (e) {
          const exitNote = rejoinExitNote(e);
          if (exitNote) {
            exitToJoin(exitNote);
            return 'exited';
          }
          rejoinFailedAtRef.current = Date.now();
          return 'failed';
        } finally {
          rejoinInFlightRef.current = null;
        }
      })();
      rejoinInFlightRef.current = attempt;
      return attempt;
    },
    [roomId, handle, exitToJoin, canSilentRejoin],
  );

  /** A call started under `startGen` succeeded — the rejoin (if any) stuck. */
  const markIdentityOk = useCallback((startGen: number) => {
    if (startGen === rejoinGenRef.current) rejoinUnverifiedRef.current = false;
  }, []);

  const scrollToEndQuiet = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const refresh = useCallback(
    async (opts?: { initial?: boolean; forceScroll?: boolean; full?: boolean }) => {
      const startedAt = Date.now();
      const startGen = rejoinGenRef.current;
      try {
        const after =
          !opts?.initial && !opts?.full && lastMessageIdRef.current
            ? lastMessageIdRef.current
            : undefined;
        const res = await listMessages(roomId, handle, after);
        if (!mountedRef.current || !sessionActiveRef.current) return;
        if (leavingRef.current || startedAt < leaveStartedAtRef.current) return;
        markIdentityOk(startGen);

        if (after) {
          const incoming = res.messages ?? [];
          if (incoming.length > 0) {
            // Server returns all messages when `after` id is unknown — replace.
            const looksLikeFull =
              incoming.length > 1 &&
              incoming.some((m) => m.id === lastMessageIdRef.current);
            if (looksLikeFull) {
              setMessages(incoming);
              lastMessageIdRef.current = incoming[incoming.length - 1]?.id;
            } else {
              setMessages((prev) => {
                const seen = new Set(prev.map((m) => m.id));
                const appended = incoming.filter((m) => !seen.has(m.id));
                if (appended.length === 0) return prev;
                const next = [...prev, ...appended];
                lastMessageIdRef.current = next[next.length - 1]?.id;
                return next;
              });
            }
          }
        } else {
          const next = res.messages ?? [];
          setMessages(next);
          lastMessageIdRef.current = next[next.length - 1]?.id;
        }

        // Room meta (turn + roster + visibility) is atomic: a stale poll
        // (started before the latest post) drops the whole meta update —
        // messages still append via the `after` cursor above. Roster is only
        // applied when the turn is accepted or equal, so a rejected turn cannot
        // blank the status line by filtering awaiting against a thinner roster.
        const pollStaleVsPost = startedAt < lastPostAtRef.current;
        if (!pollStaleVsPost) {
          const nextTurn = parseTurn(res.turn);
          const current = turnRef.current;
          let applyMeta = false;
          if (nextTurn) {
            const accepted =
              shouldAcceptTurn(nextTurn, current) || turnsEqual(nextTurn, current);
            if (accepted) {
              applyMeta = true;
              staleTurnHealRef.current = { key: '', count: 0 };
            } else {
              // Older/unstamped vs held stamp — count consecutive identical rejects.
              const key = turnFingerprint(nextTurn);
              const heal = staleTurnHealRef.current;
              if (key && key === heal.key) {
                heal.count += 1;
              } else {
                staleTurnHealRef.current = { key, count: 1 };
              }
              if (staleTurnHealRef.current.count >= STALE_TURN_HEAL_POLLS) {
                // Mid-session recovery after store reset / clock skew.
                applyMeta = true;
                staleTurnHealRef.current = { key: '', count: 0 };
              }
            }
          }
          if (applyMeta && nextTurn) {
            turnRef.current = nextTurn;
            setTurn(nextTurn);
            if (typeof res.visibility === 'string' && res.visibility.length > 0) {
              setVisibility(res.visibility);
            }
            if (Array.isArray(res.roster)) {
              setRoster(res.roster);
            }
          }
        }

        setError(null);
        if (opts?.initial || opts?.forceScroll || nearBottomRef.current) {
          scrollToEndQuiet(!opts?.initial);
        }
        if (opts?.initial) {
          // Allow a couple of layout passes to pin to bottom, then settle.
          setTimeout(() => {
            initialScrollPendingRef.current = false;
          }, 400);
        }
      } catch (e) {
        if (!mountedRef.current || !sessionActiveRef.current) return;
        // Poll began before a leave, or we're leaving: drop it (its 403 is ours).
        if (leavingRef.current || startedAt < leaveStartedAtRef.current) return;
        if (isIdentityLoss(e)) {
          if (!canSilentRejoin()) return;
          // Expired / key not accepted: silent rejoin, no error banner. On
          // success poll again right away; the `after` cursor is untouched so
          // nothing is duplicated, and meta goes through the usual atomic path.
          const outcome = await recoverIdentity(startGen, e, startedAt);
          if (outcome === 'failed') {
            // Still in the room; the next poll tick retries the rejoin.
            if (mountedRef.current && sessionActiveRef.current) setError(REJOIN_RETRYING_NOTE);
            return;
          }
          if (
            outcome === 'rejoined' &&
            mountedRef.current &&
            sessionActiveRef.current &&
            repolledGenRef.current !== rejoinGenRef.current
          ) {
            repolledGenRef.current = rejoinGenRef.current;
            void refresh(opts?.initial ? { initial: true } : undefined);
          }
          return;
        }
        const msg =
          e instanceof OpenApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Failed to load messages';
        setError(msg);
      } finally {
        if (mountedRef.current && opts?.initial) setLoading(false);
      }
    },
    [roomId, handle, scrollToEndQuiet, recoverIdentity, markIdentityOk, canSilentRejoin],
  );

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      if (
        sessionActiveRef.current &&
        !leavingRef.current &&
        !leftForBackgroundRef.current
      ) {
        void refreshRef.current();
      }
    }, POLL_MS);
  }, []);

  /** Mark leaving and stop polling — call BEFORE awaiting / firing a leave. */
  const beginLeave = useCallback(() => {
    leavingRef.current = true;
    leaveStartedAtRef.current = Date.now();
    stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    sessionActiveRef.current = true;
    void refresh({ initial: true });
    startPolling();
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [refresh, startPolling, stopPolling]);

  // Web: best-effort leave on pagehide / beforeunload — once per unload (both
  // events fire on a normal close; a second leave would only 403). A page
  // restored from bfcache re-arms it; its next poll silently rejoins.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let sent = false;
    const leaveOnce = () => {
      if (sent || !sessionActiveRef.current) return;
      sent = true;
      beginLeave();
      leaveRoomBestEffort(roomId, handle);
    };
    const onPageShow = () => {
      if (!sent) return;
      sent = false;
      // Restored from bfcache: resume; the next poll silently rejoins.
      leavingRef.current = false;
      if (sessionActiveRef.current) startPolling();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', leaveOnce);
      window.addEventListener('beforeunload', leaveOnce);
      window.addEventListener('pageshow', onPageShow);
      return () => {
        window.removeEventListener('pagehide', leaveOnce);
        window.removeEventListener('beforeunload', leaveOnce);
        window.removeEventListener('pageshow', onPageShow);
      };
    }
    return undefined;
  }, [roomId, handle, beginLeave, startPolling]);

  // Native: leave on background; silent rejoin on active.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        if (!leftForBackgroundRef.current && sessionActiveRef.current) {
          // Pause polling and mark left before the leave is fired.
          leftForBackgroundRef.current = true;
          leaveStartedAtRef.current = Date.now();
          stopPolling();
          leaveRoomBestEffort(roomId, handle);
        }
      } else if (next === 'active') {
        if (leftForBackgroundRef.current && sessionActiveRef.current) {
          // Keep polling paused (leftForBackgroundRef true) until rejoin succeeds.
          void (async () => {
            try {
              await joinRoom(roomId, handle);
              if (!mountedRef.current) return;
              rejoinGenRef.current += 1;
              rejoinUnverifiedRef.current = false;
              leftForBackgroundRef.current = false;
              setRejoinError(null);
              startPolling();
              await refresh({ full: true });
            } catch (e) {
              if (!mountedRef.current) return;
              const exitNote = rejoinExitNote(e);
              if (exitNote) {
                exitToJoin(exitNote);
                return;
              }
              // Flag stays true → poll remains paused while not joined.
              const msg =
                e instanceof OpenApiError
                  ? e.message
                  : e instanceof Error
                    ? e.message
                    : "Couldn't rejoin. Try again.";
              setRejoinError(msg);
            }
          })();
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [roomId, handle, refresh, exitToJoin, startPolling, stopPolling]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distance =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    nearBottomRef.current = distance < NEAR_BOTTOM_PX;
    if (initialScrollPendingRef.current && distance < NEAR_BOTTOM_PX) {
      // User (or our initial scroll) is at bottom — allow settle soon.
    }
  }

  async function retryRejoin() {
    try {
      await joinRoom(roomId, handle);
      if (!mountedRef.current) return;
      rejoinGenRef.current += 1;
      rejoinUnverifiedRef.current = false;
      leftForBackgroundRef.current = false;
      setRejoinError(null);
      startPolling();
      await refresh({ full: true });
    } catch (e) {
      if (!mountedRef.current) return;
      const exitNote = rejoinExitNote(e);
      if (exitNote) {
        exitToJoin(exitNote);
        return;
      }
      const msg =
        e instanceof OpenApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Couldn't rejoin. Try again.";
      setRejoinError(msg);
    }
  }

  /** POST once; on identity loss rejoin once and retry the same post once. */
  async function postWithRejoin(body: string) {
    const startGen = rejoinGenRef.current;
    const startedAt = Date.now();
    lastPostAtRef.current = startedAt;
    try {
      const posted = await postMessage(roomId, handle, body);
      markIdentityOk(startGen);
      return posted;
    } catch (e) {
      if (!isIdentityLoss(e)) throw e;
      const outcome = await recoverIdentity(startGen, e, startedAt);
      if (outcome !== 'rejoined') throw e;
      // Retry exactly once. A 403/401 was not stored server-side, so this
      // cannot double-post.
      const retryGen = rejoinGenRef.current;
      lastPostAtRef.current = Date.now();
      try {
        const posted = await postMessage(roomId, handle, body);
        markIdentityOk(retryGen);
        return posted;
      } catch (e2) {
        if (isIdentityLoss(e2)) {
          // Rejoined but still refused — don't loop.
          exitToJoin(lostAgainNote(e2));
        }
        throw e2;
      }
    }
  }

  async function handleSend(body: string) {
    const posted = await postWithRejoin(body);
    const nextTurn = parseTurn(posted.turn);
    if (nextTurn && shouldAcceptTurn(nextTurn, turnRef.current)) {
      turnRef.current = nextTurn;
      setTurn(nextTurn);
      staleTurnHealRef.current = { key: '', count: 0 };
    }
    nearBottomRef.current = true;
    await refresh({ forceScroll: true });
  }

  async function handleLeave() {
    if (leaving || leavingRef.current) return;
    beginLeave();
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveRoom(roomId, handle);
      sessionActiveRef.current = false;
      leftForBackgroundRef.current = false;
      setLeaving(false);
      onLeave();
    } catch (e) {
      if (!mountedRef.current) return;
      // Still in the room: resume polling.
      leavingRef.current = false;
      if (sessionActiveRef.current) startPolling();
      const msg =
        e instanceof OpenApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Couldn't leave. Try again.";
      setLeaveError(msg);
      setLeaving(false);
    }
  }

  function handleLeaveAnyway() {
    beginLeave();
    sessionActiveRef.current = false;
    leftForBackgroundRef.current = false;
    leaveRoomBestEffort(roomId, handle);
    onLeave();
  }

  const turnLine = formatTurnStatus(handle, turn, roster);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Open · {roomId}
            </Text>
            <Text style={styles.headerHandle} numberOfLines={1}>
              {visibility ? `${handle} · ${visibility}` : handle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave room"
            onPress={() => void handleLeave()}
            disabled={leaving}
            hitSlop={10}
            style={styles.leaveBtn}
          >
            {leaving ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Text style={styles.leaveLabel}>Leave</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.stream}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              renderItem={({ item }) => <MessageRow message={item} />}
              contentContainerStyle={
                messages.length === 0 ? styles.emptyList : styles.listContent
              }
              onScroll={onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={() => {
                if (initialScrollPendingRef.current) {
                  scrollToEndQuiet(false);
                } else if (nearBottomRef.current) {
                  scrollToEndQuiet(false);
                }
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>No messages yet.</Text>
              }
              ListFooterComponent={
                error ? <Text style={styles.errorBanner}>{error}</Text> : null
              }
            />
          )}
        </View>

        {rejoinError ? (
          <View style={styles.leaveErrorRow}>
            <Text style={styles.leaveErrorText}>{rejoinError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry rejoin"
              onPress={() => void retryRejoin()}
              hitSlop={8}
            >
              <Text style={styles.leaveErrorAction}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {leaveError ? (
          <View style={styles.leaveErrorRow}>
            <Text style={styles.leaveErrorText}>{leaveError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry leave"
              onPress={() => void handleLeave()}
              hitSlop={8}
              disabled={leaving}
            >
              <Text style={styles.leaveErrorAction}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave anyway"
              onPress={handleLeaveAnyway}
              hitSlop={8}
            >
              <Text style={styles.leaveErrorActionMuted}>Leave anyway</Text>
            </Pressable>
          </View>
        ) : null}

        {turnLine ? (
          <Text
            style={styles.turnStatus}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {turnLine}
          </Text>
        ) : null}

        <Composer
          onSend={handleSend}
          disabled={loading}
          bottomInset={Math.max(insets.bottom, 10)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
