/**
 * Voice Dictation & Voice Alert TTS for English, Telugu, and Hindi.
 */

import { SupportedLanguage } from './storage';

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  shortTag: string;
  reminderPrefix: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    code: 'en-IN',
    label: 'English',
    shortTag: 'EN',
    reminderPrefix: 'Note alert:',
  },
  {
    code: 'te-IN',
    label: 'Telugu',
    shortTag: 'TE',
    reminderPrefix: 'నోట్ అలర్ట్:',
  },
  {
    code: 'hi-IN',
    label: 'Hindi',
    shortTag: 'HI',
    reminderPrefix: 'नोट अलर्ट:',
  },
];

export function getLanguageMeta(code: SupportedLanguage): LanguageOption {
  return LANGUAGE_OPTIONS.find((l) => l.code === code) || LANGUAGE_OPTIONS[0];
}

export function playReminderChime(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        resolve();
        return;
      }
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(523.25, now);
      osc1.frequency.setValueAtTime(659.25, now + 0.18);

      osc2.frequency.setValueAtTime(261.63, now);
      osc2.frequency.setValueAtTime(329.63, now + 0.18);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.56);
      osc2.stop(now + 0.56);

      setTimeout(() => {
        ctx.close().catch(() => {});
        resolve();
      }, 600);
    } catch {
      resolve();
    }
  });
}

export async function announceVoiceReminder(
  title: string,
  content: string,
  language: SupportedLanguage,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  await playReminderChime();

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onStart?.();
    setTimeout(() => onEnd?.(), 1500);
    return;
  }

  window.speechSynthesis.cancel();

  const langMeta = getLanguageMeta(language);
  const spokenText = [langMeta.reminderPrefix, title, content]
    .filter(Boolean)
    .join('. ');

  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = language;
  utterance.rate = 0.96;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const langPrefix = language.split('-')[0].toLowerCase();
  const matchedVoice =
    voices.find((v) => v.lang.toLowerCase() === language.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));

  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
}

export function pauseVoiceAnnouncement(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
    }
  }
}

export function resumeVoiceAnnouncement(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }
}

export function stopVoiceAnnouncement(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
