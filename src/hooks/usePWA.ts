/**
 * @file usePWA.ts
 * @description PWA功能管理Hook，整合Service Worker注册、更新提示和安装提示功能
 * @date 2026-05-04
 */
import { useState, useEffect, useCallback } from 'react';
import {
  registerServiceWorker,
  hasPendingUpdate,
  clearUpdateFlag,
  updateServiceWorker,
  skipWaitingAndReload,
} from '@/lib/serviceWorker';
import { initPWAInstall, promptInstall, canInstall, getPWAInstallState, PWAInstallState } from '@/lib/pwaInstall';

export interface PWAState {
  isSupported: boolean;
  isOnline: boolean;
  installState: PWAInstallState;
  hasUpdate: boolean;
  isLoading: boolean;
}

export function usePWA(): PWAState & {
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  checkUpdate: () => Promise<boolean>;
  applyUpdate: () => void;
} {
  const [isSupported] = useState(() => 'serviceWorker' in navigator);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [installState, setInstallState] = useState<PWAInstallState>(getPWAInstallState);
  const [hasUpdate, setHasUpdate] = useState(hasPendingUpdate);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    registerServiceWorker();
    initPWAInstall();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleInstallable = () => setInstallState(getPWAInstallState());
    const handleInstalled = () => setInstallState(getPWAInstallState());
    const handleUpdate = () => {
      setHasUpdate(true);
      clearUpdateFlag();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('pwa-installable', handleInstallable);
    window.addEventListener('pwa-installed', handleInstalled);
    window.addEventListener('sw-updated', handleUpdate);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('pwa-installable', handleInstallable);
      window.removeEventListener('pwa-installed', handleInstalled);
      window.removeEventListener('sw-updated', handleUpdate);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!canInstall()) {
      return 'unavailable';
    }
    const result = await promptInstall();
    setInstallState(getPWAInstallState());
    return result;
  }, []);

  const checkUpdate = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const success = await updateServiceWorker();
      if (success) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (hasPendingUpdate()) {
          setHasUpdate(true);
          clearUpdateFlag();
          return true;
        }
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const applyUpdate = useCallback(() => {
    skipWaitingAndReload();
  }, []);

  return {
    isSupported,
    isOnline,
    installState,
    hasUpdate,
    isLoading,
    install,
    checkUpdate,
    applyUpdate,
  };
}
