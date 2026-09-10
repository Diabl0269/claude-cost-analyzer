import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './design/tokens.css';
import './design/base.css';
import './design/typography.css';
import './design/utilities.css';
import { App } from './app/App';
import { applyTheme, readStoredTheme } from './lib/theme';

// Set the theme before the first paint so there is no flash of the wrong palette.
applyTheme(readStoredTheme());

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
