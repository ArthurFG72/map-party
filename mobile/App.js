import { useState } from 'react';
import { StatusBar } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import PartyScreen from './src/screens/PartyScreen';

export default function App() {
  const [session, setSession] = useState(null);
  return <>
    <StatusBar barStyle={session ? 'light-content' : 'dark-content'} backgroundColor={session ? '#0b172a' : '#ffffff'} />
    {session
      ? <PartyScreen session={session} onLeave={() => setSession(null)} />
      : <HomeScreen onEnter={setSession} />}
  </>;
}
