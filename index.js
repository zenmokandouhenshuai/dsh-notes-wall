/**
 * Host half of the sticky-notes plugin: owns the on-disk note store, serves one
 * JSON route the Client reads and writes, and keeps the Windows desktop widget
 * in sync with the notes whose "desktop" flag is set.
 *
 * Data lives in $DSH_HOME/dsh-notes/notes.json so the wall survives restarts and
 * is shared by every browser connected to this Harness.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const WIDGET_SCRIPT = path.join(PACKAGE_ROOT, 'widget.ps1')

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STATE_DIR = path.join(DSH_HOME, 'dsh-notes')
const STATE_FILE = path.join(STATE_DIR, 'notes.json')
const WIDGET_PID_FILE = path.join(STATE_DIR, 'widget.pid')
const MAX_NOTES = 2000
const MAX_TEXT = 4000
const MAX_BODY = 4 * 1024 * 1024

// Sticky-note tints the Client offers; anything else falls back to the theme card.
const NOTE_COLORS = ['butter', 'cream', 'mint', 'sky', 'blush', 'lilac']

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function emptyState() {
  return { version: 1, notes: [], updatedAt: null }
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT) : ''
  if (!text.trim()) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : ''
  if (!id) return null
  let pos = null
  if (raw.pos && typeof raw.pos === 'object' && Number.isFinite(raw.pos.x) && Number.isFinite(raw.pos.y)) {
    pos = { x: finite(raw.pos.x, 0), y: finite(raw.pos.y, 0) }
  }
  return {
    id,
    text,
    createdAt: finite(raw.createdAt, Date.now()),
    updatedAt: finite(raw.updatedAt, Date.now()),
    pinned: raw.pinned === true,
    important: raw.important === true,
    desktop: raw.desktop === true,
    color: typeof raw.color === 'string' && NOTE_COLORS.includes(raw.color) ? raw.color : null,
    pos,
  }
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (!parsed || !Array.isArray(parsed.notes)) return emptyState()
    return {
      version: 1,
      notes: parsed.notes.map(sanitizeNote).filter(Boolean),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    }
  } catch (err) {
    // Missing file is the normal first-run case; anything else still degrades to
    // an empty wall rather than breaking the route.
    return emptyState()
  }
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const temp = STATE_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(temp, STATE_FILE)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('payload too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/* ------------------------------------------------------------ desktop widget */

/**
 * The widget publishes its own PID after it wins the single-instance mutex, so a
 * PID file left behind by a plugin reload never spawns a second copy.
 */
function widgetPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(WIDGET_PID_FILE, 'utf8').trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch (err) {
    return null
  }
}

function widgetRunning() {
  const pid = widgetPid()
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return false
  }
}

function startWidget() {
  if (process.platform !== 'win32') return
  if (widgetRunning()) return
  try {
    if (!fs.existsSync(WIDGET_SCRIPT)) return
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', WIDGET_SCRIPT,
      '-StateFile', STATE_FILE,
    ], {
      // Not detached: a detached PowerShell loses the console and never reaches
      // its message loop on this machine. The child outlives this process on
      // Windows and is stopped explicitly through its PID file.
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
  } catch (err) {
    // A blocked PowerShell never breaks saving; the Client falls back to its
    // in-window floating card.
  }
}

function stopWidget() {
  const pid = widgetPid()
  if (pid !== null) {
    try { process.kill(pid) } catch (err) { /* already gone */ }
  }
  try { fs.rmSync(WIDGET_PID_FILE, { force: true }) } catch (err) { /* ignore */ }
}

function syncWidget(state) {
  const desktopCount = state.notes.filter((note) => note.desktop).length
  if (desktopCount > 0) startWidget()
  else stopWidget()
}

function widgetStatus() {
  return { running: widgetRunning() }
}

export const inject = ['webServer']

/**
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  function rejected(req, res) {
    try {
      const conn = ctx.get('connection')
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (err) {
      return false
    }
  }

  function send(res, status, payload) {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(payload))
  }

  const disposer = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-notes/state',
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method === 'GET' || req.method === 'HEAD') {
        send(res, 200, Object.assign({ ok: true }, readState(), { widget: widgetStatus() }))
        return
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        let body
        try {
          body = await readJsonBody(req)
        } catch (err) {
          send(res, 400, { ok: false, error: 'bad request body: ' + String((err && err.message) || err).slice(0, 200) })
          return
        }
        const incoming = body && Array.isArray(body.notes) ? body.notes : null
        if (!incoming) {
          send(res, 400, { ok: false, error: 'notes[] is required' })
          return
        }
        const notes = incoming.map(sanitizeNote).filter(Boolean).slice(0, MAX_NOTES)
        const state = { version: 1, notes, updatedAt: new Date().toISOString() }
        try {
          writeState(state)
        } catch (err) {
          send(res, 500, { ok: false, error: 'store write failed: ' + String((err && err.message) || err).slice(0, 200) })
          return
        }
        try {
          syncWidget(state)
        } catch (err) { /* widget trouble must not fail the save */ }
        send(res, 200, { ok: true, updatedAt: state.updatedAt, count: notes.length, widget: widgetStatus() })
        return
      }
      send(res, 405, { ok: false, error: 'method not allowed' })
    },
  })

  // Pinned notes from a previous run reappear on the desktop right after start.
  try {
    syncWidget(readState())
  } catch (err) { /* ignore */ }

  ctx.effect(() => () => {
    try { stopWidget() } catch (err) { /* ignore */ }
  }, 'dsh-notes: desktop widget')

  return ctx.effect(() => disposer, 'dsh-notes: state route')
}
