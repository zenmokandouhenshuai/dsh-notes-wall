/**
 * Client half of the sticky-notes plugin.
 *
 * Renders three registrations:
 *  - `sidebar.panellist` id `dsh-notes` — the left sidebar entry (icon + label).
 *  - `main` key `dsh-notes` — the wall panel itself.
 *  - `shell.overlay` id `dsh-notes-desktop` — notes fixed as floating cards.
 *
 * Notes are owned by the Host route `/dsh-notes/state`; this module keeps one
 * in-memory store shared by the panel and the floating cards.
 */
window.__ModuleLoader__.load({
  id: 'dsh-notes-wall',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const ENDPOINT = '/dsh-notes/state'
    const CACHE_KEY = 'dsh-notes:cache'
    const MAX_TEXT = 4000

    // Paper tints sampled from the user's reference screenshots. Each entry is a
    // fixed pastel (artwork, not a theme token) with a matching border and ink so
    // a colored note stays readable in both light and dark themes.
    const PALETTE = [
      { key: 'butter', name: '奶油黄', bg: '#FEE6A3', border: '#EDD289', ink: '#3B3423' },
      { key: 'cream', name: '米白', bg: '#F4EBD0', border: '#E2D5B2', ink: '#3B3628' },
      { key: 'mint', name: '薄荷', bg: '#BFE9E0', border: '#A6D7CC', ink: '#223B35' },
      { key: 'sky', name: '天蓝', bg: '#BBE0FA', border: '#9FCEF0', ink: '#1F3341' },
      { key: 'blush', name: '蜜桃', bg: '#F7BACC', border: '#E9A2B6', ink: '#42242D' },
      { key: 'lilac', name: '薰衣草', bg: '#D8CAF6', border: '#C2AFEC', ink: '#302A44' },
    ]
    const PALETTE_BY_KEY = {}
    PALETTE.forEach((entry) => { PALETTE_BY_KEY[entry.key] = entry })

    function swatchOf(note) {
      return note && note.color ? PALETTE_BY_KEY[note.color] || null : null
    }

    const CSS = `
.dshn-root{height:100%;min-height:0;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
.dshn-inner{max-width:1040px;margin:0 auto;padding:24px 28px 72px;font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;}
.dshn-head{display:flex;flex-direction:column;gap:4px;margin-bottom:16px;}
.dshn-title-row{display:flex;align-items:baseline;gap:10px;}
.dshn-title{margin:0;font-size:19px;font-weight:600;letter-spacing:.2px;}
.dshn-count{font-size:12px;color:var(--dsw-alias-label-secondary);}
.dshn-sub{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dshn-composer{display:flex;flex-direction:column;gap:8px;padding:12px 14px 10px;margin-bottom:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);}
.dshn-composer[data-colored='true']{border-color:transparent;}
.dshn-input{min-height:54px;max-height:60vh;box-sizing:border-box;padding:4px 2px;border:0;background:transparent;color:inherit;font:inherit;line-height:1.6;resize:none;outline:none;}
.dshn-grip{height:9px;margin:0 -2px;border-radius:5px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;touch-action:none;}
.dshn-grip::after{content:'';width:46px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l2);opacity:.7;transition:background .12s ease,opacity .12s ease;}
.dshn-grip:hover::after{background:var(--dsw-alias-brand-primary);opacity:1;}
.dshn-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8;}
.dshn-composer-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.dshn-dots{display:flex;align-items:center;gap:6px;}
.dshn-dot{width:21px;height:21px;padding:0;border-radius:50%;border:1px solid rgba(0,0,0,.14);cursor:pointer;box-sizing:border-box;transition:transform .12s ease;}
.dshn-dot:hover{transform:scale(1.1);}
.dshn-dot--auto{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);}
.dshn-add{height:38px;margin-left:auto;padding:0 18px;border-radius:9px;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-weight:600;cursor:pointer;}
.dshn-add:disabled{opacity:.45;cursor:default;}
.dshn-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.dshn-chip{height:26px;padding:0 11px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;}
.dshn-chip.is-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}
.dshn-status{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.dshn-grid{column-width:232px;column-gap:12px;}
.dshn-empty{padding:44px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary);}
.dshn-card{position:relative;display:block;margin:0 0 12px;break-inside:avoid;-webkit-column-break-inside:avoid;padding:12px 12px 8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);}
.dshn-card:hover{border-color:var(--dsw-alias-border-l2);}
.dshn-card--pinned{box-shadow:inset 3px 0 0 0 var(--dsw-alias-brand-primary);}
.dshn-card--important{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, var(--dsw-alias-border-l1));}
.dshn-card-text{margin:0;max-height:348px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;}
.dshn-card-foot{display:flex;align-items:center;gap:6px;margin-top:8px;}
.dshn-time{font-size:11px;color:var(--dsw-alias-label-secondary);}
.dshn-actions{margin-left:auto;display:flex;align-items:center;gap:2px;}
.dshn-act{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}
.dshn-act:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.dshn-act.is-on{color:var(--dsw-alias-brand-primary);}
.dshn-act.is-danger:hover{color:var(--dsw-alias-state-error-primary);}
.dshn-tag{font-size:10.5px;padding:0 6px;border-radius:4px;line-height:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}
.dshn-card-palette{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:2px;}
.dshn-card[data-colored='true'] .dshn-time,.dshn-card[data-colored='true'] .dshn-tag{color:inherit;opacity:.62;}
.dshn-card[data-colored='true'] .dshn-tag{background:rgba(0,0,0,.08);}
.dshn-card[data-colored='true'] .dshn-act{color:inherit;opacity:.6;}
.dshn-card[data-colored='true'] .dshn-act:hover{opacity:1;background:rgba(0,0,0,.08);}
.dshn-card[data-colored='true'] .dshn-act.is-on{opacity:1;}
.dshn-pin[data-colored='true'] .dshn-pin-title,.dshn-pin[data-colored='true'] .dshn-pin-close,.dshn-pin[data-colored='true'] .dshn-pin-foot{color:inherit;opacity:.6;}
.dshn-layer{position:fixed;inset:0;pointer-events:none;z-index:60;}
.dshn-pin{position:fixed;width:272px;box-sizing:border-box;pointer-events:auto;display:flex;flex-direction:column;gap:8px;padding:8px 10px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 10px 28px rgba(0,0,0,.22);font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;}
.dshn-pin--important{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l2));}
.dshn-pin-head{display:flex;align-items:center;gap:6px;cursor:grab;user-select:none;touch-action:none;}
.dshn-pin-head:active{cursor:grabbing;}
.dshn-pin-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;}
.dshn-pin--important .dshn-pin-dot{background:var(--dsw-alias-state-warn-primary);}
.dshn-pin-title{font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.dshn-pin-close{margin-left:auto;width:20px;height:20px;line-height:1;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;cursor:pointer;}
.dshn-pin-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.dshn-pin-text{margin:0;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;}
.dshn-pin-foot{font-size:10.5px;color:var(--dsw-alias-label-secondary);}
.dshn-card-text strong,.dshn-pin-text strong{font-weight:700;}
.dshn-card--editing{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshn-edit-badge{display:flex;align-items:center;gap:10px;padding:2px 2px 0;font-size:11.5px;color:var(--dsw-alias-brand-primary);}
.dshn-linkbtn{padding:0;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;opacity:.85;}
.dshn-linkbtn:hover{opacity:1;}
.dshn-bold{width:26px;height:26px;padding:0;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;font-weight:700;line-height:1;cursor:pointer;}
.dshn-bold:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}
.dshn-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.85;}
`

    /* Styles for the optional Document Picture-in-Picture window (a real
       always-on-top OS window). Theme tokens are copied onto that document's
       root at open time, so the card matches the current light/dark theme. */
    const PIP_CSS = `
html,body{margin:0;padding:0;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;}
.dshn-pip{box-sizing:border-box;height:100vh;display:flex;flex-direction:column;gap:10px;padding:12px 14px 10px;border-top:3px solid var(--dsw-alias-brand-primary);}
.dshn-pip.is-important{border-top-color:var(--dsw-alias-state-warn-primary);}
.dshn-pip-text{margin:0;flex:1;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6;}
.dshn-pip-foot{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);}
.dshn-pip-close{margin-left:auto;height:24px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;}
.dshn-pip-close:hover{color:var(--dsw-alias-state-error-primary);}
`

    /* ------------------------------------------------------------------ store */

    const store = { notes: [], loaded: false, saving: false, error: null, widgetRunning: false, widgetKnown: false }
    const listeners = new Set()

    function emit() {
      listeners.forEach((fn) => {
        try { fn() } catch (err) { /* one broken listener must not stop the rest */ }
      })
    }

    function useStore() {
      const [, force] = useState(0)
      useEffect(() => {
        const fn = () => force((n) => n + 1)
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      }, [])
      return store
    }

    function normalizeNote(raw) {
      if (!raw || typeof raw !== 'object') return null
      const text = typeof raw.text === 'string' ? raw.text : ''
      if (!text.trim()) return null
      const id = typeof raw.id === 'string' && raw.id
        ? raw.id
        : 'n' + Math.random().toString(36).slice(2, 10)
      const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
      return {
        id,
        text: text.slice(0, MAX_TEXT),
        createdAt: num(raw.createdAt, Date.now()),
        updatedAt: num(raw.updatedAt, Date.now()),
        pinned: raw.pinned === true,
        important: raw.important === true,
        desktop: raw.desktop === true,
        color: typeof raw.color === 'string' && PALETTE_BY_KEY[raw.color] ? raw.color : null,
        pos: raw.pos && Number.isFinite(raw.pos.x) && Number.isFinite(raw.pos.y)
          ? { x: raw.pos.x, y: raw.pos.y }
          : null,
      }
    }

    let loadPromise = null

    function applyServerState(data) {
      if (!data || !Array.isArray(data.notes)) return false
      store.notes = data.notes.map(normalizeNote).filter(Boolean)
      store.loaded = true
      store.error = null
      store.widgetRunning = !!(data.widget && data.widget.running === true)
      // A Host from before the desktop-widget feature omits this field entirely;
      // the wall then explains that a restart is what is missing.
      store.widgetKnown = !!data.widget
      return true
    }

    /** Re-read the Host while the panel is open, so an unpin made on the desktop
        widget (or in another browser) shows up here. */
    async function refreshFromServer() {
      if (store.saving) return
      try {
        const res = await fetch(ENDPOINT, { cache: 'no-store', headers: { accept: 'application/json' } })
        if (!res.ok) return
        if (applyServerState(await res.json())) emit()
      } catch (err) { /* keep what we have */ }
    }

    function loadNotes() {
      if (loadPromise) return loadPromise
      loadPromise = (async () => {
        let ok = false
        try {
          const res = await fetch(ENDPOINT, { cache: 'no-store', headers: { accept: 'application/json' } })
          if (res.ok) ok = applyServerState(await res.json())
        } catch (err) { /* fall through to the local cache */ }
        if (!ok) {
          try {
            const raw = window.localStorage.getItem(CACHE_KEY)
            const data = raw ? JSON.parse(raw) : null
            if (data && Array.isArray(data.notes)) {
              store.notes = data.notes.map(normalizeNote).filter(Boolean)
              store.loaded = true
            }
          } catch (err) { /* ignore a corrupt cache */ }
          store.error = 'offline'
        }
        emit()
      })()
      return loadPromise
    }

    let saveTimer = 0

    function persist() {
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ notes: store.notes })) } catch (err) { /* quota */ }
      store.saving = true
      emit()
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => { void flush() }, 250)
    }

    async function flush() {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: store.notes }),
        })
        store.error = res.ok ? null : 'HTTP ' + res.status
        if (res.ok) {
          try {
            const data = await res.json()
            if (data && data.widget) {
              store.widgetRunning = data.widget.running === true
              store.widgetKnown = true
            }
          } catch (err) { /* response body is optional */ }
        }
      } catch (err) {
        store.error = 'offline'
      }
      store.saving = false
      emit()
    }

    function mutate(fn) {
      store.notes = fn(store.notes)
      emit()
      persist()
    }

    function addNote(text, color) {
      const value = String(text || '').trim()
      if (!value) return
      const now = Date.now()
      mutate((notes) => [{
        id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 7),
        text: value.slice(0, MAX_TEXT),
        createdAt: now,
        updatedAt: now,
        pinned: false,
        important: false,
        desktop: false,
        color: typeof color === 'string' && PALETTE_BY_KEY[color] ? color : null,
        pos: null,
      }].concat(notes))
    }

    function patchNote(id, patch) {
      mutate((notes) => notes.map((note) => (note.id === id ? Object.assign({}, note, patch, { updatedAt: Date.now() }) : note)))
    }

    function removeNote(id) {
      mutate((notes) => notes.filter((note) => note.id !== id))
    }

    function ordered(notes) {
      return notes.slice().sort((a, b) => {
        const pin = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        if (pin !== 0) return pin
        const focus = (b.important ? 1 : 0) - (a.important ? 1 : 0)
        if (focus !== 0) return focus
        return b.createdAt - a.createdAt
      })
    }

    function relativeTime(ts) {
      const diff = Date.now() - ts
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
      const date = new Date(ts)
      const today = new Date()
      if (date.getFullYear() === today.getFullYear()) return (date.getMonth() + 1) + '月' + date.getDate() + '日'
      return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日'
    }

    /* ------------------------------------------------ desktop picture-in-picture */

    const PIP_TOKENS = [
      '--dsw-alias-bg-overlay',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2',
      '--dsw-alias-brand-primary',
      '--dsw-alias-state-warn-primary',
    ]

    let pipWindow = null
    let pipNoteId = null
    let pipUnsubscribe = null
    // A runtime that exposes the API but refuses to open a window (some Electron
    // builds) should not leave a dead button behind.
    let pipDisabled = false

    function pipAvailable() {
      return !pipDisabled &&
        typeof window !== 'undefined' &&
        !!window.documentPictureInPicture &&
        typeof window.documentPictureInPicture.requestWindow === 'function'
    }

    function teardownPip(closeWindow) {
      if (pipUnsubscribe) {
        pipUnsubscribe()
        pipUnsubscribe = null
      }
      const win = pipWindow
      pipWindow = null
      pipNoteId = null
      if (closeWindow && win && !win.closed) {
        try { win.close() } catch (err) { /* already gone */ }
      }
      emit()
    }

    function closePip() {
      teardownPip(true)
    }

    function paintPip(win, note) {
      const doc = win.document
      for (const name of PIP_TOKENS) {
        const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
        if (value) doc.documentElement.style.setProperty(name, value)
      }
      if (!doc.getElementById('dshn-pip-style')) {
        const style = doc.createElement('style')
        style.id = 'dshn-pip-style'
        style.textContent = PIP_CSS
        doc.head.appendChild(style)
      }
      let container = doc.getElementById('dshn-pip-root')
      if (!container) {
        container = doc.createElement('div')
        container.id = 'dshn-pip-root'
        doc.body.appendChild(container)
      }
      container.className = 'dshn-pip' + (note.important && !note.color ? ' is-important' : '')
      const tint = swatchOf(note)
      container.style.background = tint ? tint.bg : ''
      container.style.color = tint ? tint.ink : ''
      container.textContent = ''
      const text = doc.createElement('p')
      text.className = 'dshn-pip-text'
      text.textContent = note.text
      const foot = doc.createElement('div')
      foot.className = 'dshn-pip-foot'
      const time = doc.createElement('span')
      time.textContent = relativeTime(note.createdAt)
      const close = doc.createElement('button')
      close.type = 'button'
      close.className = 'dshn-pip-close'
      close.textContent = '取消固定'
      if (tint) {
        close.style.color = tint.ink
        close.style.borderColor = tint.border
      }
      close.addEventListener('click', () => { patchNote(note.id, { desktop: false }) })
      foot.appendChild(time)
      foot.appendChild(close)
      container.appendChild(text)
      container.appendChild(foot)
      doc.title = '便签'
    }

    async function openPip(noteId) {
      if (!pipAvailable()) return false
      const note = store.notes.find((item) => item.id === noteId)
      if (!note) return false
      closePip()
      let win
      try {
        win = await window.documentPictureInPicture.requestWindow({ width: 300, height: 260 })
      } catch (err) {
        pipDisabled = true
        emit()
        return false
      }
      pipWindow = win
      pipNoteId = noteId
      try {
        paintPip(win, note)
      } catch (err) {
        teardownPip(true)
        return false
      }
      const listener = () => {
        const current = store.notes.find((item) => item.id === noteId)
        if (!current || !current.desktop) {
          closePip()
          return
        }
        try { paintPip(win, current) } catch (err) { /* window may be closing */ }
      }
      listeners.add(listener)
      pipUnsubscribe = () => { listeners.delete(listener) }
      win.addEventListener('pagehide', () => {
        if (pipWindow === win) teardownPip(false)
      })
      emit()
      return true
    }

    /* ------------------------------------------------------------------ icons */

    function glyph(name, active) {
      const common = {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        width: 15,
        height: 15,
        style: { display: 'block' },
      }
      if (name === 'pin') {
        return h('svg', Object.assign({}, common, active ? { fill: 'currentColor' } : null),
          h('path', { d: 'M12 16.5V21' }),
          h('path', { d: 'M9 11.2a2 2 0 0 1-1.1 1.8l-1.6.8A1.8 1.8 0 0 0 5.4 15.5v.5h13.2v-.5a1.8 1.8 0 0 0-.9-1.7l-1.6-.8A2 2 0 0 1 15 11.2V7.5a1 1 0 0 1 1-1 1.8 1.8 0 0 0 0-3.5H8a1.8 1.8 0 0 0 0 3.5 1 1 0 0 1 1 1z' }))
      }
      if (name === 'star') {
        return h('svg', Object.assign({}, common, active ? { fill: 'currentColor' } : null),
          h('path', { d: 'M12 3.6l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z' }))
      }
      if (name === 'screen') {
        return h('svg', common,
          h('rect', { x: 3, y: 4.5, width: 18, height: 12, rx: 1.6 }),
          h('path', { d: 'M9 20.5h6M12 16.5v4' }))
      }
      if (name === 'palette') {
        return h('svg', common,
          h('path', { d: 'M12 3.4a8.6 8.6 0 1 0 0 17.2h1.3a1.7 1.7 0 0 0 1.05-3.04 1.7 1.7 0 0 1 1.05-3.04H18a3 3 0 0 0 3-3A8.6 8.6 0 0 0 12 3.4z' }),
          h('circle', { cx: 8.4, cy: 10.2, r: 0.95, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 12, cy: 7.6, r: 0.95, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 15.7, cy: 10.2, r: 0.95, fill: 'currentColor', stroke: 'none' }))
      }
      return h('svg', common,
        h('path', { d: 'M4 6.5h16M9.5 6.5V4.8h5v1.7M6.5 6.5l.9 13.2h9.2l.9-13.2M10 10.5v5.5M14 10.5v5.5' }))
    }

    function NotesIcon(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.55,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('path', { d: 'M5.6 4.1A1.6 1.6 0 0 1 7.2 2.5h7.4l4.8 4.8v12.6a1.6 1.6 0 0 1-1.6 1.6H7.2a1.6 1.6 0 0 1-1.6-1.6z' }),
      h('path', { d: 'M14.4 2.5v4.8h4.9' }),
      h('path', { d: 'M8.6 12.2h6.8M8.6 15.8h4.4' }))
    }

    /* ------------------------------------------------------------------ panel */

    const FILTERS = [
      ['all', '全部'],
      ['important', '重点'],
      ['pinned', '置顶'],
      ['desktop', '已固定'],
    ]

    function ActionButton(props) {
      const className = 'dshn-act' +
        (props.active ? ' is-on' : '') +
        (props.danger ? ' is-danger' : '')
      return h('button', {
        type: 'button',
        title: props.label,
        'aria-label': props.label,
        'aria-pressed': props.active === undefined ? undefined : props.active,
        className,
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onClick()
        },
      }, props.children)
    }

    function PaletteDots(props) {
      const current = props.value || null
      const auto = h('button', {
        type: 'button',
        key: 'auto',
        className: 'dshn-dot dshn-dot--auto',
        title: '默认底色',
        'aria-label': '默认底色',
        'aria-pressed': current === null,
        style: current === null
          ? { outline: '2px solid var(--dsw-alias-label-secondary)', outlineOffset: '1px' }
          : null,
        onClick: () => props.onPick(null),
      })
      return h('div', { className: 'dshn-dots' },
        [auto].concat(PALETTE.map((entry) => h('button', {
          key: entry.key,
          type: 'button',
          className: 'dshn-dot',
          title: entry.name,
          'aria-label': entry.name,
          'aria-pressed': current === entry.key,
          style: {
            background: entry.bg,
            borderColor: entry.border,
            outline: current === entry.key ? '2px solid ' + entry.ink : null,
            outlineOffset: '1px',
          },
          onClick: () => props.onPick(entry.key),
        }))))
    }

    /* 「**这样**」是唯一的加粗写法：文字本身还是纯文本，所以存档、搜索、
       桌面挂件都读得懂，不依赖任何富文本格式。 */
    function renderRich(text) {
      const source = String(text == null ? '' : text)
      return source.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
        part.length > 4 && part.startsWith('**') && part.endsWith('**')
          ? h('strong', { key: index }, part.slice(2, -2))
          : part
      ))
    }

    /** 加粗键：Ctrl/⌘+B 会被宿主的侧边栏快捷键抢走，所以 Alt+B 是主力。 */
    function isBoldKey(event) {
      if (String(event.key || '').toLowerCase() !== 'b') return false
      return Boolean(event.ctrlKey || event.metaKey || event.altKey)
    }

    /** 拦下这次按键，尽量不让宿主的全局快捷键收到。 */
    function swallowKey(event) {
      event.preventDefault()
      event.stopPropagation()
      try {
        if (event.nativeEvent && typeof event.nativeEvent.stopImmediatePropagation === 'function') {
          event.nativeEvent.stopImmediatePropagation()
        }
      } catch (err) { /* 老浏览器没有这个方法 */ }
    }

    function restoreSelection(el, start, end) {
      window.requestAnimationFrame(() => {
        try {
          el.focus()
          el.setSelectionRange(start, end)
        } catch (err) { /* 元素已经不在了 */ }
      })
    }

    /** 给 textarea 里选中的一段加粗/取消加粗。没有选中就什么都不做。 */
    function applyBold(el, value, onChange) {
      if (!el) return false
      const start = el.selectionStart
      const end = el.selectionEnd
      if (start == null || end == null || start === end) return false
      const before = value.slice(0, start)
      const inner = value.slice(start, end)
      const after = value.slice(end)
      if (before.endsWith('**') && after.startsWith('**')) {
        onChange(before.slice(0, -2) + inner + after.slice(2))
        restoreSelection(el, start - 2, end - 2)
        return true
      }
      onChange(before + '**' + inner + '**' + after)
      restoreSelection(el, start + 2, end + 2)
      return true
    }

    function NoteCard(props) {
      const note = props.note
      const swatch = swatchOf(note)
      const [paletteOpen, setPaletteOpen] = useState(false)
      const surface = swatch
        ? {
          background: swatch.bg,
          borderColor: swatch.border,
          color: swatch.ink,
          boxShadow: note.pinned ? 'inset 3px 0 0 0 ' + swatch.border : null,
        }
        : null
      return h('article', {
        className: 'dshn-card' +
          (note.pinned && !swatch ? ' dshn-card--pinned' : '') +
          (note.important && !swatch ? ' dshn-card--important' : '') +
          (props.editing ? ' dshn-card--editing' : ''),
        'data-colored': swatch ? 'true' : 'false',
        style: surface,
      },
      h('p', {
        className: 'dshn-card-text',
        title: '双击把这张便签的文字送进上面的输入框，改完点保存',
        onDoubleClick: () => {
          if (props.onEdit) props.onEdit(note)
        },
      }, renderRich(note.text)),
      h('div', { className: 'dshn-card-foot' },
        h('span', { className: 'dshn-time' }, relativeTime(note.createdAt)),
        note.important ? h('span', { className: 'dshn-tag' }, '重点') : null,
        note.pinned ? h('span', { className: 'dshn-tag' }, '置顶') : null,
        note.desktop ? h('span', { className: 'dshn-tag' }, '固定') : null,
        h('div', { className: 'dshn-actions' },
          h(ActionButton, {
            label: '换底色',
            active: paletteOpen,
            onClick: () => setPaletteOpen(!paletteOpen),
          }, glyph('palette', paletteOpen)),
          h(ActionButton, {
            label: note.pinned ? '取消置顶' : '置顶',
            active: note.pinned,
            onClick: () => patchNote(note.id, { pinned: !note.pinned }),
          }, glyph('pin', note.pinned)),
          h(ActionButton, {
            label: note.important ? '取消重点' : '标为重点',
            active: note.important,
            onClick: () => patchNote(note.id, { important: !note.important }),
          }, glyph('star', note.important)),
          h(ActionButton, {
            label: note.desktop ? '取消桌面固定' : '固定在桌面上',
            active: note.desktop,
            onClick: () => patchNote(note.id, { desktop: !note.desktop, pos: note.desktop ? null : note.pos }),
          }, glyph('screen', note.desktop)),
          h(ActionButton, {
            label: '删除',
            danger: true,
            onClick: () => removeNote(note.id),
          }, glyph('trash', false))
        )
      ),
      paletteOpen ? h('div', { className: 'dshn-card-palette' },
        h(PaletteDots, {
          value: note.color,
          onPick: (value) => {
            patchNote(note.id, { color: value })
            setPaletteOpen(false)
          },
        })) : null
      )
    }

    function NotesPanel() {
      const state = useStore()
      const [draft, setDraft] = useState('')
      const inputRef = useRef(null)
      const composerRef = useRef(null)
      const [editingId, setEditingId] = useState(null)
      const [filter, setFilter] = useState('all')
      const [color, setColor] = useState(null)
      const [composerHeight, setComposerHeight] = useState(() => {
        try {
          const saved = Number(window.localStorage.getItem('dshn-composer-height'))
          if (Number.isFinite(saved) && saved >= 54) return saved
        } catch (err) { /* 隐私模式下读不到 localStorage */ }
        return 54
      })
      const heightRef = useRef(composerHeight)
      heightRef.current = composerHeight

      const startResize = (event) => {
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault()
        const startY = event.clientY
        const startH = heightRef.current
        const limit = Math.round(window.innerHeight * 0.6)
        const onMove = (moveEvent) => {
          setComposerHeight(Math.max(54, Math.min(limit, startH + (moveEvent.clientY - startY))))
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          try {
            window.localStorage.setItem('dshn-composer-height', String(heightRef.current))
          } catch (err) { /* ignore */ }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }

      useEffect(() => {
        void loadNotes()
        const timer = window.setInterval(() => {
          if (!document.hidden) void refreshFromServer()
        }, 15000)
        return () => window.clearInterval(timer)
      }, [])

      const notes = useMemo(() => ordered(state.notes), [state.notes])
      const visible = useMemo(() => notes.filter((note) => {
        if (filter === 'important') return note.important
        if (filter === 'pinned') return note.pinned
        if (filter === 'desktop') return note.desktop
        return true
      }), [notes, filter])

      const submit = useCallback((event) => {
        if (event) {
          const native = event.nativeEvent || {}
          if (native.isComposing || native.keyCode === 229) return
        }
        const value = draft.trim()
        if (!value) return
        if (editingId) {
          // 正在改的就地写回那张便签；万一它已经被删了，就当成新便签存下来，
          // 免得辛苦打的字凭空消失。
          const exists = state.notes.some((note) => note.id === editingId)
          if (exists) patchNote(editingId, { text: value, color: color || null })
          else addNote(value, color)
          setEditingId(null)
          setColor(null)
        } else {
          addNote(value, color)
        }
        setDraft('')
      }, [draft, color, editingId, state.notes])

      const cancelEdit = useCallback(() => {
        setEditingId(null)
        setDraft('')
        setColor(null)
      }, [])

      const beginEditNote = useCallback((note) => {
        setEditingId(note.id)
        setDraft(note.text)
        setColor(note.color || null)
        if (note.text.length > 40) setComposerHeight((current) => Math.max(current, 120))
        window.requestAnimationFrame(() => {
          if (composerRef.current) {
            composerRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
          const el = inputRef.current
          if (!el) return
          el.focus()
          try {
            el.setSelectionRange(note.text.length, note.text.length)
          } catch (err) { /* 老浏览器 */ }
        })
      }, [])

      const onKeyDown = useCallback((event) => {
        if (event.key === 'Escape' && editingId) {
          event.preventDefault()
          cancelEdit()
          return
        }
        if (isBoldKey(event)) {
          swallowKey(event)
          applyBold(event.currentTarget, draft, setDraft)
          return
        }
        if (event.key !== 'Enter') return
        if (event.shiftKey) return
        event.preventDefault()
        submit(event)
      }, [draft, submit, editingId, cancelEdit])

      const fixedCount = notes.filter((note) => note.desktop).length
      const status = state.saving
        ? '保存中…'
        : state.error
          ? (state.error === 'offline' ? '服务器不可达，已存本地' : state.error)
          : fixedCount
            ? (state.widgetKnown
              ? (state.widgetRunning ? '桌面挂件运行中 · ' + fixedCount + ' 张' : '桌面挂件启动中…')
              : '桌面挂件未加载：重启 DSH 后生效')
            : ''

      return h('div', { className: 'dshn-root' },
        h('style', null, CSS),
        h('div', { className: 'dshn-inner' },
          h('header', { className: 'dshn-head' },
            h('div', { className: 'dshn-title-row' },
              h('h1', { className: 'dshn-title' }, '便签墙'),
              h('span', { className: 'dshn-count' }, visible.length + ' / ' + notes.length)
            ),
            h('p', { className: 'dshn-sub' }, '回车记一条，可先挑个底色；置顶排最前，重点标星；点屏幕图标固定到电脑桌面。双击便签可把文字送回输入框修改，选中文字按 Alt+B 加粗。')
          ),
          h('div', {
            ref: composerRef,
            className: 'dshn-composer',
            'data-colored': color ? 'true' : 'false',
            style: color ? {
              background: PALETTE_BY_KEY[color].bg,
              borderColor: PALETTE_BY_KEY[color].border,
              color: PALETTE_BY_KEY[color].ink,
            } : null,
          },
          editingId ? h('div', { className: 'dshn-edit-badge' },
            h('span', null, '正在修改这张便签 · 改完点「保存修改」'),
            h('button', {
              type: 'button',
              className: 'dshn-linkbtn',
              onClick: cancelEdit,
            }, '取消（Esc）')
          ) : null,
          h('textarea', {
            ref: inputRef,
            className: 'dshn-input',
            value: draft,
            placeholder: editingId
              ? '修改完按 Enter 存回原便签，Shift+Enter 换行，Esc 取消'
              : '写下你的下一个灵感…（Enter 保存，Shift+Enter 换行）',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown,
            spellCheck: false,
            style: { height: composerHeight + 'px' },
          }),
          h('div', {
            className: 'dshn-grip',
            title: '上下拖动可以调整输入框高度，双击复原',
            onPointerDown: startResize,
            onDoubleClick: () => {
              setComposerHeight(54)
              try { window.localStorage.removeItem('dshn-composer-height') } catch (err) { /* ignore */ }
            },
          }),
          h('div', { className: 'dshn-composer-row' },
            h(PaletteDots, { value: color, onPick: setColor }),
            h('button', {
              type: 'button',
              className: 'dshn-bold',
              title: '选中一段文字后点这里加粗（Alt+B），再点一次取消',
              onClick: () => applyBold(inputRef.current, draft, setDraft),
            }, 'B'),
            h('span', { className: 'dshn-hint' }, '选中文字可按 Alt+B 加粗'),
            h('button', {
              type: 'button',
              className: 'dshn-add',
              disabled: !draft.trim(),
              style: color ? { background: PALETTE_BY_KEY[color].ink, color: PALETTE_BY_KEY[color].bg } : null,
              onClick: () => submit(null),
            }, editingId ? '保存修改' : '添加到墙上')
          )),
          h('div', { className: 'dshn-toolbar' },
            FILTERS.map(([key, label]) => h('button', {
              key,
              type: 'button',
              className: 'dshn-chip' + (filter === key ? ' is-on' : ''),
              'aria-pressed': filter === key,
              onClick: () => setFilter(key),
            }, label)),
            status ? h('span', { className: 'dshn-status' }, status) : null
          ),
          visible.length === 0
            ? h('div', { className: 'dshn-empty' }, notes.length === 0 ? '还没有便签，上面写第一条。' : '这个筛选下没有便签。')
            : h('div', { className: 'dshn-grid' },
              visible.map((note) => h(NoteCard, {
                key: note.id,
                note,
                editing: note.id === editingId,
                onEdit: beginEditNote,
              })))
        )
      )
    }

    /* --------------------------------------------------------------- overlay */

    function DesktopLayer() {
      const state = useStore()
      const [drag, setDrag] = useState(null)
      const [live, setLive] = useState({})

      useEffect(() => { void loadNotes() }, [])

      const startDrag = (event, note, pos) => {
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault()
        setDrag({ id: note.id, startX: event.clientX, startY: event.clientY, origin: pos })
      }

      useEffect(() => {
        if (!drag) return undefined
        const onMove = (event) => {
          const x = Math.max(8, drag.origin.x + event.clientX - drag.startX)
          const y = Math.max(8, drag.origin.y + event.clientY - drag.startY)
          setLive((current) => Object.assign({}, current, { [drag.id]: { x, y } }))
        }
        const onUp = (event) => {
          const x = Math.max(8, drag.origin.x + event.clientX - drag.startX)
          const y = Math.max(8, drag.origin.y + event.clientY - drag.startY)
          patchNote(drag.id, { pos: { x, y } })
          setDrag(null)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }, [drag])

      const fixed = state.notes.filter((note) => note.desktop)
      // When the native desktop widget is running it owns these notes: a real
      // always-on-top window that stays visible after the Harness is minimized.
      // The in-window card below is only the fallback for that case.
      if (state.widgetRunning || !fixed.length) return null

      const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth

      return h('div', { className: 'dshn-layer' },
        h('style', null, CSS),
        fixed.map((note, index) => {
          if (pipNoteId === note.id) return null
          const pos = live[note.id] || note.pos || { x: Math.max(8, viewportWidth - 296), y: 88 + index * 34 }
          const swatch = swatchOf(note)
          return h('div', {
            key: note.id,
            className: 'dshn-pin' + (note.important && !swatch ? ' dshn-pin--important' : ''),
            'data-colored': swatch ? 'true' : 'false',
            style: Object.assign(
              { left: pos.x + 'px', top: pos.y + 'px' },
              swatch ? { background: swatch.bg, borderColor: swatch.border, color: swatch.ink } : null,
            ),
          },
          h('div', {
            className: 'dshn-pin-head',
            onPointerDown: (event) => {
              const target = event.target
              if (target && target.closest && target.closest('button')) return
              startDrag(event, note, pos)
            },
          },
          h('span', { className: 'dshn-pin-dot' }),
          h('span', { className: 'dshn-pin-title' }, note.important ? '重点便签' : '便签'),
          pipAvailable() ? h('button', {
            type: 'button',
            className: 'dshn-pin-close',
            title: '弹出为独立窗口（始终置顶）',
            'aria-label': '弹出为独立窗口',
            onPointerDown: (event) => event.stopPropagation(),
            onClick: () => { void openPip(note.id) },
          }, '⤢') : null,
          h('button', {
            type: 'button',
            className: 'dshn-pin-close',
            title: '取消固定',
            'aria-label': '取消固定',
            onPointerDown: (event) => event.stopPropagation(),
            onClick: () => patchNote(note.id, { desktop: false }),
          }, '×')
          ),
          h('p', { className: 'dshn-pin-text' }, renderRich(note.text)),
          h('div', { className: 'dshn-pin-foot' }, relativeTime(note.createdAt)))
        })
      )
    }

    /* ---------------------------------------------------------------- plugin */

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-notes',
          order: 20,
          label: '便签墙',
        }, NotesIcon)), 'dsh-notes: sidebar entry')

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-notes',
        }, NotesPanel)), 'dsh-notes: wall panel')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-notes-desktop',
          order: 20,
          label: '便签墙浮动便签',
        }, DesktopLayer)), 'dsh-notes: desktop cards')

        ctx.effect(() => () => { closePip() }, 'dsh-notes: floating window cleanup')
      },
    }
  },
})
