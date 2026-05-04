/**
 * @file pwa-install-prompt.tsx
 * @description PWA安装提示组件 - 检测到可安装时显示引导用户安装应用的横幅
 * @date 2026-05-04
 */
import { useState, useEffect } from 'react';
import { usePWA } from '@/hooks/usePWA';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';

export function PWAInstallPrompt() {
  const {
    isSupported,
    isOnline,
    installState,
    hasUpdate,
    isLoading,
    install,
    checkUpdate,
    applyUpdate,
  } = usePWA();

  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(!isOnline);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowOfflineBanner(!isOnline);
  }, [isOnline]);

  useEffect(() => {
    if (hasUpdate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowUpdateBanner(true);
    }
  }, [hasUpdate]);

  useEffect(() => {
    if (installState.isInstallable && !installState.isInstalled) {
      const timer = setTimeout(() => setShowInstallPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [installState.isInstallable, installState.isInstalled]);

  if (!isSupported) return null;

  const handleInstall = async () => {
    const result = await install();
    if (result === 'accepted') {
      setShowInstallPrompt(false);
    }
  };

  return (
    <>
      {showOfflineBanner && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black px-4 py-2 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4" />
            <span className="text-sm font-medium">当前处于离线模式，部分功能可能不可用</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowOfflineBanner(false)}
            className="text-black hover:bg-yellow-600"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {showUpdateBanner && (
        <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 bg-indigo-600 text-white rounded-lg shadow-xl p-4 animate-slide-up">
          <div className="flex items-start gap-3">
            <RefreshCw className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">发现新版本</p>
              <p className="text-xs opacity-90 mt-1">应用有可用更新，点击刷新以获取最新功能</p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={applyUpdate}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading ? '更新中...' : '立即更新'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowUpdateBanner(false)}
                  className="text-white hover:bg-indigo-700"
                >
                  稍后
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInstallPrompt && installState.isInstallable && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg shadow-xl p-4 animate-slide-up">
          <div className="flex items-start gap-3">
            <Download className="h-6 w-6 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">安装 NovelForge</p>
              <p className="text-sm opacity-90 mt-1">
                安装到主屏幕，获得更快的访问速度和离线使用体验
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleInstall}
                  className="flex-1 bg-white text-indigo-600 hover:bg-gray-100"
                >
                  立即安装
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowInstallPrompt(false)}
                  className="text-white hover:bg-white/10"
                >
                  暂不
                </Button>
              </div>
            </div>
            <button
              onClick={() => setShowInstallPrompt(false)}
              className="absolute top-2 right-2 p-1 hover:bg-white/10 rounded transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
