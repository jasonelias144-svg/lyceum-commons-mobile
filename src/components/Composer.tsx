import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
};

export function Composer({ onSend, disabled }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const canSend =
    !disabled && !sending && draft.trim().length > 0 && draft.length <= 4000;

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await onSend(body);
      setDraft('');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach (unavailable)"
          disabled
          style={styles.stub}
          hitSlop={8}
        >
          <Text style={styles.stubGlyph}>+</Text>
        </Pressable>

        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.placeholder}
          multiline
          maxLength={4000}
          editable={!disabled && !sending}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            if (canSend) void handleSend();
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Microphone (unavailable)"
          disabled
          style={styles.stub}
          hitSlop={8}
        >
          <Text style={styles.stubGlyph}>◦</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={() => void handleSend()}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendDisabled]}
          hitSlop={6}
        >
          {sending ? (
            <ActivityIndicator color={colors.black} size="small" />
          ) : (
            <Text style={[styles.sendLabel, !canSend && styles.sendLabelDisabled]}>
              ↑
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    minHeight: 52,
    gap: 4,
  },
  stub: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
  },
  stubGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: '300',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    backgroundColor: colors.disabled,
  },
  sendLabel: {
    color: colors.black,
    fontSize: 18,
    fontWeight: '700',
    marginTop: -1,
  },
  sendLabelDisabled: {
    color: colors.textDim,
  },
});
