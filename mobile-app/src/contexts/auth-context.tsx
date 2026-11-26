import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getStorageItem, setStorageItem, deleteStorageItem } from '../utils/storage';
import { CurrentUser, Store, AuthSession } from '../types';
import {
  apiClient,
  saveAuthTokens,
  clearAuthTokens,
  getStoredTokens,
  initApiConfig,
  setUnauthorizedHandler,
  saveActiveStoreId,
  getActiveStoreId,
} from '../services/api';

const USER_STORAGE_KEY = 'freshmart_user_profile';

interface AuthContextType {
  user: CurrentUser | null;
  activeStore: Store | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  switchStore: (store: Store) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      try {
        await initApiConfig();
        const { accessToken } = await getStoredTokens();

        if (accessToken) {
          const cachedUser = await getStorageItem(USER_STORAGE_KEY);
          if (cachedUser) {
            try {
              const parsedUser: CurrentUser = JSON.parse(cachedUser);
              setUser(parsedUser);

              const savedStoreId = await getActiveStoreId();
              const matchedStore =
                parsedUser.stores.find((s) => s.id === savedStoreId) || parsedUser.stores[0] || null;
              setActiveStore(matchedStore);
            } catch {
              // ignore corrupt cache
            }
          }

          try {
            const remoteUser = await apiClient<CurrentUser>('/auth/me');
            setUser(remoteUser);
            await setStorageItem(USER_STORAGE_KEY, JSON.stringify(remoteUser));

            const savedStoreId = await getActiveStoreId();
            const matchedStore =
              remoteUser.stores.find((s) => s.id === savedStoreId) || remoteUser.stores[0] || null;
            setActiveStore(matchedStore);
            if (matchedStore) {
              await saveActiveStoreId(matchedStore.id);
            }
          } catch (err: any) {
            // If 401/403, clear session; if network error, keep cached user for offline resilience
            if (err?.status === 401 || err?.status === 403) {
              await clearAuthTokens();
              await deleteStorageItem(USER_STORAGE_KEY);
              setUser(null);
              setActiveStore(null);
            }
          }
        }
      } catch (err) {
        console.error('Auth bootstrap error', err);
      } finally {
        setIsLoading(false);
      }
    }

    setUnauthorizedHandler(() => {
      setUser(null);
      setActiveStore(null);
    });

    bootstrap();
  }, []);

  const login = async (email: string, password: string): Promise<CurrentUser> => {
    setIsLoading(true);
    try {
      const result = await apiClient<AuthSession>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          client: 'mobile',
        }),
      });

      await saveAuthTokens(result.accessToken, result.refreshToken);
      await setStorageItem(USER_STORAGE_KEY, JSON.stringify(result.user));

      setUser(result.user);

      const defaultStore = result.user.stores[0] || null;
      setActiveStore(defaultStore);
      if (defaultStore) {
        await saveActiveStoreId(defaultStore.id);
      }

      return result.user;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await apiClient('/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    } finally {
      await clearAuthTokens();
      await deleteStorageItem(USER_STORAGE_KEY);
      setUser(null);
      setActiveStore(null);
    }
  };

  const switchStore = async (store: Store) => {
    setActiveStore(store);
    await saveActiveStoreId(store.id);
  };

  const refreshProfile = async () => {
    const remoteUser = await apiClient<CurrentUser>('/auth/me');
    setUser(remoteUser);
    await setStorageItem(USER_STORAGE_KEY, JSON.stringify(remoteUser));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        activeStore,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        switchStore,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
