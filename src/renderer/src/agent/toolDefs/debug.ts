import type { ToolDefinition } from '../toolDefinitionsTypes'

/** Interactive debugger (DAP adapters: debugpy, delve, lldb-dap; Node via the V8 inspector). */
export const DEBUG_TOOLS: ToolDefinition[] = [
  {
    name: 'debug_start',
    description:
      'Run a program under a real debugger and stop at breakpoints: Node.js (.js/.mjs/.cjs), Python (debugpy), Go (delve), C/C++/Rust/Swift binaries (lldb-dap). ' +
      'Returns where it stopped with numbered source, local variables, stack and program output. One session per chat; starting again replaces it. ' +
      'Use it for bugs that need runtime state — inspect instead of guessing or adding prints.',
    parameters: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'Script or executable (project-relative or absolute). Go: package dir or main.go' },
        args: { type: 'array', items: { type: 'string' }, description: 'Program arguments' },
        language: { type: 'string', enum: ['auto', 'node', 'python', 'go', 'lldb'], description: 'Default auto (by extension)' },
        breakpoints: {
          type: 'array',
          description: 'Initial breakpoints',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, line: { type: 'number' }, condition: { type: 'string' } },
            required: ['path', 'line']
          }
        },
        stop_on_entry: { type: 'boolean', description: 'Pause at the first line' },
        cwd: { type: 'string', description: 'Working directory (default project root)' },
        env: { type: 'object', description: 'Extra environment variables' },
        runtime_executable: { type: 'string', description: 'Interpreter (e.g. a venv python, a specific node)' },
        runtime_args: { type: 'array', items: { type: 'string' }, description: 'Interpreter flags, e.g. ["--import","tsx"] for TypeScript' }
      },
      required: ['program']
    }
  },
  {
    name: 'debug_breakpoints',
    description: 'Set the breakpoints of one file (replaces that file\'s previous breakpoints; empty lines clears them). Conditions use the program\'s language.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        lines: {
          type: 'array',
          description: 'Breakpoints as {line, condition?} (plain line numbers also work)',
          items: { type: 'object', properties: { line: { type: 'number' }, condition: { type: 'string' } }, required: ['line'] }
        }
      },
      required: ['path', 'lines']
    }
  },
  {
    name: 'debug_control',
    description:
      'Drive the paused program: continue (to the next breakpoint or exit), step_over, step_into, step_out, pause, or state (re-read the current stop). Returns the new stop location, locals, stack and new output.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['continue', 'step_over', 'step_into', 'step_out', 'pause', 'state'] },
        timeout: { type: 'number', description: 'Seconds to wait for the next stop (default 15)' }
      },
      required: ['action']
    }
  },
  {
    name: 'debug_eval',
    description: 'Evaluate an expression in the paused frame (inspect objects, call functions, test a fix hypothesis).',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
        frame_id: { type: 'number', description: 'Stack frame id from the state (default top frame)' }
      },
      required: ['expression']
    }
  },
  {
    name: 'debug_stop',
    description: 'End the debug session and kill the program.',
    parameters: { type: 'object', properties: {} }
  }
]
