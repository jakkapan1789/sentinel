import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (bundled — no CDN request).
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/500.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import App from './App';
import { RefreshProvider } from './lib/refresh';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RefreshProvider>
      <App />
    </RefreshProvider>
  </React.StrictMode>,
);
