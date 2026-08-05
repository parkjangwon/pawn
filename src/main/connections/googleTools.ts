/**
 * Google Workspace tools (read-only) using local OAuth tokens.
 */

import { getGoogleAccessToken } from './google'
import { clampInt, errMsg, fetchJson, truncate } from './http'

export type GoogleToolResult = { ok: boolean; text: string; error?: string }

async function tokenOrErr(): Promise<{ token: string } | GoogleToolResult> {
  const token = await getGoogleAccessToken()
  if (!token) {
    return {
      ok: false,
      text: '',
      error:
        'Google is not connected. Open Settings → Connections and connect Google first.'
    }
  }
  return { token }
}

function gfetch(url: string, token: string, init?: RequestInit) {
  return fetchJson(url, { ...init, token })
}

/** Decode Gmail body parts (base64url). */
function decodeB64Url(data: string): string {
  try {
    const pad = data.length % 4 === 0 ? '' : '='.repeat(4 - (data.length % 4))
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/') + pad
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function extractGmailBody(payload: unknown, depth = 0): string {
  if (!payload || typeof payload !== 'object' || depth > 12) return ''
  const p = payload as {
    mimeType?: string
    body?: { data?: string }
    parts?: unknown[]
  }
  if (p.body?.data && (p.mimeType?.startsWith('text/') || !p.mimeType)) {
    return decodeB64Url(p.body.data)
  }
  if (Array.isArray(p.parts)) {
    let plain = ''
    let html = ''
    for (const part of p.parts) {
      const t = extractGmailBody(part, depth + 1)
      const mt = (part as { mimeType?: string })?.mimeType || ''
      if (mt === 'text/plain' && t) plain = t
      else if (mt === 'text/html' && t) html = t
      else if (t && !plain) plain = t
    }
    return plain || html
  }
  return ''
}

function headerMap(headers: Array<{ name?: string; value?: string }> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers || []) {
    if (h.name && h.value) out[h.name.toLowerCase()] = h.value
  }
  return out
}

function docsToText(doc: Record<string, unknown>): string {
  const body = doc.body as { content?: Array<Record<string, unknown>> } | undefined
  if (!body?.content) return JSON.stringify(doc).slice(0, 2000)
  const lines: string[] = []
  const walk = (elements: Array<Record<string, unknown>>): void => {
    for (const el of elements) {
      if (el.paragraph) {
        const para = el.paragraph as { elements?: Array<{ textRun?: { content?: string } }> }
        const text = (para.elements || []).map((e) => e.textRun?.content || '').join('')
        if (text.trim()) lines.push(text.replace(/\n$/, ''))
      }
      if (el.table) {
        const table = el.table as { tableRows?: Array<{ tableCells?: Array<{ content?: Array<Record<string, unknown>> }> }> }
        for (const row of table.tableRows || []) {
          const cells: string[] = []
          for (const cell of row.tableCells || []) {
            const before = lines.length
            walk(cell.content || [])
            cells.push(lines.splice(before).join(' ').trim())
          }
          lines.push('| ' + cells.join(' | ') + ' |')
        }
      }
    }
  }
  walk(body.content)
  return lines.join('\n')
}

function slidesToText(pres: Record<string, unknown>): string {
  const title = String(pres.title || 'Presentation')
  const slides = (pres.slides as Array<Record<string, unknown>>) || []
  const out: string[] = [`# ${title}`, `slides: ${slides.length}`, '']
  slides.forEach((slide, i) => {
    out.push(`## Slide ${i + 1}`)
    const texts: string[] = []
    const pageElements = (slide.pageElements as Array<Record<string, unknown>>) || []
    for (const el of pageElements) {
      const shape = el.shape as { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } | undefined
      if (shape?.text?.textElements) {
        const t = shape.text.textElements.map((te) => te.textRun?.content || '').join('')
        if (t.trim()) texts.push(t.trim())
      }
    }
    out.push(texts.join('\n') || '(no text)')
    out.push('')
  })
  return out.join('\n')
}

export async function googleWhoami(): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const res = await gfetch('https://www.googleapis.com/oauth2/v2/userinfo', t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'userinfo failed') }
  const u = res.body as { email?: string; name?: string; id?: string }
  return {
    ok: true,
    text: truncate(
      [`Google account`, `email: ${u.email || '(unknown)'}`, `name: ${u.name || ''}`, `id: ${u.id || ''}`].join('\n')
    )
  }
}

