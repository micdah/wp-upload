// GET api/library/bootstrap: always 200, even when WordPress is down, so the
// client can always decide which screen to show (server-api.md §7.1). The
// data layer (core/data/bootstrap.ts) owns the query; it also sets the
// client's baseline library revision.

export { useBootstrap } from '../../core/data/bootstrap'
