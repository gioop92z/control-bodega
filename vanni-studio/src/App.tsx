import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './lib/auth';
import { useFirstRunSeed } from './lib/profile';
import { setStoreErrorHandler } from './lib/store';
import { ToastProvider, useToast } from './components/toast';
import { Layout } from './components/Layout';
import { Empty, Spinner } from './components/ui';
import { AuthScreen } from './modules/Auth';
import { DashboardPage } from './modules/Dashboard';

const InstagramPostsPage = lazy(() => import('./modules/InstagramPosts').then((m) => ({ default: m.InstagramPostsPage })));
const AudiencePage = lazy(() => import('./modules/Audience').then((m) => ({ default: m.AudiencePage })));
const SetupMetaPage = lazy(() => import('./modules/SetupMeta').then((m) => ({ default: m.SetupMetaPage })));
const SeriesDetailPage = lazy(() => import('./modules/Series').then((m) => ({ default: m.SeriesDetailPage })));
const SeriesListPage = lazy(() => import('./modules/Series').then((m) => ({ default: m.SeriesListPage })));
const EpisodeEditorPage = lazy(() => import('./modules/Episodes').then((m) => ({ default: m.EpisodeEditorPage })));
const ProductionPage = lazy(() => import('./modules/Episodes').then((m) => ({ default: m.ProductionPage })));
const IdeaEditorPage = lazy(() => import('./modules/Lab').then((m) => ({ default: m.IdeaEditorPage })));
const LabPage = lazy(() => import('./modules/Lab').then((m) => ({ default: m.LabPage })));
const BodyPage = lazy(() => import('./modules/Body').then((m) => ({ default: m.BodyPage })));
const GoalsPage = lazy(() => import('./modules/Goals').then((m) => ({ default: m.GoalsPage })));
const JourneyPage = lazy(() => import('./modules/Journey').then((m) => ({ default: m.JourneyPage })));
const MonthPage = lazy(() => import('./modules/Journey').then((m) => ({ default: m.MonthPage })));
const YearPage = lazy(() => import('./modules/Journey').then((m) => ({ default: m.YearPage })));
const BrandPage = lazy(() => import('./modules/Brand').then((m) => ({ default: m.BrandPage })));
const FinancePage = lazy(() => import('./modules/Finance').then((m) => ({ default: m.FinancePage })));
const MediaKitPage = lazy(() => import('./modules/MediaKit').then((m) => ({ default: m.MediaKitPage })));
const GymDetailPage = lazy(() => import('./modules/Gyms').then((m) => ({ default: m.GymDetailPage })));
const GymsPage = lazy(() => import('./modules/Gyms').then((m) => ({ default: m.GymsPage })));
const CollectionDetailPage = lazy(() => import('./modules/Collections').then((m) => ({ default: m.CollectionDetailPage })));
const CollectionsPage = lazy(() => import('./modules/Collections').then((m) => ({ default: m.CollectionsPage })));
const NotesPage = lazy(() => import('./modules/Notes').then((m) => ({ default: m.NotesPage })));
const SettingsPage = lazy(() => import('./modules/Settings').then((m) => ({ default: m.SettingsPage })));
const MorePage = lazy(() => import('./modules/More').then((m) => ({ default: m.MorePage })));
const AgendaPage = lazy(() => import('./modules/Agenda').then((m) => ({ default: m.AgendaPage })));
const TasksPage = lazy(() => import('./modules/Tasks').then((m) => ({ default: m.TasksPage })));
const AnalysisPage = lazy(() => import('./modules/Analysis').then((m) => ({ default: m.AnalysisPage })));
const InstagramPage = lazy(() => import('./modules/Instagram').then((m) => ({ default: m.InstagramPage })));

function Shell() {
  const toast = useToast();
  useEffect(() => { setStoreErrorHandler((m) => toast(m, 'error')); }, [toast]);
  useFirstRunSeed();
  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/instagram" element={<InstagramPage />} />
        <Route path="/instagram/publicaciones" element={<InstagramPostsPage />} />
        <Route path="/instagram/audiencia" element={<AudiencePage />} />
        <Route path="/analisis" element={<AnalysisPage />} />
        <Route path="/configurar-meta" element={<SetupMetaPage />} />
        <Route path="/series" element={<SeriesListPage />} />
        <Route path="/series/:id" element={<SeriesDetailPage />} />
        <Route path="/episodios/:id" element={<EpisodeEditorPage />} />
        <Route path="/produccion" element={<ProductionPage />} />
        <Route path="/laboratorio" element={<LabPage />} />
        <Route path="/laboratorio/:id" element={<IdeaEditorPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/tareas" element={<TasksPage />} />
        <Route path="/evolucion" element={<BodyPage />} />
        <Route path="/objetivos" element={<GoalsPage />} />
        <Route path="/journey" element={<JourneyPage />} />
        <Route path="/journey/anual/:year" element={<YearPage />} />
        <Route path="/journey/:month" element={<MonthPage />} />
        <Route path="/marca" element={<BrandPage />} />
        <Route path="/finanzas" element={<FinancePage />} />
        <Route path="/media-kit" element={<MediaKitPage />} />
        <Route path="/gimnasios" element={<GymsPage />} />
        <Route path="/gimnasios/ranking" element={<GymsPage key="ranking" />} />
        <Route path="/gimnasios/:id" element={<GymDetailPage />} />
        <Route path="/colecciones" element={<CollectionsPage />} />
        <Route path="/colecciones/:id" element={<CollectionDetailPage />} />
        <Route path="/notas" element={<NotesPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="/mas" element={<MorePage />} />
        <Route path="*" element={<Empty title="Página no encontrada" />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth"><Spinner label="Abriendo VANNI STUDIO…" /></div>;
  if (!user) return <AuthScreen />;
  return <Shell />;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <Gate />
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
