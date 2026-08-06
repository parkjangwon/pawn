import type { ToolDefinition } from '../toolDefinitionsTypes'

export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Load a URL in the embedded browser and wait for it to finish loading. Returns the final URL and page title. Follow with browser_snapshot to see what is on the page.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to load. A bare domain is upgraded to https://.' } },
      required: ['url']
    }
  },
  {
    name: 'browser_snapshot',
    description: 'List the interactive elements of the current page (links, buttons, inputs, selects) with a stable "ref" for each. Use the ref with browser_click and browser_fill. Take a fresh snapshot after any navigation or click that changes the page.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional case-insensitive substring to match against element text, label, name or placeholder.' }
      }
    }
  },
  {
    name: 'browser_click',
    description: 'Click an element on the current page.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A ref from browser_snapshot, e.g. "e12".' },
        selector: { type: 'string', description: 'CSS selector, used when no ref is given.' }
      }
    }
  },
  {
    name: 'browser_fill',
    description: 'Type a value into an input, textarea or contenteditable element, firing the input and change events the page listens for.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A ref from browser_snapshot.' },
        selector: { type: 'string', description: 'CSS selector, used when no ref is given.' },
        value: { type: 'string', description: 'Text to enter.' },
        submit: { type: 'boolean', description: 'Press Enter afterwards to submit the form.' }
      },
      required: ['value']
    }
  },
  {
    name: 'browser_read_text',
    description: 'Read the visible text of the current page, or of one element.',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'Optional CSS selector to scope the read.' } }
    }
  },
  {
    name: 'browser_eval',
    description: 'Evaluate a JavaScript expression in the current page and return its result as JSON. Use for anything the other browser tools do not cover.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JS expression to evaluate.' } },
      required: ['code']
    }
  },
  {
    name: 'browser_back',
    description: 'Go back one entry in the embedded browser history.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'browser_screenshot',
    description: 'Capture the embedded browser viewport. Use when the page layout matters or the text tools are not enough.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'browser_open_external',
    description: 'Open a URL in the user default system browser instead of the embedded one.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to open' } },
      required: ['url']
    }
  }
]
