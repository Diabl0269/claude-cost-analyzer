import { createBrowserRouter, type RouteObject } from 'react-router';
import { Shell } from './shell/Shell';
import { RouteError } from './shell/RouteError';

/** `lazy` keeps each page in its own chunk; `handle.title` drives `document.title`. */
const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, handle: { title: 'Overview' }, lazy: lazyPage(() => import('@/routes/overview/Page')) },
      { path: 'sessions', handle: { title: 'Sessions' }, lazy: lazyPage(() => import('@/routes/sessions/Page')) },
      {
        path: 'sessions/:id',
        handle: { title: 'Session' },
        lazy: lazyPage(() => import('@/routes/session/Page')),
        children: [
          { index: true, handle: { title: 'Session · Summary' }, lazy: lazyPage(() => import('@/routes/session/tabs/Summary')) },
          { path: 'summary', handle: { title: 'Session · Summary' }, lazy: lazyPage(() => import('@/routes/session/tabs/Summary')) },
          { path: 'transcript', handle: { title: 'Session · Transcript' }, lazy: lazyPage(() => import('@/routes/session/tabs/Transcript')) },
          { path: 'tools', handle: { title: 'Session · Tools' }, lazy: lazyPage(() => import('@/routes/session/tabs/Tools')) },
          { path: 'agents', handle: { title: 'Session · Agents' }, lazy: lazyPage(() => import('@/routes/session/tabs/Agents')) },
          { path: 'agents/:agentId', handle: { title: 'Session · Agent' }, lazy: lazyPage(() => import('@/routes/session/tabs/AgentTranscript')) },
          { path: 'hooks', handle: { title: 'Session · Hooks' }, lazy: lazyPage(() => import('@/routes/session/tabs/Hooks')) },
          { path: 'timeline', handle: { title: 'Session · Timeline' }, lazy: lazyPage(() => import('@/routes/session/tabs/Timeline')) },
        ],
      },
      { path: 'search', handle: { title: 'Search' }, lazy: lazyPage(() => import('@/routes/search/Page')) },
      { path: 'analytics/tools', handle: { title: 'Tools' }, lazy: lazyPage(() => import('@/routes/analytics-tools/Page')) },
      { path: 'analytics/models', handle: { title: 'Models' }, lazy: lazyPage(() => import('@/routes/analytics-models/Page')) },
      { path: 'analytics/hooks', handle: { title: 'Hooks' }, lazy: lazyPage(() => import('@/routes/analytics-hooks/Page')) },
      {
        path: 'analytics/attribution',
        handle: { title: 'Attribution' },
        lazy: lazyPage(() => import('@/routes/analytics-attribution/Page')),
      },
      { path: 'insights', handle: { title: 'Insights' }, lazy: lazyPage(() => import('@/routes/insights/Page')) },
      { path: 'settings', handle: { title: 'Settings' }, lazy: lazyPage(() => import('@/routes/settings/Page')) },
      { path: 'how-it-works', handle: { title: 'How it works' }, lazy: lazyPage(() => import('@/routes/how-it-works/Page')) },
      { path: 'methodology', handle: { title: 'Methodology' }, lazy: lazyPage(() => import('@/routes/methodology/Page')) },
      { path: 'compare', handle: { title: 'Compare' }, lazy: lazyPage(() => import('@/routes/compare/Page')) },
      { path: 'design', handle: { title: 'Design gallery' }, lazy: lazyPage(() => import('@/routes/design/Page')) },
      { path: '*', handle: { title: 'Not found' }, lazy: lazyPage(() => import('@/routes/not-found/Page')) },
    ],
  },
];

export const router = createBrowserRouter(routes);
