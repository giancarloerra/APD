// APD — Astrophotography Planning Dashboard
// Copyright © 2026 Giancarlo Erra — AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { LandingPage } from './components/LandingPage';
import { AboutPage } from './components/AboutPage';

function AuthenticatedDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    // Check DB health first, then auth
    fetch('/api/health')
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { window.location.href = '/'; return; }
        return fetch('/api/auth/check', { credentials: 'include' });
      })
      .then(r => { if (!r) return; if (r.ok) setAuthed(true); else window.location.href = `/login?r=${encodeURIComponent(window.location.pathname)}`; })
      .catch(() => window.location.href = `/login?r=${encodeURIComponent(window.location.pathname)}`);
  }, []);

  if (authed === null) return null;
  return <Dashboard />;
}

function App() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return <LandingPage />;
  if (path === '/about') return <AboutPage />;
  return <AuthenticatedDashboard />;
}

export default App;