// 依赖
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { theme } from './theme';
import { startPerformanceTelemetry } from './services/performance';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      {/* CssBaseline 提供 normalize + 排版默认；Tailwind preflight 已关，避免冲突 */}
      <CssBaseline />
      {/* HashRouter — 避免 GH Pages 子路径刷新 404 (ARCHITECTURE §7.2) */}
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);

startPerformanceTelemetry();
