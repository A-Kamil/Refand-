import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { NewAudit } from './pages/NewAudit';
import { AnalysisProgress } from './pages/AnalysisProgress';
import { AuditResults } from './pages/AuditResults';
import { Investigation } from './pages/Investigation';
import { Claim } from './pages/Claim';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="audit/new" element={<NewAudit />} />
        <Route path="analyses/:id" element={<AnalysisProgress />} />
        <Route path="analyses/:id/results" element={<AuditResults />} />
        <Route path="discrepancies/:id" element={<Investigation />} />
        <Route path="discrepancies/:id/claim" element={<Claim />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="state state--empty">
      <h3>Page not found</h3>
    </div>
  );
}
