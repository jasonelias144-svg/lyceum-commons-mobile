import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  OpenApiError,
  formatTurnStatus,
  joinRoom,
  leaveRoom,
  leaveRoomBestEffort,
  listMessages,
  parseTurn,
  postMessage,
  type OpenMessage,
  type RosterEntry,
  type RoomVisibility,
  type Turn,
} from '../api/openClient';
import { Composer } from '../components/Composer';
import { MessageRow } from '../components/MessageRow';
import { colors } from '../theme/colors';

const NEAR_BOTTOM_PX = 80;
const POLL_MS = 4000;
/** Extra list padding so the last message clears the floating pill. */
const LIST_BOTTOM_PAD = 80;

type Props = {
  roomId: string;
  handle: string;
  onLeave: () => void;
};

export function RoomScreen({ roomId, handle, onLeave }: Props) {
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

  const scrollToEndQuiet = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const refresh = useCallback(
    async (opts?: { initial?: boolean; forceScroll?: boolean; full?: boolean }) => {
      try {
        const after =
          !opts?.initial && !opts?.full && lastMessageIdRef.current
            ? lastMessageIdRef.current
            : undefined;
        const res = await listMessages(roomId, handle, after);
        if (!mountedRef.current || !sessionActiveRef.current) return;

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

        // Room meta rides on every messages response — refresh turn/visibility/roster cheaply.
        if (typeof res.visibility === 'string' && res.visibility.length > 0) {
          setVisibility(res.visibility);
        }
        const nextTurn = parseTurn(res.turn);
        if (nextTurn) setTurn(nextTurn);
        if (Array.isArray(res.roster)) {
          setRoster(res.roster);
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
        if (!mountedRef.current) return;
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
    [roomId, handle, scrollToEndQuiet],
  );

  useEffect(() => {
    mountedRef.current = true;
    sessionActiveRef.current = true;
    void refresh({ initial: true });
    const id = setInterval(() => {
      if (sessionActiveRef.current && !leftForBackgroundRef.current) {
        void refresh();
      }
    }, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  // Web: best-effort leave on pagehide / beforeunload.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPageHide = () => {
      leaveRoomBestEffort(roomId, handle);
    };
    const onBeforeUnload = () => {
      leaveRoomBestEffort(roomId, handle);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('beforeunload', onBeforeUnload);
      };
    }
    return undefined;
  }, [roomId, handle]);

  // Native: leave on background; silent rejoin on active.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        if (!leftForBackgroundRef.current && sessionActiveRef.current) {
          leftForBackgroundRef.current = true;
          leaveRoomBestEffort(roomId, handle);
        }
      } else if (next === 'active') {
        if (leftForBackgroundRef.current && sessionActiveRef.current) {
          // Keep polling paused (leftForBackgroundRef true) until rejoin succeeds.
          void (async () => {
            try {
              await joinRoom(roomId, handle);
              if (!mountedRef.current) return;
              leftForBackgroundRef.current = false;
              setRejoinError(null);
              await refresh({ full: true });
            } catch (e) {
              if (!mountedRef.current) return;
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
  }, [roomId, handle, refresh]);

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
      leftForBackgroundRef.current = false;
      setRejoinError(null);
      await refresh({ full: true });
    } catch (e) {
      if (!mountedRef.current) return;
      const msg =
        e instanceof OpenApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Couldn't rejoin. Try again.";
      setRejoinError(msg);
    }
  }

  async function handleSend(body: string) {
    const posted = await postMessage(roomId, handle, body);
    const nextTurn = parseTurn(posted.turn);
    if (nextTurn) setTurn(nextTurn);
    nearBottomRef.current = true;
    await refresh({ forceScroll: true });
  }

  async function handleLeave() {
    if (leaving) return;
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
          <Text style={styles.turnStatus} numberOfLines={1}>
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bg,
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  headerHandle: {
    color: colors.textDim,
    fontSize: 12,
  },
  leaveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  leaveLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  stream: {
    flex: 1,
    backgroundColor: colors.bgNear,
  },
  listContent: {
    paddingVertical: 8,
    paddingBottom: LIST_BOTTOM_PAD,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    color: colors.textDim,
    fontSize: 15,
    textAlign: 'center',
  },
  errorBanner: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: 16,
  },
  turnStatus: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  leaveErrorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  leaveErrorText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  leaveErrorAction: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  leaveErrorActionMuted: {
    color: colors.textDim,
    fontSize: 13,
  },
});