export async function googleDriveSearch(query: string, pageSize = 20): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const n = clampInt(pageSize, 20, 1, 50)
  const q = (query || '').trim() || "trashed = false"
  const url =
    'https://www.googleapis.com/drive/v3/files?' +
    new URLSearchParams({
      q,
      pageSize: String(n),
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName,emailAddress)),nextPageToken',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    })
  const res = await gfetch(url, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Drive search failed') }
  const files = ((res.body as { files?: Array<Record<string, unknown>> }).files) || []
  if (files.length === 0) return { ok: true, text: `No Drive files for q=${JSON.stringify(q)}` }
  const lines = files.map((f) => {
    const owners = Array.isArray(f.owners)
      ? (f.owners as Array<{ emailAddress?: string }>).map((o) => o.emailAddress).filter(Boolean).join(',')
      : ''
    return [
      `- ${f.name}`,
      `  id: ${f.id}`,
      `  mime: ${f.mimeType}`,
      f.modifiedTime ? `  modified: ${f.modifiedTime}` : null,
      f.size ? `  size: ${f.size}` : null,
      owners ? `  owners: ${owners}` : null,
      f.webViewLink ? `  link: ${f.webViewLink}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return { ok: true, text: truncate(`Drive search q=${JSON.stringify(q)}\n\n${lines.join('\n')}`) }
}

export async function googleDriveRead(fileId: string, maxChars = 40_000): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const id = fileId.trim()
  if (!id) return { ok: false, text: '', error: 'file_id is required' }

  const metaRes = await gfetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,webViewLink,modifiedTime&supportsAllDrives=true`,
    t.token
  )
  if (!metaRes.ok) return { ok: false, text: '', error: errMsg(metaRes.status, metaRes.body, 'Drive metadata failed') }
  const meta = metaRes.body as { id?: string; name?: string; mimeType?: string; webViewLink?: string; modifiedTime?: string }
  const mime = meta.mimeType || ''

  const header = [
    `file: ${meta.name}`,
    `id: ${meta.id}`,
    `mime: ${mime}`,
    meta.modifiedTime ? `modified: ${meta.modifiedTime}` : null,
    meta.webViewLink ? `link: ${meta.webViewLink}` : null
  ]
    .filter(Boolean)
    .join('\n')

  // Google native types → export
  const exportMap: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing': 'image/png'
  }
  if (exportMap[mime]) {
    if (mime === 'application/vnd.google-apps.drawing') {
      return { ok: true, text: truncate(`${header}\n\n(Drawing — open link to view; binary export not inlined.)`) }
    }
    const exp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportMap[mime])}`,
      { headers: { Authorization: `Bearer ${t.token}` } }
    )
    if (!exp.ok) {
      const body = await exp.text().catch(() => '')
      return { ok: false, text: '', error: `Drive export failed (${exp.status}): ${body.slice(0, 200)}` }
    }
    const text = await exp.text()
    return { ok: true, text: truncate(`${header}\n\n${text}`, clampInt(maxChars, 40_000, 1000, 80_000)) }
  }

  // Binary / text media download (cap size)
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/javascript') {
    const dl = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${t.token}` } }
    )
    if (!dl.ok) return { ok: false, text: '', error: `Drive download failed (${dl.status})` }
    const text = await dl.text()
    return { ok: true, text: truncate(`${header}\n\n${text}`, clampInt(maxChars, 40_000, 1000, 80_000)) }
  }

  return {
    ok: true,
    text: truncate(
      `${header}\n\n(Binary or unsupported type for inline read. Use google_docs_read / google_sheets_read / google_slides_read when applicable, or open the link.)`
    )
  }
}

