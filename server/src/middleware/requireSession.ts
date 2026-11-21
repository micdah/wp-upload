import type { NextFunction, Request, Response } from 'express'
import { sessionIssuedAt } from '../lib/session.ts'

// Guards the API. Replies with a plain JSON 401 - never a WWW-Authenticate
// challenge, which would make browsers show their own login prompt - and the
// client shows its login page instead. A missing or invalid session isn't a
// failed login, so it doesn't count toward the login lockout.
//
// Never sets the session cookie: responses under `api/` would scope it to
// the wrong path (see lib/session.ts). Renewal happens in GET session.
export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const issuedAt = sessionIssuedAt(req.headers.cookie)
  if (issuedAt === null) {
    res
      .status(401)
      .json({ code: 'unauthorized', message: 'Log in to continue.' })
    return
  }

  res.locals.sessionIssuedAt = issuedAt
  next()
}
