import { defineFolderTests } from '../support/folders.ts'
import { logIn } from '../support/session.ts'

// Track A3's folder column against the production image under /wp-upload/,
// logged in, on the stack's WordPress (the `small` seed's 15 FileBird
// folders). The tests only change folders they create (`e2e-…`), delete them
// again, and put every moved item back where it was.
defineFolderTests({ prepare: logIn, persists: true })
