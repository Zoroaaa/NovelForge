interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export interface PWAInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  platform: string;
}

function getIsStandalone(): boolean {
  const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
  const isInWebAppiOS = ('standalone' in window.navigator) && (window.navigator as unknown as { standalone: boolean }).standalone;
  return isStandaloneMode || isInWebAppiOS;
}

function getIsInstalled(): boolean {
  return getIsStandalone() || window.matchMedia('(display-mode: fullscreen)').matches;
}

export function initPWAInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent('pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa-installed'));
    console.log('[PWA] 应用已安装到主屏幕');
  });
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) {
    return 'unavailable';
  }

  try {
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return result.outcome;
  } catch (error) {
    console.error('[PWA] 安装提示失败:', error);
    return 'dismissed';
  }
}

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

export function getPWAInstallState(): PWAInstallState {
  return {
    isInstallable: canInstall(),
    isInstalled: getIsInstalled(),
    isStandalone: getIsStandalone(),
    platform: navigator.platform || 'unknown',
  };
}

export function onInstallable(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('pwa-installable', handler);
  return () => window.removeEventListener('pwa-installable', handler);
}

export function onInstalled(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('pwa-installed', handler);
  return () => window.removeEventListener('pwa-installed', handler);
}
