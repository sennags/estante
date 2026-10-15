import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Global styles first so page styles can override them.
import './styles/global.css';
import './lib/settings';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
