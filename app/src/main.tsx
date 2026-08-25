import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
