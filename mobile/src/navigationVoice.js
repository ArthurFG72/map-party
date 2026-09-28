import * as Speech from 'expo-speech';
import { planNavigationSpeech } from './navigationSpeechPlanner';

export function speakNavigationGuidance(guidance, previous, now = Date.now()) {
  const next = planNavigationSpeech(guidance, previous, now);
  if (next.text) {
    Speech.stop();
    Speech.speak(next.text, { language: 'pt-BR', rate: 0.95 });
  }
  return next.previous;
}

export function stopNavigationVoice() {
  Speech.stop();
}

export function speakAssistantText(text) {
  if (!text) return Promise.resolve();
  Speech.stop();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, Math.max(12_000, String(text).length * 180));
    Speech.speak(String(text), { language: 'pt-BR', rate: 0.95, onDone: finish, onStopped: finish, onError: finish });
  });
}
