import { Routes, Route, Link } from 'react-router-dom';
import Page1HotStream from './pages/Page1HotStream';

// ARCHITECTURE §4.1/§6.1 — 页面1 是 MVP 必上；其余 4 个页面 P3 完整实现
export default function App() {
  return (
    <div className="min-h-screen bg-bg text-text-1">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
          <Link to="/" className="font-semibold text-text-1 no-underline hover:text-text-1">
            RSS Radar
          </Link>
          <span className="text-text-3 text-sm">聚合热榜流 · P1 占位</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Page1HotStream />} />
        </Routes>
      </main>
    </div>
  );
}