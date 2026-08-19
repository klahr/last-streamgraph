// SPDX-License-Identifier: GPL-3.0-or-later
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SharePoster } from './components/SharePoster.tsx';
import { isSharePath, snapshotFragment } from './utils/shareUrl.ts';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

// A snapshot link branches before `App` mounts rather than inside it. `App`'s
// hooks sync with Last.fm and open IndexedDB on mount, and a shared chart must
// touch neither — routing here makes that structural instead of conditional.
const fragment = isSharePath() ? snapshotFragment() : '';

createRoot(root).render(
  <StrictMode>
    {isSharePath() ? <SharePoster fragment={fragment} /> : <App />}
  </StrictMode>,
);
