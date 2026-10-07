import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import { CONNECTIVITY_LEVEL, voiceCapabilities } from '../connectivity';

function readableSpeechError(event) {
  const raw = event?.message ?? event?.detail ?? event?.error;
  const detail = raw && typeof raw === 'object' ? raw.detail || raw.message || raw.error : raw;
  const value = String(detail || '').trim();
  const normalized = value.toLowerCase();
  if (normalized === 'bad request' || normalized.includes('bad request')) return 'O serviço de voz recusou esta tentativa. Verifique a conexão e tente falar novamente.';
  if (normalized.includes('service-not-allowed') || normalized.includes('language-not-supported')) return 'O reconhecimento de voz não está disponível no iPhone. Ative Siri e Ditado e tente novamente.';
  if (normalized.includes('no-speech')) return 'Não ouvi uma frase. Fale novamente após tocar no microfone.';
  if (normalized.includes('network') || normalized.includes('internet')) return 'O reconhecimento de voz precisa de conexão. Tente novamente quando a rede estabilizar.';
  if (normalized.includes('permission') || normalized.includes('not allowed')) return 'Permita o microfone e o reconhecimento de voz nas configurações.';
  return value || 'Não foi possível reconhecer a fala.';
}

function recognitionOptions(voiceMode) {
  return {
    lang: 'pt-BR',
    interimResults: voiceMode.interimResults,
    // No iOS cada turno precisa terminar ao detectar silêncio. O hook mantém
    // a sessão contínua e reinicia o reconhecimento depois da resposta.
    continuous: Platform.OS === 'ios' ? false : voiceMode.continuous,
    ...(Platform.OS === 'ios'
      ? {
          iosTaskHint: 'search',
          iosCategory: {
            category: 'playAndRecord',
            categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
            mode: 'measurement'
          },
          iosVoiceProcessingEnabled: true
        }
      : { androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' } })
  };
}

export function useSpeechAssistant({ onFinalTranscript, connectivityLevel = CONNECTIVITY_LEVEL.RICH }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const keepSessionRef = useRef(false);
  const processingRef = useRef(false);
  const restartTimerRef = useRef(null);
  const restartAttemptRef = useRef(0);
  const startInFlightRef = useRef(false);
  const voiceMode = voiceCapabilities(connectivityLevel);
  const voiceModeRef = useRef(voiceMode);
  const callbackRef = useRef(onFinalTranscript);
  voiceModeRef.current = voiceMode;
  const nativeModule = useMemo(() => requireOptionalNativeModule('ExpoSpeechRecognition'), []);
  callbackRef.current = onFinalTranscript;
  useEffect(() => {
    if (!nativeModule) return undefined;
    const emitter = new EventEmitter(nativeModule);
    const restart = () => {
      if (!voiceModeRef.current.continuous || !keepSessionRef.current || processingRef.current || restartTimerRef.current) return;
      const delay = Math.min(1_200, 350 + restartAttemptRef.current * 150);
      restartAttemptRef.current += 1;
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!keepSessionRef.current) return;
        Promise.resolve(nativeModule.start(recognitionOptions(voiceModeRef.current))).then(() => {
          restartAttemptRef.current = 0;
        }).catch(() => {
          if (keepSessionRef.current) restart();
        });
      }, delay);
    };
    const subscriptions = [
      emitter.addListener('start', () => setListening(true)),
      emitter.addListener('end', () => {
        if (!keepSessionRef.current) setListening(false);
        else if (voiceModeRef.current.continuous) restart();
        else setListening(false);
      }),
      emitter.addListener('result', (event) => {
        const text = event.results?.[0]?.transcript || '';
        setTranscript(text);
        if (event.isFinal && text.trim() && !processingRef.current) {
          processingRef.current = true;
          // A sessão contínua continua ativa enquanto o assistente processa
          // e fala a resposta; ela será reiniciada no finally abaixo.
          Promise.resolve(nativeModule.stop()).catch(() => undefined);
          Promise.resolve(callbackRef.current?.(text.trim())).then(() => undefined, () => undefined).finally(() => {
            processingRef.current = false;
            if (voiceModeRef.current.continuous) restart();
          });
        }
      }),
      emitter.addListener('error', (event) => {
        setError(readableSpeechError(event));
        if (!keepSessionRef.current) setListening(false);
        else if (voiceModeRef.current.continuous) restart();
      })
    ];
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
      Promise.resolve(nativeModule.stop()).catch(() => undefined);
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [nativeModule]);
  const start = useCallback(async () => {
    setError('');
    if (!nativeModule) {
      setError('O reconhecimento de voz estará disponível no build nativo atualizado.');
      return false;
    }
    if (startInFlightRef.current) return true;
    keepSessionRef.current = true;
    restartAttemptRef.current = 0;
    startInFlightRef.current = true;
    try {
      const permission = await nativeModule.requestPermissionsAsync();
      if (!permission?.granted) {
        keepSessionRef.current = false;
        setError('Permita o microfone e o reconhecimento de voz para falar com o assistente.');
        return false;
      }
      if (typeof nativeModule.isRecognitionAvailable === 'function' && !nativeModule.isRecognitionAvailable()) {
        setError('O reconhecimento de voz não está disponível no aparelho. Ative Siri e Ditado e tente novamente.');
        keepSessionRef.current = false;
        return false;
      }
      await nativeModule.start(recognitionOptions(voiceMode));
      return true;
    } catch (error) {
      keepSessionRef.current = false;
      setListening(false);
      setError(readableSpeechError(error));
      return false;
    } finally {
      startInFlightRef.current = false;
    }
  }, [nativeModule, voiceMode.continuous, voiceMode.interimResults]);
  const stop = useCallback(() => {
    keepSessionRef.current = false;
    processingRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    restartAttemptRef.current = 0;
    Promise.resolve(nativeModule?.stop()).catch(() => undefined);
    setListening(false);
  }, [nativeModule]);
  return { listening, transcript, error, start, stop };
}
