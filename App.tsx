import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { JoinScreen } from './src/screens/JoinScreen';
import { RoomScreen } from './src/screens/RoomScreen';
import { colors } from './src/theme/colors';

type Session = { handle: string; roomId: string } | null;
/** Join screen prefill after the room hands back (e.g. name held). */
type JoinPrefill = { handle: string; note: string } | null;

export default function App() {
  const [session, setSession] = useState<Session>(null);
  const [prefill, setPrefill] = useState<JoinPrefill>(null);

  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style="light" />
      {session ? (
        <RoomScreen
          roomId={session.roomId}
          handle={session.handle}
          onLeave={() => setSession(null)}
          onIdentityLost={(note) => {
            setPrefill({ handle: session.handle, note });
            setSession(null);
          }}
        />
      ) : (
        <JoinScreen
          initialHandle={prefill?.handle}
          initialNote={prefill?.note}
          onJoined={(handle, roomId) => {
            setPrefill(null);
            setSession({ handle, roomId });
          }}
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
