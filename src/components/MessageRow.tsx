import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OpenMessage } from '../api/openClient';
import { colors } from '../theme/colors';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type Props = { message: OpenMessage };

function MessageRowInner({ message }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.meta}>
        <Text style={styles.author} numberOfLines={1}>
          {message.author}
        </Text>
        <Text style={styles.party}>{message.party}</Text>
        <Text style={styles.time}>{formatTime(message.created_at)}</Text>
      </View>
      <Text style={styles.body}>{message.body}</Text>
    </View>
  );
}

export const MessageRow = memo(MessageRowInner);

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 6,
  },
  author: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  party: {
    color: colors.textFaint,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  time: {
    color: colors.textDim,
    fontSize: 12,
    marginLeft: 'auto',
  },
  body: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 26,
  },
});
