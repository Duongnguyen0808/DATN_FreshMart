import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';
import { getCachedPreferences } from './preferences.service';

const BEEP_WAV_BASE64 =
  'data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU' +
  'NvT19AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA' +
  'QEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA' +
  'QEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA';

let cachedPlayer: any = null;

export async function triggerScanSuccessFeedback() {
  const prefs = getCachedPreferences();

  if (prefs.hapticsEnabled) {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    }
  }

  if (prefs.soundEnabled) {
    try {
      if (!cachedPlayer) {
        cachedPlayer = createAudioPlayer({ uri: BEEP_WAV_BASE64 });
      }
      if (cachedPlayer) {
        cachedPlayer.seekTo(0);
        cachedPlayer.play();
      }
    } catch {
      // Non-blocking in silent mode
    }
  }
}

export async function triggerWarningFeedback() {
  if (!getCachedPreferences().hapticsEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {}
}

export async function triggerErrorFeedback() {
  if (!getCachedPreferences().hapticsEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {}
}
