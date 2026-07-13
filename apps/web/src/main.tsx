import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import './index.css';

import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import CreateTournamentPage from './pages/CreateTournamentPage';
import TournamentPage from './pages/TournamentPage';
import ImportPage from './pages/ImportPage';
import SimulatorPage from './pages/SimulatorPage';
import CertificatesPage from './pages/CertificatesPage';

const isDesktop =
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) ||
  import.meta.env.VITE_DESKTOP === '1';

const Router = isDesktop ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/tournaments/new" element={<CreateTournamentPage />} />
          <Route path="/tournaments/:id" element={<TournamentPage />} />
          <Route path="/tournaments/:id/import" element={<ImportPage />} />
          <Route path="/certificates" element={<CertificatesPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
        </Route>
      </Routes>
    </Router>
  </StrictMode>,
);
