/**
 * Phase 0 — official public-API router (sanctioned site-aware routes).
 * Port of insane-search engine/phase0.py + public API expansions (MIT).
 *
 * Platforms with no-auth public endpoints are tried BEFORE the generic grid.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { httpGet } from './transport'

const execFileAsync = promisify(execFile)

export interface Phase0Attempt {
  platform: string
  route: string
  ok: boolean
  status: number
  bytes: number
  note: string
}

export interface Phase0Result {
  platform: string
  ok: boolean
  route: string | null
  content: string
  finalUrl: string
  attempts: Phase0Attempt[]
}

function attempt(
  platform: string,
  route: string,
  ok: boolean,
  status: number,
  body: string,
  note = ''
): Phase0Attempt {
  return { platform, route, ok, status, bytes: (body || '').length, note }
}

function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h.startsWith('www.') ? h.slice(4) : h
  } catch {
    return ''
  }
}

function detect(url: string): string | null {
  const h = hostOf(url)
  if (!h) return null
  if (h.includes('reddit.com') || h === 'redd.it') return 'reddit'
  if (h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com'))
    return 'x'
  if (h.includes('youtube.com') || h === 'youtu.be') return 'youtube'
  if (h === 'threads.com' || h === 'threads.net' || h.endsWith('.threads.com') || h.endsWith('.threads.net'))
    return 'threads'
  if (h === 'news.ycombinator.com' || h === 'hn.algolia.com') return 'hn'
  if (h === 'bsky.app' || h.endsWith('.bsky.social') || h === 'public.api.bsky.app') return 'bluesky'
  if (h.endsWith('wikipedia.org')) return 'wikipedia'
  if (h === 'arxiv.org' || h.endsWith('.arxiv.org')) return 'arxiv'
  if (h === 'github.com' || h === 'raw.githubusercontent.com' || h === 'gist.github.com') return 'github'
  if (h.includes('stackoverflow.com') || h === 'stackexchange.com' || h.endsWith('.stackexchange.com'))
    return 'stackoverflow'
  if (h === 'npmjs.com' || h === 'www.npmjs.com' || h === 'registry.npmjs.org') return 'npm'
  if (h === 'pypi.org' || h === 'pypi.python.org') return 'pypi'
  return null
}

async function getText(
  url: string,
  timeoutMs: number,
  accept?: string
): Promise<{ status: number; text: string; finalUrl: string; error?: string }> {
  const { resp, error } = await httpGet(url, {
    identity: 'safari',
    timeoutMs,
    accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    refererStrategy: 'none'
  })
  if (!resp) return { status: 0, text: '', finalUrl: url, error }
  return { status: resp.status, text: resp.text, finalUrl: resp.url }
}

// --- reddit -----------------------------------------------------------------
async function reddit(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  const base = url.split('?')[0].replace(/\/$/, '')
  const rssUrl = base.includes('/comments/') ? `${base}.rss` : `${base}/.rss`
  const jsonUrl = base.includes('/comments/') ? `${base}.json` : `${base}/.json`

  try {
    const x = await getText(rssUrl, timeoutMs, 'application/rss+xml, application/xml, text/xml, */*')
    const ok = x.status === 200 && (/<rss/i.test(x.text) || /<feed/i.test(x.text))
    attempts.push(attempt('reddit', 'rss', ok, x.status, x.text, ok ? 'feed' : 'no-feed-markers'))
    if (ok) {
      return { platform: 'reddit', ok: true, route: 'rss', content: x.text, finalUrl: rssUrl, attempts }
    }
  } catch (e) {
    attempts.push(attempt('reddit', 'rss', false, 0, '', e instanceof Error ? e.name : 'err'))
  }

  try {
    const x = await getText(jsonUrl, timeoutMs, 'application/json, */*')
    const ok = x.status === 200 && /^[\s]*[{\[]/.test(x.text)
    attempts.push(attempt('reddit', 'json', ok, x.status, x.text, ok ? 'json' : `status=${x.status}`))
    if (ok) {
      return { platform: 'reddit', ok: true, route: 'json', content: x.text, finalUrl: jsonUrl, attempts }
    }
  } catch (e) {
    attempts.push(attempt('reddit', 'json', false, 0, '', e instanceof Error ? e.name : 'err'))
  }

  return { platform: 'reddit', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- x / twitter ------------------------------------------------------------
const TWEET_ID_RE = /\/status(?:es)?\/(\d+)/

async function xTwitter(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  const m = TWEET_ID_RE.exec(url)

  if (m) {
    const tid = m[1]
    try {
      const u = `https://cdn.syndication.twimg.com/tweet-result?id=${tid}&token=a`
      const x = await getText(u, timeoutMs, 'application/json')
      let ok = false
      if (x.status === 200) {
        try {
          const d = JSON.parse(x.text) as { text?: string }
          ok = !!d.text
        } catch {
          ok = false
        }
      }
      attempts.push(attempt('x', 'tweet-result', ok, x.status, x.text, ok ? 'has-text' : `status=${x.status}`))
      if (ok) {
        return { platform: 'x', ok: true, route: 'tweet-result', content: x.text, finalUrl: url, attempts }
      }
    } catch (e) {
      attempts.push(attempt('x', 'tweet-result', false, 0, '', e instanceof Error ? e.name : 'err'))
    }
    try {
      const ourl = `https://publish.twitter.com/oembed?url=https://twitter.com/i/status/${tid}&omit_script=1`
      const x = await getText(ourl, timeoutMs, 'application/json')
      let ok = false
      if (x.status === 200) {
        try {
          const d = JSON.parse(x.text) as { html?: string }
          ok = !!d.html
        } catch {
          ok = false
        }
      }
      attempts.push(attempt('x', 'oembed', ok, x.status, x.text, ok ? 'has-html' : `status=${x.status}`))
      if (ok) {
        return { platform: 'x', ok: true, route: 'oembed', content: x.text, finalUrl: ourl, attempts }
      }
    } catch (e) {
      attempts.push(attempt('x', 'oembed', false, 0, '', e instanceof Error ? e.name : 'err'))
    }
  } else {
    const handle = new URL(url).pathname.replace(/^\/+|\/+$/g, '').split('/')[0]
    const reserved = new Set(['i', 'search', 'home', 'explore', 'messages', 'notifications', 'settings', 'hashtag'])
    if (handle && !reserved.has(handle.toLowerCase())) {
      const surl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`
      for (let i = 0; i < 2; i++) {
        try {
          const x = await getText(surl, timeoutMs)
          const ok = x.status === 200 && x.text.includes('__NEXT_DATA__')
          attempts.push(
            attempt('x', `syndication-timeline#${i + 1}`, ok, x.status, x.text, ok ? 'timeline' : `status=${x.status}`)
          )
          if (ok) {
            return {
              platform: 'x',
              ok: true,
              route: 'syndication-timeline',
              content: x.text,
              finalUrl: surl,
              attempts
            }
          }
        } catch (e) {
          attempts.push(
            attempt('x', `syndication-timeline#${i + 1}`, false, 0, '', e instanceof Error ? e.name : 'err')
          )
        }
      }
    }
  }

  return { platform: 'x', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- youtube ----------------------------------------------------------------
async function youtube(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []

  // oEmbed first (no yt-dlp required)
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    const x = await getText(oembed, timeoutMs, 'application/json')
    let ok = false
    if (x.status === 200) {
      try {
        const d = JSON.parse(x.text) as { title?: string }
        ok = !!d.title
      } catch {
        ok = false
      }
    }
    attempts.push(attempt('youtube', 'oembed', ok, x.status, x.text, ok ? 'meta' : `status=${x.status}`))
    // keep going for yt-dlp richer data, but oembed alone is a soft win if yt-dlp missing
    if (ok) {
      // try yt-dlp for captions/description
      const ytdlp = await tryYtdlp(url, Math.max(timeoutMs, 60_000))
      attempts.push(...ytdlp.attempts)
      if (ytdlp.ok) {
        return {
          platform: 'youtube',
          ok: true,
          route: 'yt-dlp',
          content: ytdlp.content,
          finalUrl: url,
          attempts
        }
      }
      return {
        platform: 'youtube',
        ok: true,
        route: 'oembed',
        content: x.text,
        finalUrl: oembed,
        attempts
      }
    }
  } catch (e) {
    attempts.push(attempt('youtube', 'oembed', false, 0, '', e instanceof Error ? e.name : 'err'))
  }

  const ytdlp = await tryYtdlp(url, Math.max(timeoutMs, 60_000))
  attempts.push(...ytdlp.attempts)
  if (ytdlp.ok) {
    return { platform: 'youtube', ok: true, route: 'yt-dlp', content: ytdlp.content, finalUrl: url, attempts }
  }

  return { platform: 'youtube', ok: false, route: null, content: '', finalUrl: url, attempts }
}

async function tryYtdlp(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; content: string; attempts: Phase0Attempt[] }> {
  const attempts: Phase0Attempt[] = []
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', ['--dump-json', '--skip-download', url], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env
    })
    const ok = !!stdout.trim().startsWith('{')
    attempts.push(attempt('youtube', 'yt-dlp', ok, ok ? 200 : 0, stdout, ok ? 'json' : (stderr || '').slice(0, 80)))
    if (ok) return { ok: true, content: stdout, attempts }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      attempts.push(attempt('youtube', 'yt-dlp', false, 0, '', 'yt-dlp not installed'))
    } else {
      attempts.push(attempt('youtube', 'yt-dlp', false, 0, '', msg.slice(0, 80)))
    }
  }
  return { ok: false, content: '', attempts }
}

