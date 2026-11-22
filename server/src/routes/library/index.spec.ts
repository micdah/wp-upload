import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../../middleware/errorHandler.ts'
import { libraryRouter } from './index.ts'

// Every route of the server API contract is registered from the start (the
// M0 scaffold), so tracks only ever replace handlers. A route that answers
// 404 has been dropped or renamed by mistake.
const contractRoutes: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
  ['get', '/bootstrap'],
  ['get', '/rev'],
  ['get', '/collection'],
  ['get', '/facets'],
  ['get', '/items'],
  ['patch', '/items/1'],
  ['post', '/items/batch'],
  ['post', '/items/delete'],
  ['post', '/items/1/edit'],
  ['post', '/items/1/edit/undo'],
  ['post', '/items/1/restore'],
  ['post', '/items/1/replace'],
  ['get', '/items/1/download'],
  ['post', '/regenerate'],
  ['get', '/jobs'],
  ['get', '/folders'],
  ['post', '/folders'],
  ['post', '/folders/assign'],
  ['patch', '/folders/1'],
  ['delete', '/folders/1'],
  ['get', '/trash'],
  ['post', '/trash/restore'],
  ['post', '/trash/empty'],
  ['get', '/usage'],
  ['post', '/usage'],
  ['get', '/posts'],
  ['post', '/upload'],
  ['get', '/upload/jobs'],
  ['get', '/upload/check'],
  ['get', '/plugin/download'],
]

function buildApp() {
  const app = express()
  app.use(libraryRouter)
  app.use((_req, res) => {
    res.status(404).json({ code: 'not_found', message: 'no route' })
  })
  app.use(errorHandler)
  return app
}

describe('libraryRouter', () => {
  it.each(contractRoutes)('registers %s %s', async (method, path) => {
    const res = await request(buildApp())[method](path)
    expect(res.status).not.toBe(404)
  })
})
