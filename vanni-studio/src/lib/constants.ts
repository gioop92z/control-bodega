import type { DealStatus, EpisodeStatus } from './types';

export const EPISODE_STAGES: Array<{ key: EpisodeStatus; label: string }> = [
  { key: 'idea', label: 'Idea' },
  { key: 'planeacion', label: 'Planeación' },
  { key: 'grabacion', label: 'Grabación' },
  { key: 'edicion', label: 'Edición' },
  { key: 'programado', label: 'Programado' },
  { key: 'publicado', label: 'Publicado' },
  { key: 'analizado', label: 'Analizado' },
];
export const stageLabel = (k: string) => EPISODE_STAGES.find((s) => s.key === k)?.label ?? k;

export const DEAL_STAGES: Array<{ key: DealStatus; label: string }> = [
  { key: 'por_contactar', label: 'Por contactar' },
  { key: 'contactado', label: 'Contactado' },
  { key: 'negociacion', label: 'Negociación' },
  { key: 'confirmado', label: 'Confirmado' },
  { key: 'completado', label: 'Completado' },
];

export const SEED_SERIES: Array<{ title: string; tagline: string; color: string }> = [
  { title: 'THE IRON HUNT', tagline: 'En busca del gimnasio definitivo.', color: '#3be58a' },
  { title: 'GYMS CLANDESTINOS', tagline: 'Descubrimiento de gimnasios ocultos y hardcore.', color: '#d95926' },
  { title: 'GYM VS. GYM', tagline: 'Comparación entre gimnasios económicos y premium.', color: '#3987e5' },
  { title: 'GYM AFTER DARK', tagline: 'Entrenamientos nocturnos cinematográficos.', color: '#9085e9' },
  { title: 'MÁQUINAS QUE NO DEBERÍAN EXISTIR', tagline: 'Aparatos extraños y antiguos.', color: '#c98500' },
  { title: 'DESCONOCIDOS DE HIERRO', tagline: 'Experiencias con otros deportistas.', color: '#199e70' },
  { title: 'ENTRENANDO DONDE NADIE ENTRENA', tagline: 'Descubrimiento de gimnasios poco conocidos.', color: '#e66767' },
];

export const EVENT_CATEGORIES: Array<{ key: string; label: string; color: string }> = [
  { key: 'grabacion', label: 'Grabación', color: '#3be58a' },
  { key: 'publicacion', label: 'Publicación', color: '#5cf0a0' },
  { key: 'entrenamiento', label: 'Entrenamiento', color: '#3987e5' },
  { key: 'trabajo', label: 'Trabajo', color: '#a9aea7' },
  { key: 'universidad', label: 'Universidad', color: '#9085e9' },
  { key: 'reunion', label: 'Reunión', color: '#c98500' },
  { key: 'colaboracion', label: 'Colaboración', color: '#d95926' },
  { key: 'personal', label: 'Personal', color: '#d55181' },
  { key: 'descanso', label: 'Descanso', color: '#199e70' },
  { key: 'recordatorio', label: 'Recordatorio', color: '#e66767' },
];

export const IDEA_KINDS: Array<{ key: string; label: string; list?: boolean }> = [
  { key: 'idea', label: 'Idea' },
  { key: 'reel', label: 'Concepto de reel' },
  { key: 'hook', label: 'Hook' },
  { key: 'guion', label: 'Guion' },
  { key: 'transicion', label: 'Transición' },
  { key: 'titulo', label: 'Título' },
  { key: 'descripcion', label: 'Descripción' },
  { key: 'tendencia', label: 'Referencia de tendencia' },
  { key: 'tomas', label: 'Lista de tomas', list: true },
  { key: 'storyboard', label: 'Storyboard', list: true },
  { key: 'checklist', label: 'Checklist de producción', list: true },
  { key: 'musica', label: 'Referencia musical' },
];
export const IDEA_STATUSES = [
  { key: 'nueva', label: 'Nueva' }, { key: 'desarrollo', label: 'En desarrollo' }, { key: 'lista', label: 'Lista' },
  { key: 'usada', label: 'Usada' }, { key: 'descartada', label: 'Descartada' },
];

export const GYM_CRITERIA: Array<{ key: string; label: string }> = [
  { key: 'maquinaria', label: 'Maquinaria' },
  { key: 'hardcore', label: 'Ambiente hardcore' },
  { key: 'limpieza', label: 'Limpieza' },
  { key: 'estetica', label: 'Estética' },
  { key: 'calidad_precio', label: 'Calidad-precio' },
  { key: 'experiencia', label: 'Experiencia de entrenamiento' },
  { key: 'potencial', label: 'Potencial para grabar' },
];
export const GYM_STATUSES = [{ key: 'pendiente', label: 'Pendiente' }, { key: 'visitado', label: 'Visitado' }, { key: 'favorito', label: 'Favorito' }];

