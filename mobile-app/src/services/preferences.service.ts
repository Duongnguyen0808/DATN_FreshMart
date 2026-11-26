import { getStorageItem, setStorageItem } from '../utils/storage';

const PREFS_KEY = 'freshmart_user_prefs_v2';

export interface UserPreferences {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
}

const DEFAULT_PREFS: UserPreferences = {
  soundEnabled: true,
  hapticsEnabled: true,
  notificationsEnabled: true,
};

let memoryPrefs: UserPreferences = { ...DEFAULT_PREFS };

export async function loadUserPreferences(): Promise<UserPreferences> {
  try {
    const raw = await getStorageItem(PREFS_KEY);
    if (raw) {
      memoryPrefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    }
  } catch {
    // fallback to defaults
  }
  return { ...memoryPrefs };
}

export async function saveUserPreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
  memoryPrefs = { ...memoryPrefs, ...patch };
  try {
    await setStorageItem(PREFS_KEY, JSON.stringify(memoryPrefs));
  } catch {
    // ignore storage failure
  }
  return { ...memoryPrefs };
}

export function getCachedPreferences(): UserPreferences {
  return memoryPrefs;
}