export async function googleGmailSearch(query: string, maxResults = 10): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const n = clampInt(maxResults, 10, 1, 30)
  const q = (query || '').trim() || 'in:inbox'
  const listUrl =
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?' +
    new URLSearchParams({ q, maxResults: String(n) })
  const list = await gfetch(listUrl, t.token)
  if (!list.ok) return { ok: false, text: '', error: errMsg(list.status, list.body, 'Gmail search failed') }
  const ids = ((list.body as { messages?: Array<{ id: string }> }).messages || []).map((m) => m.id)
  if (ids.length === 0) return { ok: true, text: `No messages for q=${JSON.stringify(q)}` }

  const lines: string[] = [`Gmail search q=${JSON.stringify(q)}`, `count=${ids.length}`, '']
  for (const id of ids) {
    const mres = await gfetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      t.token
    )
    if (!mres.ok) {
      lines.push(`- id=${id} (metadata error ${mres.status})`)
      continue
    }
    const msg = mres.body as {
      id?: string
      snippet?: string
      payload?: { headers?: Array<{ name?: string; value?: string }> }
    }
    const h = headerMap(msg.payload?.headers)
    lines.push(
      [
        `- id: ${msg.id}`,
        `  date: ${h.date || ''}`,
        `  from: ${h.from || ''}`,
        `  subject: ${h.subject || ''}`,
        msg.snippet ? `  snippet: ${msg.snippet}` : null
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function googleGmailRead(messageId: string): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const id = messageId.trim()
  if (!id) return { ok: false, text: '', error: 'message_id is required' }
  const res = await gfetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    t.token
  )
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Gmail get failed') }
  const msg = res.body as {
    id?: string
    snippet?: string
    payload?: { headers?: Array<{ name?: string; value?: string }>; mimeType?: string; body?: { data?: string }; parts?: unknown[] }
  }
  const h = headerMap(msg.payload?.headers)
  const body = extractGmailBody(msg.payload) || msg.snippet || ''
  return {
    ok: true,
    text: truncate(
      [
        `id: ${msg.id}`,
        `date: ${h.date || ''}`,
        `from: ${h.from || ''}`,
        `to: ${h.to || ''}`,
        `cc: ${h.cc || ''}`,
        `subject: ${h.subject || ''}`,
        '',
        body
      ].join('\n')
    )
  }
}

export async function googleCalendarList(opts: {
  timeMin?: string
  timeMax?: string
  maxResults?: number
  calendarId?: string
}): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const cal = (opts.calendarId || 'primary').trim() || 'primary'
  const n = clampInt(opts.maxResults, 20, 1, 50)
  const now = new Date()
  const timeMin = opts.timeMin || now.toISOString()
  const timeMax =
    opts.timeMax ||
    new Date(now.getTime() + 7 * 24 * 3600_000).toISOString()
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events?` +
    new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(n),
      singleEvents: 'true',
      orderBy: 'startTime'
    })
  const res = await gfetch(url, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Calendar list failed') }
  const items = ((res.body as { items?: Array<Record<string, unknown>> }).items) || []
  if (items.length === 0) {
    return { ok: true, text: `No events on ${cal} between ${timeMin} and ${timeMax}` }
  }
  const lines = items.map((ev) => {
    const start = (ev.start as { dateTime?: string; date?: string }) || {}
    const end = (ev.end as { dateTime?: string; date?: string }) || {}
    return [
      `- ${ev.summary || '(no title)'}`,
      `  id: ${ev.id}`,
      `  start: ${start.dateTime || start.date || ''}`,
      `  end: ${end.dateTime || end.date || ''}`,
      ev.location ? `  location: ${ev.location}` : null,
      ev.htmlLink ? `  link: ${ev.htmlLink}` : null,
      ev.description ? `  desc: ${String(ev.description).slice(0, 200)}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return {
    ok: true,
    text: truncate(`Calendar ${cal}\nfrom ${timeMin} to ${timeMax}\n\n${lines.join('\n')}`)
  }
}

export async function googleTasksList(taskListId?: string, maxResults = 30): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const n = clampInt(maxResults, 30, 1, 100)

  if (!taskListId) {
    const lists = await gfetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', t.token)
    if (!lists.ok) return { ok: false, text: '', error: errMsg(lists.status, lists.body, 'Task lists failed') }
    const items = ((lists.body as { items?: Array<{ id?: string; title?: string }> }).items) || []
    if (items.length === 0) return { ok: true, text: 'No task lists' }
    const lines = items.map((l) => `- ${l.title}\n  id: ${l.id}`)
    return {
      ok: true,
      text: truncate(
        `Task lists:\n\n${lines.join('\n')}\n\nCall again with task_list_id to list tasks.`
      )
    }
  }

  const url =
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks?` +
    new URLSearchParams({ maxResults: String(n), showCompleted: 'true', showHidden: 'false' })
  const res = await gfetch(url, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Tasks list failed') }
  const items = ((res.body as { items?: Array<Record<string, unknown>> }).items) || []
  if (items.length === 0) return { ok: true, text: `No tasks in list ${taskListId}` }
  const lines = items.map((task) => {
    return [
      `- ${task.title || '(untitled)'}`,
      `  id: ${task.id}`,
      `  status: ${task.status || ''}`,
      task.due ? `  due: ${task.due}` : null,
      task.notes ? `  notes: ${String(task.notes).slice(0, 200)}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return { ok: true, text: truncate(`Tasks in ${taskListId}\n\n${lines.join('\n')}`) }
}

