import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SERVER_URL } from '../config';

function makeRoomId() {
  const random = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 10)).join('');
  return random.slice(0, 24);
}

function BrandMark() {
  return <View style={styles.brandMark}>
    <View style={styles.brandPin}><View style={styles.brandPinCore} /></View>
    <View style={styles.brandOrbit} />
  </View>;
}

export default function HomeScreen({ onEnter }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');

  function enter(createNew) {
    const cleanName = name.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    const cleanRoom = createNew ? makeRoomId() : roomId.trim().toLowerCase();
    if (cleanName.length < 2 || cleanName.length > 32) return setError('Digite um nome entre 2 e 32 caracteres.');
    if (!/^[a-z0-9-]{4,48}$/.test(cleanRoom)) return setError('Digite um código de party válido.');
    onEnter({ name: cleanName, roomId: cleanRoom });
  }

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.hero}>
        <View style={styles.brandRow}><BrandMark /><View><Text style={styles.eyebrow}>MAP PARTY</Text><Text style={styles.brandCaption}>encontre sua turma</Text></View></View>
        <Text style={styles.heroTitle}>Todo mundo no{`\n`}mesmo mapa.</Text>
        <Text style={styles.heroSubtitle}>Crie um ponto de encontro, compartilhe a rota e acompanhe sua galera em tempo real.</Text>
        <View style={styles.heroLine}><View style={styles.heroLineFill} /><Text style={styles.heroLineText}>AO VIVO</Text></View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHandle} />
        <Text style={styles.cardKicker}>COMEÇAR AGORA</Text>
        <Text style={styles.cardTitle}>Como podemos chamar você?</Text>
        <Text style={styles.cardHint}>Seu nome aparece para as pessoas da party.</Text>

        <View style={styles.inputShell}>
          <Text style={styles.inputIcon}>✦</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ex.: Ana"
            placeholderTextColor="#94a3b8"
            autoCapitalize="words"
            maxLength={32}
            style={styles.input}
          />
        </View>
        <Pressable onPress={() => enter(true)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Criar uma party</Text><Text style={styles.primaryArrow}>→</Text>
        </Pressable>

        <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>OU ENTRE EM UMA EXISTENTE</Text><View style={styles.line} /></View>
        <View style={styles.joinRow}>
          <View style={[styles.inputShell, styles.roomShell]}>
            <Text style={styles.inputIcon}>#</Text>
            <TextInput
              value={roomId}
              onChangeText={setRoomId}
              placeholder="Código da party"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={48}
              style={styles.input}
            />
          </View>
          <Pressable onPress={() => enter(false)} style={({ pressed }) => [styles.joinButton, pressed && styles.pressed]}>
            <Text style={styles.joinText}>Entrar</Text>
          </Pressable>
        </View>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={styles.privacy}><Text style={styles.privacyIcon}>⌁</Text><Text style={styles.privacyText}>Sem cadastro. O convite é só um código.</Text></View>
        {__DEV__ && <Text style={styles.server}>desenvolvimento · {SERVER_URL}</Text>}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b172a' },
  container: { flex: 1 },
  hero: { flex: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 28, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandMark: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#152843', alignItems: 'center', justifyContent: 'center', marginRight: 12, overflow: 'hidden' },
  brandPin: { width: 22, height: 28, borderRadius: 14, borderWidth: 4, borderColor: '#b9f227', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  brandPinCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#b9f227' },
  brandOrbit: { position: 'absolute', width: 39, height: 17, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(185,242,39,0.45)', transform: [{ rotate: '-25deg' }] },
  eyebrow: { color: '#b9f227', letterSpacing: 2.2, fontSize: 12, fontWeight: '900' }, brandCaption: { color: '#8ea0b9', marginTop: 2, fontSize: 11 },
  heroTitle: { color: '#fff', fontSize: 42, lineHeight: 45, letterSpacing: -1.2, fontWeight: '900' },
  heroSubtitle: { maxWidth: 330, color: '#a7b5c9', fontSize: 15, lineHeight: 22 },
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 10 }, heroLineFill: { width: 34, height: 3, borderRadius: 2, backgroundColor: '#b9f227' }, heroLineText: { color: '#7f91aa', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 13, paddingBottom: Platform.OS === 'ios' ? 12 : 18, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: -8 }, elevation: 14 },
  cardHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#dbe3ed', marginBottom: 18 },
  cardKicker: { color: '#1a73e8', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 }, cardTitle: { marginTop: 6, color: '#10233e', fontSize: 23, fontWeight: '900', letterSpacing: -0.4 }, cardHint: { marginTop: 4, marginBottom: 16, color: '#718096', fontSize: 12 },
  inputShell: { height: 52, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d9e2ec', borderRadius: 15, paddingHorizontal: 14, backgroundColor: '#f8fafc' }, inputIcon: { width: 22, color: '#1a73e8', fontSize: 18, fontWeight: '900', textAlign: 'center', marginRight: 8 }, input: { flex: 1, height: 50, color: '#10233e', fontSize: 16 },
  primaryButton: { height: 54, marginTop: 11, borderRadius: 15, backgroundColor: '#1a73e8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#1a73e8', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 }, primaryText: { color: '#fff', fontSize: 16, fontWeight: '900' }, primaryArrow: { position: 'absolute', right: 17, color: '#b9f227', fontSize: 25, fontWeight: '500' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 18 }, line: { flex: 1, height: 1, backgroundColor: '#e8edf3' }, or: { color: '#9aa8b8', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  joinRow: { flexDirection: 'row', gap: 8 }, roomShell: { flex: 1 }, joinButton: { width: 82, borderRadius: 15, backgroundColor: '#eaf2ff', alignItems: 'center', justifyContent: 'center' }, joinText: { color: '#1557b0', fontSize: 14, fontWeight: '900' },
  error: { color: '#c62828', fontSize: 13, marginTop: 10 }, privacy: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 17, gap: 6 }, privacyIcon: { color: '#1a73e8', fontSize: 18 }, privacyText: { color: '#718096', fontSize: 11 }, server: { color: '#b4bfcc', fontSize: 9, marginTop: 9, textAlign: 'center' }, pressed: { opacity: 0.72 }
});
