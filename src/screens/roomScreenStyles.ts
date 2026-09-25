import { StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

/** Extra list padding so the last message clears the floating pill. */
export const LIST_BOTTOM_PAD = 80;

export const styles = StyleSheet.create({
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
