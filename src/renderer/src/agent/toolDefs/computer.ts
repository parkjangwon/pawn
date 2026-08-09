import type { ToolDefinition } from '../toolDefinitionsTypes'

export const COMPUTER_TOOLS: ToolDefinition[] = [
  {
    name: 'computer_screenshot',
    description:
      'Capture the desktop for vision. Returns an image (attached for vision models) plus width/height and screen size. Click coords are in IMAGE space by default (top-left origin). Prefer this before computer_click/drag/scroll. For in-app web UI use browser_* instead.',
    parameters: {
      type: 'object',
      properties: {
        display_id: { type: 'number', description: 'Display id from computer_displays (default primary)' },
        max_width: {
          type: 'number',
          description: 'Max image width in px for the model (default 1600). Coords scale automatically if you use image space.'
        }
      }
    }
  },
  {
    name: 'computer_displays',
    description: 'List monitors with id, size, and which is primary. Use display_id with computer_screenshot when multi-monitor.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'computer_status',
    description:
      'Check whether desktop computer use is ready (display access, cliclick/xdotool, platform notes). Call once before the first click if setup is uncertain.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'computer_click',
    description:
      'Click at coordinates. Default coord_space=image (from the last computer_screenshot). button: left|right|middle. clicks: 1 or 2 for double-click. Set return_screenshot=true after UI changes.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X (image space unless coord_space=screen)' },
        y: { type: 'number', description: 'Y' },
        button: { type: 'string', description: 'left (default) | right | middle' },
        clicks: { type: 'number', description: '1 (default) or 2 for double-click' },
        coord_space: { type: 'string', description: 'image (default) | screen' },
        return_screenshot: { type: 'boolean', description: 'If true, capture screen after click' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_move',
    description: 'Move mouse pointer without clicking (hover). Same coord_space rules as computer_click.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        coord_space: { type: 'string', description: 'image | screen' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_drag',
    description: 'Drag from (from_x,from_y) to (to_x,to_y). Good for sliders, selections, window move.',
    parameters: {
      type: 'object',
      properties: {
        from_x: { type: 'number' },
        from_y: { type: 'number' },
        to_x: { type: 'number' },
        to_y: { type: 'number' },
        button: { type: 'string', description: 'left (default) | right' },
        steps: { type: 'number', description: 'Interpolation steps (default 20)' },
        coord_space: { type: 'string' },
        return_screenshot: { type: 'boolean' }
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y']
    }
  },
  {
    name: 'computer_scroll',
    description:
      'Scroll at (x,y). dy>0 scrolls down, dy<0 up. dx for horizontal where supported. Units are rough “notches”.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        dy: { type: 'number', description: 'Vertical scroll amount (positive = down)' },
        dx: { type: 'number', description: 'Horizontal scroll amount' },
        coord_space: { type: 'string' },
        return_screenshot: { type: 'boolean' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_type',
    description: 'Type text into the focused field via OS keyboard. Prefer short strings; use computer_keypress for hotkeys.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        return_screenshot: { type: 'boolean' }
      },
      required: ['text']
    }
  },
  {
    name: 'computer_keypress',
    description:
      'Press a key or combo: Return, Escape, Tab, Backspace, cmd+c, ctrl+v, alt+Tab, cmd+shift+t. Use + between modifiers.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key or combo' },
        return_screenshot: { type: 'boolean' }
      },
      required: ['key']
    }
  },
  {
    name: 'computer_clipboard',
    description: 'Read or write the system clipboard text (get|set). Useful to paste large text reliably.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get or set' },
        text: { type: 'string', description: 'Text when action=set' }
      },
      required: ['action']
    }
  },
  {
    name: 'computer_wait',
    description: 'Wait milliseconds (max 60000) for UI to settle after an action.',
    parameters: {
      type: 'object',
      properties: { ms: { type: 'number', description: 'Milliseconds to sleep' } },
      required: ['ms']
    }
  }
]
