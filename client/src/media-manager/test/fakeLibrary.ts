import {
  createMockContext,
  type MockContext,
  setMockContext,
} from '../mocks/context'
import { handlers } from '../mocks/handlers'
import { type MockSettings, resolveSettings } from '../mocks/scenarios'
import { mockNetwork } from './msw'

// The mock backend (F2's stateful fake) behind the test project's MSW, for
// browser specs that render real app parts against a whole library:
//
//   afterEach(stopFakeLibrary)
//   const mock = startFakeLibrary('normal')   // any ?mock-scenario= value
//   renderWithProviders(<MediaManagerApp />)
//   mock.library.…                            // inspect or change its state
//
// Renditions point at this page's own origin (`mock-media/…`), which the
// same handlers answer with SVG placeholders, so images load without a
// network. Latency is 0 unless `settings` say otherwise.

export function startFakeLibrary(
  scenario = 'normal',
  settings: Partial<MockSettings> = {},
): MockContext {
  const context = createMockContext(
    {
      ...resolveSettings(`mock-scenario=${encodeURIComponent(scenario)}`),
      latency: { read: 0, write: 0 },
      jobSpeed: 0,
      ...settings,
    },
    { mediaBase: new URL('mock-media/', window.location.href).href },
  )
  setMockContext(context)
  mockNetwork.use(...handlers)
  return context
}

export function stopFakeLibrary(): void {
  setMockContext(null)
}
