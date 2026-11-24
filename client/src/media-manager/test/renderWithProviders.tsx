import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  type RenderOptions,
  type RenderResult,
  render,
} from '@testing-library/react'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { MediaManagerThemeProvider } from '../theme'

// Renders a media-manager component the way the app mounts it: inside the
// theme provider (a pinned colour scheme, so results don't depend on the
// machine) and a fresh TanStack Query client. For the `browser` project.
//
//   const { getByRole, queryClient } = renderWithProviders(<Inspector />, {
//     colorScheme: 'light',
//   })

export interface RenderWithProvidersOptions
  extends Omit<RenderOptions, 'wrapper' | 'queries'> {
  /** Default `dark`, the primary scheme. */
  colorScheme?: 'light' | 'dark'
  /** Pass one to seed data or inspect the cache. Default: a fresh test client. */
  queryClient?: QueryClient
  /** Extra providers inside the theme and query providers (e.g. a store). */
  wrapper?: ComponentType<{ children: ReactNode }>
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient
}

/** A query client for tests: no retries, no refetch on focus, no GC timer. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  {
    colorScheme = 'dark',
    queryClient = createTestQueryClient(),
    wrapper: Extra,
    ...options
  }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  function Providers({ children }: { children: ReactNode }) {
    const content = Extra ? <Extra>{children}</Extra> : children
    return (
      <MediaManagerThemeProvider forceColorScheme={colorScheme}>
        <QueryClientProvider client={queryClient}>
          {content}
        </QueryClientProvider>
      </MediaManagerThemeProvider>
    )
  }
  const result = render(ui, { ...options, wrapper: Providers })
  return { ...result, queryClient }
}
