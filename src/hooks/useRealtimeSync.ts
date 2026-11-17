import {useEffect, useRef, useState} from 'react';
import {useOnlineStatus} from './usePWA';
import type {RealtimeSyncTelemetry, ReportStatus} from '../types/opcms';

export type FreshnessState = 'LIVE' | 'SYNCING' | 'DELAYED' | 'OFFLINE';

export interface LastReportNotification {
  report_id: string;
  woreda_name: string;
  zone_name: string;
  day_label: string;
  status: ReportStatus;
  received_at: string;
}

export function useRealtimeSync(params: {
  token: string | null;
  pendingCount: number;
  isSyncingQueue: boolean;
  initialTelemetry?: RealtimeSyncTelemetry | null;
  onRemoteUpdate: () => void;
}) {
  const {token, pendingCount, isSyncingQueue, initialTelemetry, onRemoteUpdate} = params;
  const isOnline = useOnlineStatus();
  const [sseConnected, setSseConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(
    () => initialTelemetry?.last_server_event_at || null,
  );
  const [lastReportReceived, setLastReportReceived] = useState<LastReportNotification | null>(
    () => initialTelemetry?.last_report_received || null,
  );
  const [isStale, setIsStale] = useState(false);

  const callbackRef = useRef(onRemoteUpdate);
  callbackRef.current = onRemoteUpdate;
  const lastEventMsRef = useRef<number>(Date.now());

  useEffect(() => {
    if (initialTelemetry?.last_server_event_at) {
      setLastSyncAt((prev) => prev || initialTelemetry.last_server_event_at);
    }
    if (initialTelemetry?.last_report_received) {
      setLastReportReceived(initialTelemetry.last_report_received);
    }
  }, [initialTelemetry]);

  useEffect(() => {
    if (!token || !isOnline) {
      setSseConnected(false);
      return;
    }

    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      const url = `/api/v1/events/stream?token=${encodeURIComponent(token)}`;
      source = new EventSource(url);

      source.onopen = () => {
        setSseConnected(true);
        setIsStale(false);
        lastEventMsRef.current = Date.now();
        setLastSyncAt(new Date().toISOString());
      };

      source.addEventListener('connected', (ev) => {
        setSseConnected(true);
        setIsStale(false);
        lastEventMsRef.current = Date.now();
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          if (data.last_report_received) {
            setLastReportReceived(data.last_report_received);
          }
          setLastSyncAt(data.server_time || new Date().toISOString());
        } catch {
          // ignore
        }
      });

      source.addEventListener('heartbeat', (ev) => {
        lastEventMsRef.current = Date.now();
        setIsStale(false);
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          setLastSyncAt(data.server_time || new Date().toISOString());
        } catch {
          setLastSyncAt(new Date().toISOString());
        }
      });

      const handleDomainEvent = (ev: Event) => {
        lastEventMsRef.current = Date.now();
        setIsStale(false);
        const now = new Date().toISOString();
        setLastSyncAt(now);
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          if (data.woreda_name) {
            setLastReportReceived({
              report_id: data.report_id,
              woreda_name: data.woreda_name,
              zone_name: data.zone_name || '',
              day_label: data.day_label || '',
              status: data.status || 'Submitted',
              received_at: data.received_at || now,
            });
          }
        } catch {
          // ignore
        }
        callbackRef.current();
      };

      source.addEventListener('report:received', handleDomainEvent);
      source.addEventListener('report:workflow', handleDomainEvent);
      source.addEventListener('alert:updated', handleDomainEvent);
      source.addEventListener('gis:updated', handleDomainEvent);

      source.onerror = () => {
        setSseConnected(false);
        source?.close();
        if (!closed && navigator.onLine) {
          reconnectTimer = window.setTimeout(connect, 5000);
        }
      };
    };

    connect();

    const freshnessInterval = window.setInterval(() => {
      if (!navigator.onLine) {
        setIsStale(true);
        return;
      }
      const elapsed = Date.now() - lastEventMsRef.current;
      setIsStale(elapsed > 40000);
    }, 10000);

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(freshnessInterval);
    };
  }, [token, isOnline]);

  let freshnessState: FreshnessState = 'LIVE';
  if (!isOnline) {
    freshnessState = 'OFFLINE';
  } else if (isSyncingQueue) {
    freshnessState = 'SYNCING';
  } else if (!sseConnected || isStale) {
    freshnessState = 'DELAYED';
  }

  return {
    freshnessState,
    isOnline,
    sseConnected,
    isStale: !isOnline || isStale || !sseConnected,
    lastSyncAt,
    pendingCount,
    lastReportReceived,
  };
}
