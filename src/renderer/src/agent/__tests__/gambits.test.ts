import { describe, it, expect } from 'vitest'
import { GAMBITS, gambitTrigger, matchGambits } from '../gambits'
import { parseUltraWork } from '../ultraWork'

describe('gambits ($ keyword modes)', () => {
  it('opens only for a $word at the very start of the message', () => {
    expect(gambitTrigger('$')).toEqual({ start: 0, query: '' })
    expect(gambitTrigger('  $ul')).toEqual({ start: 2, query: 'ul' })
    // Mid-sentence money / shell variables never trigger.
    expect(gambitTrigger('it costs $5')).toBeNull()
    expect(gambitTrigger('echo $HOME')).toBeNull()
    // Finished keyword (space typed) closes the menu.
    expect(gambitTrigger('$ulw ')).toBeNull()
    expect(gambitTrigger('$ulw fix tests')).toBeNull()
    expect(gambitTrigger('$$')).toBeNull()
  })

  it('matches by keyword or alias prefix, and nothing for numbers / unknown words', () => {
    expect(matchGambits('').map((g) => g.keyword)).toEqual(GAMBITS.map((g) => g.keyword))
    expect(matchGambits('u').map((g) => g.keyword)).toEqual(['ulw'])
    expect(matchGambits('ULTRA').map((g) => g.keyword)).toEqual(['ulw'])
    expect(matchGambits('5')).toEqual([])
    expect(matchGambits('HOME')).toEqual([])
  })

  it('every listed keyword and alias really starts its mode', () => {
    for (const g of GAMBITS) {
      for (const k of [g.keyword, ...g.aliases]) {
        expect(parseUltraWork(`$${k} make the tests pass`), `$${k}`).toEqual({ goal: 'make the tests pass', maxIterations: 12 })
      }
    }
  })
})
