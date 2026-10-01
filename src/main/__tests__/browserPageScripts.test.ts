import { describe, expect, it } from 'vitest'
import {
  clickScript,
  fillScript,
  readTextScript,
  resolverExpr,
  scrollScript,
  selectScript,
  snapshotScript,
  waitScript
} from '../browserPageScripts'

describe('browserPageScripts', () => {
  it('resolver prefers a data-pawn-ref match and embeds selector as JSON', () => {
    const script = resolverExpr('e12', 'a.link')
    expect(script).toContain(`var r="e12", s="a.link"`)
    expect(script).toContain(`'[data-pawn-ref="' + r.replace(/"/g,'') + '"]'`)
    // Quotes in the selector cannot break out of the JSON literal.
    const evil = resolverExpr('', 'x" onmouseover="alert(1)')
    expect(evil).toContain('"x\\" onmouseover=\\"alert(1)"')
  })

  it('snapshot embeds the filter as pre-stringified JSON and hashes refs', () => {
    const script = snapshotScript(JSON.stringify('sign in'))
    expect(script).toContain('var FILTER = "sign in";')
    expect(script).toContain('data-pawn-ref')
    expect(script).toContain("elements: out.slice(0, 150)")
    // A filter is matched against a lowercase haystack.
    expect(script).toContain('hay.indexOf(FILTER) === -1')
  })

  it('click and fill take the resolver expression and submit flag', () => {
    const resolver = resolverExpr('e1', '')
    const click = clickScript(resolver)
    expect(click).toContain(`var el = ${resolver};`)
    expect(click).toContain("window.__pawnCursor.show(cx, cy, 'click')")

    const fill = fillScript(resolver, JSON.stringify('hello "world"'), 'true')
    expect(fill).toContain('var value = "hello \\"world\\"";')
    expect(fill).toContain("if (true) {")
    expect(fill).toContain("' and submitted'")
    expect(fill).toContain("HTMLInputElement.prototype")
  })

  it('readText embeds the selector JSON and caps the excerpt', () => {
    const script = readTextScript(JSON.stringify('#main'))
    expect(script).toContain('var s = "#main";')
    expect(script).toContain('text.slice(0, 12000)')
  })

  it('wait polls until timeout and JSON-stringifies selector and text', () => {
    const script = waitScript(4000, '#done', 'All good')
    expect(script).toContain('const timeout = 4000;')
    expect(script).toContain('const selector = "#done";')
    expect(script).toContain('const text = "All good";')
    expect(script).toContain("'wait timed out after ' + timeout + 'ms'")
  })

  it('scroll uses numbers and an optional selector', () => {
    const script = scrollScript(120, -30, JSON.stringify('.feed'))
    expect(script).toContain('var dy = 120, dx = -30;')
    expect(script).toContain('var s = ".feed";')
    expect(script).toContain('window.scrollBy(dx, dy)')
  })

  it('select validates the SELECT tag and stringifies all args', () => {
    const script = selectScript('e3', 'select#lang', 'ko')
    expect(script).toContain('var ref = "e3";')
    expect(script).toContain("el.tagName !== 'SELECT'")
    expect(script).toContain('var value = "ko";')
  })
})
