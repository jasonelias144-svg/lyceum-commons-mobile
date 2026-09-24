import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
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
  bottomInset?: number;
};

export function Composer({ onSend, disabled, bottomInset = 0 }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const canSend =
    !disabled && !sending && draft.trim().length > 0 && draft.length <= 4000;

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await onSend(body);
      setDraft('');
      setSendError(null);
    } catch {
      setSendError("Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  function onChangeDraft(text: string) {
    setDraft(text);
    if (sendError) setSendError(null);
  }

  const inputRef = useRef<TextInput | null>(null);
  const [inputHost, setInputHost] = useState<TextInput | null>(null);
  const canSendRef = useRef(canSend);
  const handleSendRef = useRef(handleSend);
  canSendRef.current = canSend;
  handleSendRef.current = handleSend;

  function setInputRef(node: TextInput | null) {
    inputRef.current = node;
    setInputHost(node);
  }

  // Web: attach capture keydown on the real DOM node so we beat RN-web's
  // multiline handler (prop onKeyDown loses). Enter sends; Shift+Enter newline.
  useEffect(() => {
    if (Platform.OS !== 'web' || !inputHost) return;
    const host = inputHost as unknown as {
      _node?: HTMLElement;
      getNode?: () => HTMLElement | null;
    };
    let el: HTMLElement | null =
      host._node ??
      (typeof host.getNode === 'function' ? host.getNode() : null) ??
      (typeof (host as unknown as HTMLElement).addEventListener === 'function'
        ? (host as unknown as HTMLElement)
        : null);
    if (el && el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
      el = el.querySelector?.('textarea, input') ?? el;
    }
    if (!el || typeof el.addEventListener !== 'function') return;

    const onKeyDown = (e: KeyboardEvent) => {
      // IME composition: don't send while composing (keyCode 229 = IME).
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (canSendRef.current) void handleSendRef.current();
    };
    el.addEventListener('keydown', onKeyDown, true);
    return () => el.removeEventListener('keydown', onKeyDown, true);
  }, [inputHost]);

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(10, bottomInset) }]}
      pointerEvents="box-none"
    >
      {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}
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
          ref={setInputRef}
          style={[
            styles.input,
            Platform.OS === 'web'
              ? ({ outlineStyle: 'none', outlineWidth: 0 } as object)
              : null,
          ]}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder="Message"
          placeholderTextColor={colors.placeholder}
          multiline
          maxLength={4000}
          editable={!disabled && !sending}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            // Native (and web fallback): send on submit when supported.
            if (Platform.OS !== 'web' && canSend) void handleSend();
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Microphone (unavailable)"
          disabled
          style={styles.stubMic}
          hitSlop={8}
        >
          <Text style={styles.micGlyph}>◉</Text>
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
    paddingTop: 6,
  },
  sendError: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 6,
    paddingHorizontal: 8,
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
  stubMic: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  stubGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: '300',
  },
  micGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '400',
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
