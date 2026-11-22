import type { HttpHandler } from 'msw'

// MSW handlers for the `editor` feature (track B1). Track F2 builds the mock
// infrastructure that collects these; each track adds its own handlers here.
export const handlers: HttpHandler[] = []
