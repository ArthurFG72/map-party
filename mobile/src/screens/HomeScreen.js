import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SERVER_URL } from '../config';
import { isHairLossNickname } from '../nicknamePolicy';

const GLOBAL_ROOM_ID = 'global';

function BrandMark() {
  return <View style={styles.brandMark}>
    <View style={styles.brandPin}><View style={styles.brandPinCore} /></View>
    <View style={styles.brandOrbit} />
  </View>;
}

export default function HomeScreen({ onEnter }) {
  const [name, setName] = useState('');
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState('');
  const [forbiddenAttempts, setForbiddenAttempts] = useState(0);

  function enter() {
    const cleanName = name.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    const cleanRoom = GLOBAL_ROOM_ID;
    if (cleanName.length < 2 || cleanName.length > 32) return setError('Digite um nome entre 2 e 32 caracteres.');
    if (isHairLossNickname(cleanName)) {
      const attempts = forbiddenAttempts + 1;
      setForbiddenAttempts(attempts);
      const warning = attempts > 3
        ? 'Você será banido se continuar desobedecendo esta regra.'
        : 'Apelidos relacionados à falta de cabelo não são permitidos.';
      setError(warning);
      Alert.alert(attempts > 3 ? 'AVISO DE BANIMENTO' : 'Apelido não permitido', warning, [{ text: 'Entendi' }]);
      return;
    }
    setForbiddenAttempts(0);
    setError('');
    if (!/^[a-z0-9-]{4,48}$/.test(cleanRoom)) return setError('Digite um código de party válido.');
    onEnter({ name: `A-${cleanName}`, clientCode: 'AGUIA', roomId: cleanRoom, visible });
  }

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.hero}>
        <View style={styles.brandRow}><BrandMark /><View><Text style={styles.eyebrow}>AGUIA · MAP PARTY</Text><Text style={styles.brandCaption}>identificador seguro do cliente</Text></View></View>
        <Text style={styles.heroTitle}>Passeio das Águias</Text>
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
        <Pressable onPress={enter} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Entrar no mapa</Text><Text style={styles.primaryArrow}>→</Text>
        </Pressable>
        <Pressable onPress={() => setVisible((current) => !current)} style={styles.visibilityRow} accessibilityRole="checkbox" accessibilityState={{ checked: visible }}>
          <Text style={styles.visibilityBox}>{visible ? '✓' : ''}</Text>
          <Text style={styles.visibilityText}>Compartilhar minha posição com a party</Text>
        </Pressable>

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
  error: { color: '#c62828', fontSize: 13, marginTop: 10 }, visibilityRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }, visibilityBox: { width: 22, height: 22, borderWidth: 1, borderColor: '#1a73e8', borderRadius: 6, color: '#1a73e8', textAlign: 'center', lineHeight: 20, fontWeight: '900' }, visibilityText: { color: '#475569', fontSize: 12, flex: 1 }, privacy: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 17, gap: 6 }, privacyIcon: { color: '#1a73e8', fontSize: 18 }, privacyText: { color: '#718096', fontSize: 11 }, server: { color: '#b4bfcc', fontSize: 9, marginTop: 9, textAlign: 'center' }, pressed: { opacity: 0.72 }
});
