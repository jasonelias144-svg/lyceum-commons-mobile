import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { JoinScreen } from './src/screens/JoinScreen';
import { RoomScreen } from './src/screens/RoomScreen';
import { colors } from './src/theme/colors';

type Session = { handle: string; roomId: string } | null;

export default function App() {
  const [session, setSession] = useState<Session>(null);

  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style="light" />
      {session ? (
        <RoomScreen
          roomId={session.roomId}
          handle={session.handle}
          onLeave={() => setSession(null)}
        />
      ) : (
        <JoinScreen
          onJoined={(handle, roomId) => setSession({ handle, roomId })}
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