// --- threads ----------------------------------------------------------------
const THREADS_POST_RE = /\/post\/([A-Za-z0-9_-]+)/

async function threads(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  const m = THREADS_POST_RE.exec(url.split('?')[0])
  if (!m) {
    attempts.push(attempt('threads', 'inline-json', false, 0, '', 'no-post-shortcode'))
    return { platform: 'threads', ok: false, route: null, content: '', finalUrl: url, attempts }
  }
  const code = m[1]
  try {
    const x = await getText(url, timeoutMs)
    const raw = x.status === 200 ? x.text : ''
    const codeRe = new RegExp(`"code"\\s*:\\s*"${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')
    const codePos: number[] = []
    let cm: RegExpExecArray | null
    while ((cm = codeRe.exec(raw))) codePos.push(cm.index)
    const blocks: Array<{ index: number; body: string }> = []
    const vvRe = /"video_versions"\s*:\s*\[(.*?)\]/g
    let vv: RegExpExecArray | null
    while ((vv = vvRe.exec(raw)) !== null) {
      blocks.push({ index: vv.index, body: vv[1] })
    }
    if (!codePos.length || !blocks.length) {
      const note =
        x.status !== 200
          ? `status=${x.status}`
          : !codePos.length
            ? 'no-code-marker'
            : 'no-video_versions'
      attempts.push(attempt('threads', 'inline-json', false, x.status, raw, note))
      return { platform: 'threads', ok: false, route: null, content: '', finalUrl: url, attempts }
    }
    let best = blocks[0]
    let bestDist = Infinity
    for (const b of blocks) {
      const dist = Math.min(...codePos.map((c) => Math.abs(b.index - c)))
      if (dist < bestDist) {
        bestDist = dist
        best = b
      }
    }
    const urls: string[] = []
    const urlRe = /"url"\s*:\s*"([^"]+)"/g
    let um: RegExpExecArray | null
    while ((um = urlRe.exec(best.body)) !== null) {
      let u = um[1].replace(/\\\//g, '/')
      try {
        u = JSON.parse(`"${u}"`) as string
      } catch {
        // keep raw
      }
      if (!urls.includes(u)) urls.push(u)
    }
    if (!urls.length) {
      attempts.push(attempt('threads', 'inline-json', false, x.status, raw, 'empty-video_versions'))
      return { platform: 'threads', ok: false, route: null, content: '', finalUrl: url, attempts }
    }
    const content = JSON.stringify({ post_code: code, video_urls: urls }, null, 2)
    attempts.push(attempt('threads', 'inline-json', true, x.status, content, `${urls.length} video url(s)`))
    return { platform: 'threads', ok: true, route: 'inline-json', content, finalUrl: url, attempts }
  } catch (e) {
    attempts.push(attempt('threads', 'inline-json', false, 0, '', e instanceof Error ? e.name : 'err'))
    return { platform: 'threads', ok: false, route: null, content: '', finalUrl: url, attempts }
  }
}

// --- HN ---------------------------------------------------------------------
async function hn(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const u = new URL(url)
    const id = u.searchParams.get('id')
    if (id) {
      const api = `https://hacker-news.firebaseio.com/v0/item/${id}.json`
      const x = await getText(api, timeoutMs, 'application/json')
      const ok = x.status === 200 && x.text.includes('"id"')
      attempts.push(attempt('hn', 'firebase-item', ok, x.status, x.text, ok ? 'json' : `status=${x.status}`))
      if (ok) {
        return { platform: 'hn', ok: true, route: 'firebase-item', content: x.text, finalUrl: api, attempts }
      }
    }
    // front page
    if (u.pathname === '/' || u.pathname === '') {
      const api = 'https://hacker-news.firebaseio.com/v0/topstories.json'
      const x = await getText(api, timeoutMs, 'application/json')
      const ok = x.status === 200 && x.text.startsWith('[')
      attempts.push(attempt('hn', 'topstories', ok, x.status, x.text, ok ? 'ids' : `status=${x.status}`))
      if (ok) {
        const ids = (JSON.parse(x.text) as number[]).slice(0, 15)
        const items: unknown[] = []
        for (const i of ids) {
          const it = await getText(`https://hacker-news.firebaseio.com/v0/item/${i}.json`, timeoutMs, 'application/json')
          if (it.status === 200) {
            try {
              items.push(JSON.parse(it.text))
            } catch {
              /* skip */
            }
          }
        }
        const content = JSON.stringify(items, null, 2)
        return { platform: 'hn', ok: true, route: 'topstories', content, finalUrl: api, attempts }
      }
    }
  } catch (e) {
    attempts.push(attempt('hn', 'firebase', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'hn', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- Bluesky ----------------------------------------------------------------
async function bluesky(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    // https://bsky.app/profile/{handle}/post/{rkey}
    const m = /bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/.exec(url)
    if (m) {
      const handle = decodeURIComponent(m[1])
      const rkey = m[2]
      // resolve handle → did
      const res = await getText(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
        timeoutMs,
        'application/json'
      )
      let did = ''
      if (res.status === 200) {
        try {
          did = (JSON.parse(res.text) as { did?: string }).did || ''
        } catch {
          /* */
        }
      }
      attempts.push(attempt('bluesky', 'resolveHandle', !!did, res.status, res.text, did || 'no-did'))
      if (did) {
        const uri = `at://${did}/app.bsky.feed.post/${rkey}`
        const post = await getText(
          `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`,
          timeoutMs,
          'application/json'
        )
        const ok = post.status === 200 && post.text.includes('thread')
        attempts.push(attempt('bluesky', 'getPostThread', ok, post.status, post.text, ok ? 'thread' : `status=${post.status}`))
        if (ok) {
          return {
            platform: 'bluesky',
            ok: true,
            route: 'getPostThread',
            content: post.text,
            finalUrl: url,
            attempts
          }
        }
      }
    }
    const profile = /bsky\.app\/profile\/([^/?#]+)/.exec(url)
    if (profile) {
      const handle = decodeURIComponent(profile[1])
      const feed = await getText(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=20`,
        timeoutMs,
        'application/json'
      )
      const ok = feed.status === 200 && feed.text.includes('feed')
      attempts.push(attempt('bluesky', 'getAuthorFeed', ok, feed.status, feed.text, ok ? 'feed' : `status=${feed.status}`))
      if (ok) {
        return {
          platform: 'bluesky',
          ok: true,
          route: 'getAuthorFeed',
          content: feed.text,
          finalUrl: url,
          attempts
        }
      }
    }
  } catch (e) {
    attempts.push(attempt('bluesky', 'api', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'bluesky', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- Wikipedia --------------------------------------------------------------
async function wikipedia(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const u = new URL(url)
    const m = /\/wiki\/(.+)$/.exec(u.pathname)
    if (m) {
      const title = decodeURIComponent(m[1])
      const lang = u.hostname.split('.')[0] || 'en'
      const api = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      const x = await getText(api, timeoutMs, 'application/json')
      const ok = x.status === 200 && x.text.includes('extract')
      attempts.push(attempt('wikipedia', 'rest-summary', ok, x.status, x.text, ok ? 'summary' : `status=${x.status}`))
      if (ok) {
        return { platform: 'wikipedia', ok: true, route: 'rest-summary', content: x.text, finalUrl: api, attempts }
      }
    }
  } catch (e) {
    attempts.push(attempt('wikipedia', 'rest', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'wikipedia', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- arXiv ------------------------------------------------------------------
async function arxiv(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const m = /arxiv\.org\/(?:abs|pdf|html)\/(\d+\.\d+(?:v\d+)?)/i.exec(url)
    if (m) {
      const id = m[1].replace(/v\d+$/, '')
      const api = `http://export.arxiv.org/api/query?id_list=${id}`
      const x = await getText(api, timeoutMs, 'application/atom+xml, application/xml, */*')
      const ok = x.status === 200 && /<entry/i.test(x.text)
      attempts.push(attempt('arxiv', 'atom', ok, x.status, x.text, ok ? 'entry' : `status=${x.status}`))
      if (ok) {
        return { platform: 'arxiv', ok: true, route: 'atom', content: x.text, finalUrl: api, attempts }
      }
    }
  } catch (e) {
    attempts.push(attempt('arxiv', 'atom', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'arxiv', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- GitHub public ----------------------------------------------------------
async function github(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const u = new URL(url)
    // raw content
    if (u.hostname === 'raw.githubusercontent.com') {
      const x = await getText(url, timeoutMs, '*/*')
      const ok = x.status === 200 && x.text.length > 0
      attempts.push(attempt('github', 'raw', ok, x.status, x.text, ok ? 'raw' : `status=${x.status}`))
      if (ok) return { platform: 'github', ok: true, route: 'raw', content: x.text, finalUrl: url, attempts }
    }
    // repo page → API
    const repo = /^\/([^/]+)\/([^/]+)\/?$/.exec(u.pathname)
    if (repo && u.hostname === 'github.com') {
      const api = `https://api.github.com/repos/${repo[1]}/${repo[2]}`
      const x = await getText(api, timeoutMs, 'application/vnd.github+json')
      const ok = x.status === 200 && x.text.includes('"full_name"')
      attempts.push(attempt('github', 'repos-api', ok, x.status, x.text, ok ? 'repo' : `status=${x.status}`))
      if (ok) return { platform: 'github', ok: true, route: 'repos-api', content: x.text, finalUrl: api, attempts }
    }
    // issue / PR
    const issue = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(u.pathname)
    if (issue && u.hostname === 'github.com') {
      const api = `https://api.github.com/repos/${issue[1]}/${issue[2]}/issues/${issue[3]}`
      const x = await getText(api, timeoutMs, 'application/vnd.github+json')
      const ok = x.status === 200 && x.text.includes('"number"')
      attempts.push(attempt('github', 'issues-api', ok, x.status, x.text, ok ? 'issue' : `status=${x.status}`))
      if (ok) return { platform: 'github', ok: true, route: 'issues-api', content: x.text, finalUrl: api, attempts }
    }
    // blob → raw
    const blob = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(u.pathname)
    if (blob && u.hostname === 'github.com') {
      const raw = `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`
      const x = await getText(raw, timeoutMs, '*/*')
      const ok = x.status === 200 && x.text.length > 0
      attempts.push(attempt('github', 'blob-raw', ok, x.status, x.text, ok ? 'raw' : `status=${x.status}`))
      if (ok) return { platform: 'github', ok: true, route: 'blob-raw', content: x.text, finalUrl: raw, attempts }
    }
  } catch (e) {
    attempts.push(attempt('github', 'api', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'github', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- Stack Overflow ---------------------------------------------------------
async function stackoverflow(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const m = /\/questions\/(\d+)/.exec(url)
    if (m) {
      const api = `https://api.stackexchange.com/2.3/questions/${m[1]}?order=desc&sort=activity&site=stackoverflow&filter=withbody`
      const x = await getText(api, timeoutMs, 'application/json')
      // SE API may return gzip; fetch usually decompresses
      const ok = x.status === 200 && x.text.includes('"items"')
      attempts.push(attempt('stackoverflow', 'se-api', ok, x.status, x.text, ok ? 'items' : `status=${x.status}`))
      if (ok) {
        return {
          platform: 'stackoverflow',
          ok: true,
          route: 'se-api',
          content: x.text,
          finalUrl: api,
          attempts
        }
      }
    }
  } catch (e) {
    attempts.push(attempt('stackoverflow', 'se-api', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'stackoverflow', ok: false, route: null, content: '', finalUrl: url, attempts }
}

// --- npm / pypi -------------------------------------------------------------
async function npm(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const m = /npmjs\.com\/package\/(@[^/]+\/[^/]+|[^/]+)/.exec(url) || /registry\.npmjs\.org\/(@[^/]+\/[^/]+|[^/]+)/.exec(url)
    if (m) {
      const name = m[1]
      const api = `https://registry.npmjs.org/${name}`
      const x = await getText(api, timeoutMs, 'application/json')
      const ok = x.status === 200 && (x.text.includes('"name"') || x.text.includes('"versions"'))
      attempts.push(attempt('npm', 'registry', ok, x.status, x.text, ok ? 'pkg' : `status=${x.status}`))
      if (ok) return { platform: 'npm', ok: true, route: 'registry', content: x.text, finalUrl: api, attempts }
    }
  } catch (e) {
    attempts.push(attempt('npm', 'registry', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'npm', ok: false, route: null, content: '', finalUrl: url, attempts }
}

async function pypi(url: string, timeoutMs: number): Promise<Phase0Result> {
  const attempts: Phase0Attempt[] = []
  try {
    const m = /pypi\.org\/p(?:roject|ypi)\/([^/]+)/.exec(url)
    if (m) {
      const api = `https://pypi.org/pypi/${m[1]}/json`
      const x = await getText(api, timeoutMs, 'application/json')
      const ok = x.status === 200 && x.text.includes('"info"')
      attempts.push(attempt('pypi', 'json', ok, x.status, x.text, ok ? 'info' : `status=${x.status}`))
      if (ok) return { platform: 'pypi', ok: true, route: 'json', content: x.text, finalUrl: api, attempts }
    }
  } catch (e) {
    attempts.push(attempt('pypi', 'json', false, 0, '', e instanceof Error ? e.name : 'err'))
  }
  return { platform: 'pypi', ok: false, route: null, content: '', finalUrl: url, attempts }
}

const ROUTERS: Record<string, (url: string, timeoutMs: number) => Promise<Phase0Result>> = {
  reddit,
  x: xTwitter,
  youtube,
  threads,
  hn,
  bluesky,
  wikipedia,
  arxiv,
  github,
  stackoverflow,
  npm,
  pypi
}

/** Route a URL through Phase 0 if recognized; null if not a known platform. */
export async function phase0Route(url: string, timeoutMs = 15_000): Promise<Phase0Result | null> {
  const platform = detect(url)
  if (!platform) return null
  return ROUTERS[platform](url, timeoutMs)
}

export function phase0Platform(url: string): string | null {
  return detect(url)
}
