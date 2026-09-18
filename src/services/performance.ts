export interface PerformanceMetrics {
  lcp?: number;
  cls?: number;
  inp?: number;
  resources: Array<{ name: string; duration: number; transferSize: number }>;
}

declare global {
  interface Window {
    __RSS_RADAR_PERF__?: PerformanceMetrics;
  }
}

/** 轻量 Web Vitals 采集：只写入内存并派发事件，不上传任何数据。 */
export function startPerformanceTelemetry(): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return () => undefined;
  const metrics: PerformanceMetrics = { resources: [] };
  window.__RSS_RADAR_PERF__ = metrics;
  const observers: PerformanceObserver[] = [];
  const emit = (): void => {
    window.dispatchEvent(new CustomEvent('rss-radar:performance', { detail: metrics }));
  };
  const observe = (type: string, handler: (entry: PerformanceEntry) => void, options?: PerformanceObserverInit): void => {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(handler));
    observer.observe({ type, buffered: true, ...options });
    observers.push(observer);
  };
  observe('largest-contentful-paint', (entry) => { metrics.lcp = entry.startTime; emit(); });
  observe('layout-shift', (entry) => {
    const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
    if (!shift.hadRecentInput) metrics.cls = (metrics.cls ?? 0) + (shift.value ?? 0);
    emit();
  });
  observe('event', (entry) => {
    const event = entry as PerformanceEntry & { duration?: number };
    metrics.inp = Math.max(metrics.inp ?? 0, event.duration ?? 0);
    emit();
  }, { durationThreshold: 40 } as PerformanceObserverInit);
  observe('resource', (entry) => {
    const resource = entry as PerformanceResourceTiming;
    if (/latest\.json|snapshot-|report-/.test(resource.name)) {
      metrics.resources.push({ name: resource.name, duration: resource.duration, transferSize: resource.transferSize });
      emit();
    }
  });
  return () => observers.forEach((observer) => observer.disconnect());
}
