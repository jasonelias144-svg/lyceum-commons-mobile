import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  OpenApiError,
  WELCOME_ROOM_ID,
  getApiBase,
  joinRoom,
} from '../api/openClient';
import { colors } from '../theme/colors';

type Props = {
  onJoined: (handle: string, roomId: string) => void;
};

export function JoinScreen({ onJoined }: Props) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = handle.trim();
  const canJoin = trimmed.length > 0 && trimmed.length <= 40 && !busy;

  async function handleJoin() {
    if (!canJoin) return;
    setBusy(true);
    setError(null);
    try {
      await joinRoom(WELCOME_ROOM_ID, trimmed);
      onJoined(trimmed, WELCOME_ROOM_ID);
    } catch (e) {
      const msg =
        e instanceof OpenApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Join failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <Text style={styles.kicker}>Open</Text>
          <Text style={styles.title}>Join welcome</Text>
          <Text style={styles.sub}>
            Room {WELCOME_ROOM_ID} · human path · thin client
          </Text>

          <TextInput
            style={styles.input}
            value={handle}
            onChangeText={setHandle}
            placeholder="Handle"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            maxLength={40}
            editable={!busy}
            returnKeyType="go"
            onSubmitEditing={() => void handleJoin()}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Join ${WELCOME_ROOM_ID}`}
            onPress={() => void handleJoin()}
            disabled={!canJoin}
            style={[styles.button, !canJoin && styles.buttonDisabled]}
          >
            {busy ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Text style={[styles.buttonLabel, !canJoin && styles.buttonLabelDisabled]}>
                Join open-welcome
              </Text>
            )}
          </Pressable>

          <Text style={styles.meta} numberOfLines={2}>
            {getApiBase()}
          </Text>
        </View>
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
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  kicker: {
    color: colors.textDim,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  error: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  buttonLabel: {
    color: colors.black,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonLabelDisabled: {
    color: colors.textDim,
  },
  meta: {
    marginTop: 28,
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
  },
});
