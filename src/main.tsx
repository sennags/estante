import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Global styles first so page styles can override them.
import './styles/global.css';
import { App } from './App';
import { purgeTrash } from './db';

// Empty the trash of anything older than a week, now and every hour.
purgeTrash();
setInterval(purgeTrash, 60 * 60 * 1000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
