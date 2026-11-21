import type { NextFunction, Request, Response } from 'express'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Values of Sec-Fetch-Site that mean another site made the browser send this.
// `same-site` is included on purpose: sibling subdomains are the same "site",
// so SameSite=Lax alone would still attach our cookie to their requests.
const FOREIGN_SITES = new Set(['cross-site', 'same-site'])

// CSRF defense in depth on top of the SameSite=Lax session cookie: rejects
// state-changing requests that a browser reports as coming from another
// origin. Requests without the header (curl, scripts, older browsers) pass;
// they get no help from an ambient cookie anyway, or rely on SameSite.
// Unlike comparing Origin with Host, this doesn't depend on how a reverse
// proxy rewrites the Host header.
export function sameOriginOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const fetchSite = req.get('Sec-Fetch-Site')?.toLowerCase()
  if (
    !SAFE_METHODS.has(req.method) &&
    fetchSite !== undefined &&
    FOREIGN_SITES.has(fetchSite)
  ) {
    res.status(403).json({
      code: 'cross_site_request',
      message: 'Requests from other sites are not allowed.',
    })
    return
  }

  next()
}
