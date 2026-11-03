/**
 * Throwaway host-logic smoke test for the notes route (not shipped).
 * Run: node _smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const home = path.join(process.cwd(), '.smoke-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(home, { recursive: true })
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

const routes = []
const ctx = {
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  get: () => undefined,
}
apply(ctx)

if (routes.length !== 1 || routes[0].path !== '/dsh-notes/state') throw new Error('route not registered')
const route = routes[0]

function makeRes() {
  const out = { status: 0, body: '' }
  return {
    out,
    writeHead(status) { out.status = status },
    end(body) { if (body !== undefined) out.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body) },
  }
}

function makeReq(method, payload) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload), 'utf8')]
  return {
    method,
    url: '/dsh-notes/state',
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail })
  if (!condition) throw new Error('FAILED: ' + name + ' ' + (detail || ''))
}

// 1. empty GET
let res = makeRes()
await route.handler(makeReq('GET'), res)
let data = JSON.parse(res.out.body)
check('empty get', res.out.status === 200 && data.ok === true && data.notes.length === 0, res.out.body)

// 2. POST creates state
res = makeRes()
await route.handler(makeReq('POST', { notes: [{ id: 'a', text: 'hello', pinned: true, important: true, color: 'mint' }] }), res)
check('post ok', res.out.status === 200 && JSON.parse(res.out.body).count === 1, res.out.body)

// 3. GET round-trips and sanitizes flags
res = makeRes()
await route.handler(makeReq('GET'), res)
data = JSON.parse(res.out.body)
check('roundtrip', data.notes.length === 1 && data.notes[0].text === 'hello' && data.notes[0].pinned === true && data.notes[0].important === true && data.notes[0].desktop === false && data.notes[0].color === 'mint', res.out.body)

// 3b. unknown tints are dropped, valid ones kept
res = makeRes()
await route.handler(makeReq('POST', { notes: [{ id: 'd', text: 'tint', color: 'neon' }, { id: 'e', text: 'ok', color: 'blush' }] }), res)
res = makeRes()
await route.handler(makeReq('GET'), res)
data = JSON.parse(res.out.body)
check('tint whitelist', data.notes[0].color === null && data.notes[1].color === 'blush', res.out.body)

// 4. blank notes are dropped, not stored
res = makeRes()
await route.handler(makeReq('POST', { notes: [{ id: 'b', text: '   ' }, { id: 'c', text: 'kept' }] }), res)
check('blank dropped', JSON.parse(res.out.body).count === 1, res.out.body)

// 5. missing notes[] is rejected
res = makeRes()
await route.handler(makeReq('POST', {}), res)
check('notes required', res.out.status === 400, res.out.body)

// 6. unsupported method
res = makeRes()
await route.handler(makeReq('DELETE'), res)
check('405', res.out.status === 405, res.out.body)

// 7. cap at 2000 notes
const many = Array.from({ length: 2600 }, (_, index) => ({ id: 'n' + index, text: 'x' + index }))
res = makeRes()
await route.handler(makeReq('POST', { notes: many }), res)
check('cap 2000', JSON.parse(res.out.body).count === 2000, res.out.body)

// 8. file on disk is valid JSON with the same count
const file = path.join(home, 'dsh-notes', 'notes.json')
const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
check('file written', stored.notes.length === 2000, String(stored.notes.length))

// 9. corrupt file degrades to empty, does not throw
fs.writeFileSync(file, '{not json', 'utf8')
res = makeRes()
await route.handler(makeReq('GET'), res)
data = JSON.parse(res.out.body)
check('corrupt file', data.ok === true && data.notes.length === 0, res.out.body)

fs.rmSync(home, { recursive: true, force: true })
for (const item of results) console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name)
console.log('all ' + results.length + ' checks passed')
