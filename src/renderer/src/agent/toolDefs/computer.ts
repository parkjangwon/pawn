import type { ToolDefinition } from '../toolDefinitionsTypes'

const coord = { type: 'array', items: { type: 'number' }, description: '[x, y] in pixels of the latest computer_screenshot' }
const shotAfter = {
  type: 'boolean',
  description: 'Capture a fresh screenshot after the action (saves a round trip when the UI will change)'
}
const modifiers = {
  type: 'string',
  description: 'Modifier keys held during the action: shift, ctrl, alt/option, cmd/super, or a "+"-joined combo like "cmd+shift"'
}
const target = {
  app: { type: 'string', description: 'App name or bundle id (e.g. "Safari", "com.apple.TextEdit")' },
  pid: { type: 'number', description: 'Process id (from computer_apps list)' }
}

/**
 * Desktop computer use. Coordinates are in the pixel space of the latest
 * computer_screenshot (top-left origin), like Claude/OpenAI computer use;
 * the runtime maps them to real screen points (Retina, multi-display).
 * On macOS the native helper adds accessibility-tree element actions, OCR,
 * app/window/menu control, and an agent cursor with Esc×2 emergency stop.
 */
export const COMPUTER_TOOLS: ToolDefinition[] = [
  {
    name: 'computer_screenshot',
    description:
      'See the screen. Returns an image plus its size and the cursor position; every computer_* coordinate uses this image\'s pixels (origin top-left). ' +
      'annotate=true overlays numbered boxes on clickable UI elements (macOS) so you can click by number. ' +
      'For small text use computer_zoom. For in-app web pages prefer browser_*.',
    parameters: {
      type: 'object',
      properties: {
        annotate: { type: 'boolean', description: 'Number clickable elements of the focused window (set-of-mark)' },
        display_id: { type: 'number', description: 'Display from computer_displays (default: the one you last used / primary)' },
        window_id: { type: 'number', description: 'Capture one window (from computer_windows), even if covered' }
      }
    }
  },
  {
    name: 'computer_zoom',
    description:
      'Inspect a region at full resolution to read small text or dense UI. region is [x0, y0, x1, y1] in the latest screenshot\'s pixels. ' +
      'Coordinates for actions stay in the full screenshot\'s space.',
    parameters: {
      type: 'object',
      properties: { region: { type: 'array', items: { type: 'number' }, description: '[x0, y0, x1, y1]' } },
      required: ['region']
    }
  },
  {
    name: 'computer_click',
    description:
      'Click. Target either coordinate [x, y] (screenshot pixels) or element N from computer_ui_snapshot / an annotated screenshot ' +
      '(element clicks go through the accessibility API: exact, and they work on covered windows). ' +
      'button: left|right|middle; clicks: 1–3 (2 = double, 3 = triple / select line). Omit both to click at the cursor.',
    parameters: {
      type: 'object',
      properties: {
        coordinate: coord,
        element: { type: 'number', description: 'Element id [N] from computer_ui_snapshot' },
        button: { type: 'string', description: 'left (default) | right | middle' },
        clicks: { type: 'number', description: '1 (default), 2, or 3' },
        modifiers,
        return_screenshot: shotAfter
      }
    }
  },
  {
    name: 'computer_type',
    description:
      'Type text at the keyboard focus (any language and emoji; input methods are bypassed). Newlines press Return. ' +
      'Long text is pasted automatically. Click the field first (or use computer_ui_action set_value).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        method: { type: 'string', description: 'keys (default for short text) | paste' },
        return_screenshot: shotAfter
      },
      required: ['text']
    }
  },
  {
    name: 'computer_key',
    description:
      'Press a key or combo, optionally repeated: "Return", "Escape", "Tab", "BackSpace", "Delete", "Up", "Page_Down", "F5", "space", ' +
      '"cmd+c", "cmd+shift+t", "ctrl+alt+Delete", "alt+Tab". On macOS use cmd for app shortcuts.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key or "+"-joined combo' },
        repeat: { type: 'number', description: 'Times to press (1–100, default 1)' },
        return_screenshot: shotAfter
      },
      required: ['key']
    }
  },
  {
    name: 'computer_scroll',
    description: 'Scroll with the mouse wheel at a point (default: cursor). direction up|down|left|right, amount in wheel notches (default 3).',
    parameters: {
      type: 'object',
      properties: {
        coordinate: coord,
        direction: { type: 'string', description: 'up | down | left | right' },
        amount: { type: 'number', description: 'Wheel notches (default 3)' },
        modifiers,
        return_screenshot: shotAfter
      },
      required: ['direction']
    }
  },
  {
    name: 'computer_drag',
    description:
      'Press, move, and release: sliders, selections, drag-and-drop, window moves. from/to are [x, y]; or path [[x,y], …] for a multi-point gesture.',
    parameters: {
      type: 'object',
      properties: {
        from: coord,
        to: coord,
        path: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Points to pass through' },
        button: { type: 'string', description: 'left (default) | right' },
        modifiers,
        duration_ms: { type: 'number', description: 'Gesture duration (default 400)' },
        return_screenshot: shotAfter
      }
    }
  },
  {
    name: 'computer_mouse',
    description:
      'Low-level pointer control: move (hover, tooltips), down / up (press or release a button at the cursor or coordinate, for gestures drag can\'t express), cursor (report position).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'move | down | up | cursor' },
        coordinate: coord,
        button: { type: 'string', description: 'left (default) | right | middle' },
        modifiers,
        return_screenshot: shotAfter
      },
      required: ['action']
    }
  },
  {
    name: 'computer_hold_key',
    description: 'Hold a key or combo down for a duration (games, key-repeat, press-and-hold menus). Max 300 s.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        duration: { type: 'number', description: 'Seconds (default 0.5)' }
      },
      required: ['key']
    }
  },
  {
    name: 'computer_ui_snapshot',
    description:
      'macOS accessibility outline of the focused window (or an app / its menu bar): every button, field, menu item, row, and link with an id [N], label, ' +
      'value, state, and @(x,y WxH) position in screenshot pixels. Works without vision, is exact, and sees covered windows. ' +
      'Use the ids with computer_click {"element": N} or computer_ui_action. Take a new snapshot after the UI changes.',
    parameters: {
      type: 'object',
      properties: {
        ...target,
        scope: { type: 'string', description: 'window (default, focused window) | app (all windows + menu bar) | menubar' },
        query: { type: 'string', description: 'Only elements whose label/value contains this text' },
        interactive_only: { type: 'boolean', description: 'Skip static text' },
        max_nodes: { type: 'number', description: 'Default 350' }
      }
    }
  },
  {
    name: 'computer_ui_action',
    description:
      'Act on an accessibility element [N]: press (default), set_value (fill a text field with value — fastest and exact), focus, select, ' +
      'show_menu (context menu), increment / decrement (sliders, steppers), expand / collapse, scroll_to_visible, raise, confirm, cancel.',
    parameters: {
      type: 'object',
      properties: {
        element: { type: 'number' },
        action: { type: 'string' },
        value: { type: 'string', description: 'For set_value' },
        return_screenshot: shotAfter
      },
      required: ['element']
    }
  },
  {
    name: 'computer_find',
    description:
      'Find a UI element or visible text by words ("Save", "Sign in", a file name). Searches the accessibility tree first, then on-screen text (OCR). ' +
      'Returns element ids and @(x,y) positions ready to click.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        ...target,
        ocr: { type: 'boolean', description: 'Force on-screen text search (canvas, images, remote desktops)' }
      },
      required: ['query']
    }
  },
  {
    name: 'computer_ocr',
    description: 'Read all visible text (on-device OCR) with @(x,y) positions. region [x0, y0, x1, y1] limits it (screenshot pixels).',
    parameters: {
      type: 'object',
      properties: { region: { type: 'array', items: { type: 'number' } } }
    }
  },
  {
    name: 'computer_apps',
    description: 'Applications: list (running apps), launch (opens or focuses), activate (bring to front), hide, quit.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list (default) | launch | activate | hide | quit' },
        app: { type: 'string', description: 'App name ("Safari") or path' },
        bundle_id: { type: 'string' },
        pid: { type: 'number' },
        return_screenshot: shotAfter
      }
    }
  },
  {
    name: 'computer_windows',
    description:
      'Windows: list (all on-screen windows with ids and bounds in screenshot pixels, front to back), or focus | move | resize | set_frame | minimize | ' +
      'unminimize | fullscreen | exit_fullscreen | close a window (window_id, or the app\'s front window).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        window_id: { type: 'number' },
        ...target,
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        return_screenshot: shotAfter
      }
    }
  },
  {
    name: 'computer_menu',
    description:
      'The app\'s menu bar (macOS): list items at a path (with shortcuts), or select a command by path, e.g. ["File", "Export…"] or "View > Show Sidebar". ' +
      'Often the fastest, most reliable way to run a command.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list (default) | select' },
        path: { type: 'array', items: { type: 'string' } },
        ...target
      }
    }
  },
  {
    name: 'computer_open',
    description: 'Open a URL, file, or folder with its default app (or a given app).',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'https://…, file path, or app URL scheme' },
        app: { type: 'string', description: 'Open with this app instead of the default' },
        return_screenshot: shotAfter
      },
      required: ['target']
    }
  },
  {
    name: 'computer_clipboard',
    description: 'System clipboard: get (text, file paths) or set text. Useful for moving large text reliably.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get | set' },
        text: { type: 'string' }
      },
      required: ['action']
    }
  },
  {
    name: 'computer_wait',
    description: 'Wait for the UI to settle (loading, animations). seconds up to 300.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number' },
        return_screenshot: shotAfter
      }
    }
  },
  {
    name: 'computer_displays',
    description: 'List monitors (ids, sizes, scale, which is primary). Pass display_id to computer_screenshot to work on another monitor.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'computer_status',
    description:
      'Check computer-use readiness: backend (native helper / legacy), Accessibility and Screen Recording permissions, and how to fix them. ' +
      'prompt=true shows the macOS permission prompts.',
    parameters: { type: 'object', properties: { prompt: { type: 'boolean' } } }
  }
]
