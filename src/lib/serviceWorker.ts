/**
 * @file serviceWorker.ts
 * @description Service Worker注册与更新管理工具函数
 * @date 2026-05-04
 */
const SW_REGISTERED = 'novelforge-sw-registered';
const SW_UPDATE = 'novelforge-sw-update';

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = `/sw.js`;

      navigator.serviceWorker
        .register(swUrl)
        .then((registration) => {
          console.log('[PWA] Service Worker 注册成功:', registration.scope);

          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    localStorage.setItem(SW_UPDATE, 'true');
                    window.dispatchEvent(new CustomEvent('sw-updated'));
                    console.log('[PWA] 新内容可用，请刷新页面');
                  } else {
                    console.log('[PWA] 内容已缓存用于离线使用');
                  }
                }
              };
            }
          };

          localStorage.setItem(SW_REGISTERED, 'true');
        })
        .catch((error) => {
          console.error('[PWA] Service Worker 注册失败:', error);
        });
    });
  }
}

export async function unregisterServiceWorker(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
      localStorage.removeItem(SW_REGISTERED);
      console.log('[PWA] Service Worker 已注销');
    }
  }
}

export function isServiceWorkerRegistered(): boolean {
  return localStorage.getItem(SW_REGISTERED) === 'true';
}

export function hasPendingUpdate(): boolean {
  return localStorage.getItem(SW_UPDATE) === 'true';
}

export function clearUpdateFlag(): void {
  localStorage.removeItem(SW_UPDATE);
}

export async function updateServiceWorker(): Promise<boolean> {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      try {
        await registration.update();
        return true;
      } catch (error) {
        console.error('[PWA] 更新 Service Worker 失败:', error);
        return false;
      }
    }
  }
  return false;
}

export function skipWaitingAndReload(): void {
  if ('serviceWorker' in navigator) {
    const worker = navigator.serviceWorker.controller;
    if (worker) {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
  }
  window.location.reload();
}
