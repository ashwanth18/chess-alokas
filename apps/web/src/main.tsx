import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import CreateTournamentPage from './pages/CreateTournamentPage';
import TournamentPage from './pages/TournamentPage';
import ImportPage from './pages/ImportPage';
import SimulatorPage from './pages/SimulatorPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/tournaments/new" element={<CreateTournamentPage />} />
          <Route path="/tournaments/:id" element={<TournamentPage />} />
          <Route path="/tournaments/:id/import" element={<ImportPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
