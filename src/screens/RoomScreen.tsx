import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  OpenApiError,
  leaveRoom,
  listMessages,
  postMessage,
  type OpenMessage,
} from '../api/openClient';
import { Composer } from '../components/Composer';
import { MessageRow } from '../components/MessageRow';
import { colors } from '../theme/colors';

const NEAR_BOTTOM_PX = 80;
const POLL_MS = 4000;

type Props = {
  roomId: string;
  handle: string;
  onLeave: () => void;
};

export function RoomScreen({ roomId, handle, onLeave }: Props) {
  const [messages, setMessages] = useState<OpenMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const listRef = useRef<FlatList<OpenMessage>>(null);
  const nearBottomRef = useRef(true);
  const mountedRef = useRef(true);

  const scrollToEndQuiet = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const refresh = useCallback(
    async (opts?: { initial?: boolean; forceScroll?: boolean }) => {
      try {
        const res = await listMessages(roomId, handle);
        if (!mountedRef.current) return;
        setMessages(res.messages ?? []);
        setError(null);
        if (opts?.initial || opts?.forceScroll || nearBottomRef.current) {
          scrollToEndQuiet(!opts?.initial);
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
    void refresh({ initial: true });
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distance =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    nearBottomRef.current = distance < NEAR_BOTTOM_PX;
  }

  async function handleSend(body: string) {
    await postMessage(roomId, handle, body);
    nearBottomRef.current = true;
    await refresh({ forceScroll: true });
  }

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    try {
      await leaveRoom(roomId, handle);
    } catch {
      // leave is optional / best-effort for M1
    } finally {
      setLeaving(false);
      onLeave();
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Open · {roomId}
            </Text>
            <Text style={styles.headerHandle} numberOfLines={1}>
              {handle}
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
                if (nearBottomRef.current) scrollToEndQuiet(false);
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

        <Composer onSend={handleSend} disabled={loading} />
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
    paddingBottom: 16,
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
});
