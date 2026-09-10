import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { ToastProvider } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { KeyboardProvider } from '@/lib/keyboard';
import { applyMotionPreference } from '@/lib/motion';
import { useSettings } from '@/lib/queries';
import { ThemeProvider } from '@/lib/theme';
import { router } from './routes';

/** Local server, local data: retry only transport-level failures, never poll in the background. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && !error.retryable) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/**
 * Applies the stored reduced-motion preference (SPEC §8.4) for the whole app. It lives here
 * rather than on the Settings page so a reload lands on any route with the right `data-motion`;
 * Settings still calls the same helper on its draft, for a live preview before saving.
 * Renders nothing — it only writes an attribute on `<html>`.
 */
function MotionPreference(): null {
  const settings = useSettings();
  const preference = settings.data?.reducedMotion;
  useEffect(() => {
    applyMotionPreference(preference ?? 'system');
  }, [preference]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <KeyboardProvider>
            <MotionPreference />
            <RouterProvider router={router} />
          </KeyboardProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
