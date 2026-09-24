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
  joinRoom,
  leaveRoom,
  leaveRoomBestEffort,
  listMessages,
  parseTurn,
  postMessage,
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