export const CONTACT_KINDS = [
  { key: 'marca', label: 'Marca' }, { key: 'gimnasio', label: 'Gimnasio' }, { key: 'patrocinador', label: 'Patrocinador' },
  { key: 'colaborador', label: 'Colaborador' }, { key: 'agencia', label: 'Agencia' }, { key: 'otro', label: 'Otro' },
];
export const DEAL_KINDS = [
  { key: 'patrocinio', label: 'Patrocinio' }, { key: 'colaboracion', label: 'Colaboración' }, { key: 'canje', label: 'Canje' },
  { key: 'afiliado', label: 'Afiliado' }, { key: 'gimnasio', label: 'Alianza con gimnasio' },
];
export const CHANNELS = [
  { key: 'dm', label: 'DM de Instagram' }, { key: 'email', label: 'Correo' }, { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'llamada', label: 'Llamada' }, { key: 'reunion', label: 'Reunión' }, { key: 'otro', label: 'Otro' },
];
export const TX_CATEGORIES = {
  ingreso: ['patrocinio', 'colaboracion', 'afiliados', 'contenido', 'otro'],
  gasto: ['produccion', 'equipo', 'transporte', 'gimnasio', 'edicion', 'suplementos', 'publicidad', 'otro'],
};
export const CONTENT_EXPENSE_CATEGORIES = ['produccion', 'equipo', 'transporte', 'gimnasio', 'edicion', 'publicidad'];
export const GOAL_AREAS = [
  { key: 'instagram', label: 'Instagram' }, { key: 'contenido', label: 'Contenido' }, { key: 'fisico', label: 'Físico' },
  { key: 'personal', label: 'Personal' }, { key: 'finanzas', label: 'Finanzas' }, { key: 'marca', label: 'Marca' },
];
export const GOAL_METRICS = [
  { key: 'manual', label: 'Manual (actualizo yo el avance)' },
  { key: 'followers', label: 'Seguidores de Instagram (automático)' },
  { key: 'workouts_month', label: 'Entrenamientos del mes (automático)' },
  { key: 'episodes_published', label: 'Episodios publicados (automático)' },
  { key: 'weight', label: 'Peso corporal más reciente (automático)' },
  { key: 'gyms_visited', label: 'Gimnasios visitados (automático)' },
  { key: 'income_month', label: 'Ingresos del mes (automático)' },
];
export const GOAL_STATUSES = [
  { key: 'pendiente', label: 'Pendiente' }, { key: 'en_progreso', label: 'En progreso' }, { key: 'logrado', label: 'Logrado' },
  { key: 'transferido', label: 'Transferido' }, { key: 'abandonado', label: 'Abandonado' },
];
export const MEASUREMENTS = [
  { key: 'pecho', label: 'Pecho' }, { key: 'cintura', label: 'Cintura' }, { key: 'cadera', label: 'Cadera' }, { key: 'brazo', label: 'Brazo' },
  { key: 'antebrazo', label: 'Antebrazo' }, { key: 'muslo', label: 'Muslo' }, { key: 'pantorrilla', label: 'Pantorrilla' }, { key: 'cuello', label: 'Cuello' },
];

export const METRIC_LABELS: Record<string, string> = {
  reach: 'Alcance', views: 'Reproducciones / visualizaciones', accounts_engaged: 'Cuentas que interactuaron', total_interactions: 'Interacciones totales',
  likes: 'Me gusta', comments: 'Comentarios', shares: 'Compartidos', saves: 'Guardados', saved: 'Guardados', replies: 'Respuestas',
  reposts: 'Reposts', profile_links_taps: 'Toques en enlaces del perfil', follows_and_unfollows: 'Seguidos y bajas', profile_views: 'Visitas al perfil',
  website_clicks: 'Clics al sitio web', profile_visits: 'Visitas al perfil', follows: 'Nuevos seguidores', navigation: 'Navegación',
  ig_reels_avg_watch_time: 'Tiempo medio de visualización', ig_reels_video_view_total_time: 'Tiempo total de visualización',
  follower_demographics: 'Demografía de seguidores', engaged_audience_demographics: 'Demografía de la audiencia que interactuó', online_followers: 'Actividad de seguidores',
};
export const metricLabel = (m: string) => METRIC_LABELS[m] ?? m;
export const FORMAT_LABELS: Record<string, string> = { REELS: 'Reels', FEED: 'Publicaciones', STORY: 'Stories', CAROUSEL_ALBUM: 'Carrusel', IMAGE: 'Imagen', VIDEO: 'Video' };

export const WIDGETS: Array<{ key: string; label: string }> = [
  { key: 'instagram', label: 'Seguidores y crecimiento' },
  { key: 'performance', label: 'Alcance, reproducciones e interacciones' },
  { key: 'top_posts', label: 'Rendimiento de publicaciones' },
  { key: 'series', label: 'Series activas' },
  { key: 'recordings', label: 'Próximas grabaciones' },
  { key: 'goals', label: 'Objetivos pendientes' },
  { key: 'agenda', label: 'Actividades de hoy y la semana' },
  { key: 'body', label: 'Progreso físico' },
  { key: 'budget', label: 'Presupuesto para contenido' },
  { key: 'streak', label: 'Racha de productividad' },
  { key: 'tasks', label: 'Tareas pendientes' },
  { key: 'ideas', label: 'Ideas recientes' },
  { key: 'trackers', label: 'Seguimientos personalizados' },
];

export const ENTITY_LABELS: Record<string, string> = {
  episodes: 'Episodios', series: 'Series', gyms: 'Gimnasios', ideas: 'Ideas', events: 'Eventos', goals: 'Objetivos', contacts: 'Contactos',
  deals: 'Colaboraciones', body_logs: 'Diario corporal', workouts: 'Entrenamientos', tasks: 'Tareas', notes: 'Notas', transactions: 'Movimientos',
};
