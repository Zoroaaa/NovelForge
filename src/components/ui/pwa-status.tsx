import { usePWA } from '@/hooks/usePWA';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, RefreshCw, Smartphone } from 'lucide-react';

export function PWAStatus() {
  const { isSupported, isOnline, installState, hasUpdate, checkUpdate, applyUpdate } = usePWA();

  if (!isSupported) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className={`flex items-center gap-1 ${isOnline ? 'text-green-600' : 'text-red-500'}`}>
        {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
        <span>{isOnline ? '在线' : '离线'}</span>
      </div>

      {installState.isStandalone && (
        <div className="flex items-center gap-1 text-purple-600">
          <Smartphone className="h-3 w-3" />
          <span>PWA模式</span>
        </div>
      )}

      {hasUpdate && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs gap-1"
          onClick={applyUpdate}
        >
          <RefreshCw className="h-3 w-3" />
          更新
        </Button>
      )}

      {!isOnline && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs gap-1"
          onClick={checkUpdate}
        >
          检查连接
        </Button>
      )}
    </div>
  );
}