export async function googleSheetsRead(spreadsheetId: string, range?: string): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const id = spreadsheetId.trim()
  if (!id) return { ok: false, text: '', error: 'spreadsheet_id is required' }

  if (!range) {
    const meta = await gfetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=properties.title,sheets.properties`,
      t.token
    )
    if (!meta.ok) return { ok: false, text: '', error: errMsg(meta.status, meta.body, 'Sheets metadata failed') }
    const body = meta.body as {
      properties?: { title?: string }
      sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>
    }
    const sheets = (body.sheets || []).map((s) => s.properties?.title).filter(Boolean)
    return {
      ok: true,
      text: truncate(
        `Spreadsheet: ${body.properties?.title || id}\nid: ${id}\nsheets: ${sheets.join(', ') || '(none)'}\n\nPass range e.g. "Sheet1!A1:D50" to read values.`
      )
    }
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}` +
    '?valueRenderOption=FORMATTED_VALUE'
  const res = await gfetch(url, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Sheets values failed') }
  const values = ((res.body as { values?: unknown[][] }).values) || []
  if (values.length === 0) return { ok: true, text: `No values in range ${range}` }
  const maxCols = Math.min(30, Math.max(...values.map((r) => r.length), 1))
  const rows = values.slice(0, 100).map((row) => {
    const cells = []
    for (let i = 0; i < maxCols; i++) cells.push(String(row[i] ?? ''))
    return '| ' + cells.join(' | ') + ' |'
  })
  return {
    ok: true,
    text: truncate(`Sheet range ${range} (${values.length} rows)\n\n${rows.join('\n')}`)
  }
}

export async function googleDocsRead(documentId: string): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const id = documentId.trim()
  if (!id) return { ok: false, text: '', error: 'document_id is required' }
  const res = await gfetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`,
    t.token
  )
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Docs get failed') }
  const doc = res.body as Record<string, unknown>
  const title = String(doc.title || id)
  const text = docsToText(doc)
  return { ok: true, text: truncate(`# ${title}\nid: ${id}\n\n${text}`) }
}

export async function googleSlidesRead(presentationId: string): Promise<GoogleToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const id = presentationId.trim()
  if (!id) return { ok: false, text: '', error: 'presentation_id is required' }
  const res = await gfetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}`,
    t.token
  )
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'Slides get failed') }
  return { ok: true, text: truncate(slidesToText(res.body as Record<string, unknown>)) }
}

export type GoogleToolName =
  | 'google_whoami'
  | 'google_drive_search'
  | 'google_drive_read'
  | 'google_gmail_search'
  | 'google_gmail_read'
  | 'google_calendar_list'
  | 'google_tasks_list'
  | 'google_sheets_read'
  | 'google_docs_read'
  | 'google_slides_read'

export async function runGoogleTool(
  name: GoogleToolName,
  args: Record<string, unknown>
): Promise<GoogleToolResult> {
  switch (name) {
    case 'google_whoami':
      return googleWhoami()
    case 'google_drive_search':
      return googleDriveSearch(String(args.query ?? ''), Number(args.max_results))
    case 'google_drive_read':
      return googleDriveRead(String(args.file_id ?? ''), Number(args.max_chars))
    case 'google_gmail_search':
      return googleGmailSearch(String(args.query ?? ''), Number(args.max_results))
    case 'google_gmail_read':
      return googleGmailRead(String(args.message_id ?? ''))
    case 'google_calendar_list':
      return googleCalendarList({
        timeMin: args.time_min ? String(args.time_min) : undefined,
        timeMax: args.time_max ? String(args.time_max) : undefined,
        maxResults: Number(args.max_results),
        calendarId: args.calendar_id ? String(args.calendar_id) : undefined
      })
    case 'google_tasks_list':
      return googleTasksList(
        args.task_list_id ? String(args.task_list_id) : undefined,
        Number(args.max_results)
      )
    case 'google_sheets_read':
      return googleSheetsRead(
        String(args.spreadsheet_id ?? ''),
        args.range ? String(args.range) : undefined
      )
    case 'google_docs_read':
      return googleDocsRead(String(args.document_id ?? ''))
    case 'google_slides_read':
      return googleSlidesRead(String(args.presentation_id ?? ''))
    default:
      return { ok: false, text: '', error: `Unknown Google tool: ${name}` }
  }
}
