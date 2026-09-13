import { useState, useEffect } from 'react';
import type { Snapshot, Item } from '../types';

// P1 占位：拉取 /data/today/snapshot.json（dev bridge 或构建期内联兜底）
// 命中失败时显示「无数据，先跑 npm run collect:once」提示
async function loadLatest(): Promise<Snapshot | null> {
  try {
    const res = await fetch('./data/today/snapshot.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Snapshot;
    return data;
  } catch {
    return null;
  }
}

export default function Page1HotStream() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLatest()
      .then((s) => {
        if (cancelled) return;
        setSnap(s);
      })
      .catch((e: unknown) => setErr(String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="text-text-2 py-8 text-center" data-testid="p1-loading">
        加载中…
      </div>
    );
  }
  if (err || !snap) {
    return (
      <div className="border border-border rounded-lg bg-surface p-6" data-testid="p1-empty">
        <h2 className="text-lg font-semibold mb-2">暂无采集数据</h2>
        <p className="text-text-2 text-sm leading-relaxed">
          这是 P1 占位页面。先跑 <code className="bg-surface-2 px-1.5 py-0.5 rounded">npm run collect:once</code> 触发采集，
          产物会通过 dev bridge 暴露到 <code className="bg-surface-2 px-1.5 py-0.5 rounded">/data/today/snapshot.json</code>。
          <br />
          {err && <span className="text-warn">错误：{err}</span>}
        </p>
      </div>
    );
  }

  const items: Item[] = snap.items ?? [];

  return (
    <div data-testid="p1-root">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold">当天聚合热榜流</h1>
        <span className="text-text-3 text-sm">
          {snap.date} · 共 {items.length} 条 · {snap.stats.sourceOk}/{snap.stats.sourceTotal} 源 OK
        </span>
      </div>
      <ul className="space-y-3">
        {items.map((it) => (
          <li
            key={it.id}
            className="border border-border rounded-lg bg-surface p-4 hover:border-brand/40 transition-colors"
            data-testid="p1-item"
            data-item-id={it.id}
            data-channel-id={it.channelId}
          >
            <div className="flex items-center gap-2 text-xs text-text-3 mb-1">
              <span>{it.channelName}</span>
              {it.category?.map((c) => (
                <span
                  key={c}
                  className="px-1.5 py-0.5 rounded bg-surface-2 text-text-2"
                  data-testid="p1-cat"
                >
                  {c}
                </span>
              ))}
              {it.isNew && (
                <span className="px-1.5 py-0.5 rounded bg-brand/20 text-brand">NEW</span>
              )}
            </div>
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-1 font-medium hover:text-brand no-underline"
              data-testid="p1-title"
            >
              {it.title}
            </a>
            {it.summary && (
              <p className="text-text-2 text-sm mt-2 line-clamp-2" data-testid="p1-summary">
                {it.summary}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}