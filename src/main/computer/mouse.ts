import { isEnoent, normalizeButton, run, scaleFactor, findDisplay, type MouseButton } from './platform'

export interface Point {
  x: number
  y: number
}

async function macClick(x: number, y: number, button: MouseButton, clicks: number): Promise<void> {
  const n = Math.min(Math.max(clicks, 1), 5)
  try {
    if (button === 'middle') {
      throw new Error(
        'Middle-click is not supported via cliclick on macOS. Use left/right or a keyboard shortcut.'
      )
    }
    if (button === 'right') {
      await run('cliclick', [`rc:${x},${y}`])
      return
    }
    if (n >= 2) {
      await run('cliclick', [`dc:${x},${y}`])
      for (let i = 2; i < n; i++) await run('cliclick', [`c:${x},${y}`])
      return
    }
    await run('cliclick', [`c:${x},${y}`])
  } catch (err) {
    if (isEnoent(err)) {
      throw new Error(
        'cliclick is required for mouse control on macOS. Install: brew install cliclick. Enable Accessibility for Pawn (System Settings → Privacy & Security).'
      )
    }
    throw err
  }
}

async function linuxClick(x: number, y: number, button: MouseButton, clicks: number): Promise<void> {
  const d = findDisplay(null)
  const s = scaleFactor(d)
  const px = Math.round(x * s)
  const py = Math.round(y * s)
  const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1'
  const n = Math.min(Math.max(clicks, 1), 5)
  await run('xdotool', [
    'mousemove',
    '--sync',
    String(px),
    String(py),
    'click',
    '--repeat',
    String(n),
    btn
  ])
}

async function winClick(x: number, y: number, button: MouseButton, clicks: number): Promise<void> {
  const d = findDisplay(null)
  const s = scaleFactor(d)
  const px = Math.round(x * s)
  const py = Math.round(y * s)
  const down =
    button === 'right' ? 0x0008 : button === 'middle' ? 0x0020 : 0x0002
  const up =
    button === 'right' ? 0x0010 : button === 'middle' ? 0x0040 : 0x0004
  const n = Math.min(Math.max(clicks, 1), 5)
  const typeId = `Win32Mouse_${Date.now()}`
  const body = `
$sig = '[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);';
$type = Add-Type -MemberDefinition $sig -Name "${typeId}" -Namespace Win32 -PassThru;
[void]$type::SetCursorPos(${px}, ${py});
for ($i=0; $i -lt ${n}; $i++) { $type::mouse_event(${down},0,0,0,0); $type::mouse_event(${up},0,0,0,0); Start-Sleep -Milliseconds 40 }
`
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', body])
}

export async function mouseClick(
  x: number,
  y: number,
  opts?: { button?: string; clicks?: number }
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const button = normalizeButton(opts?.button)
    const clicks = opts?.clicks ?? 1
    if (process.platform === 'darwin') await macClick(x, y, button, clicks)
    else if (process.platform === 'linux') await linuxClick(x, y, button, clicks)
    else if (process.platform === 'win32') await winClick(x, y, button, clicks)
    else return { error: 'Unsupported platform' }
    return { ok: true }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('ENOENT') || msg.includes('cliclick')) {
      return {
        error:
          process.platform === 'darwin'
            ? 'cliclick is required for reliable mouse control on macOS. Install: brew install cliclick. Enable Accessibility + Screen Recording for Pawn.'
            : process.platform === 'linux'
              ? 'xdotool is required. Install: sudo apt install xdotool (or equivalent).'
              : msg
      }
    }
    return { error: msg }
  }
}

export async function mouseMove(x: number, y: number): Promise<{ ok?: boolean; error?: string }> {
  try {
    if (process.platform === 'darwin') {
      try {
        await run('cliclick', [`m:${x},${y}`])
      } catch (err) {
        if (!isEnoent(err)) throw err
        return {
          error: 'cliclick is required for mouse move on macOS. brew install cliclick'
        }
      }
    } else if (process.platform === 'linux') {
      const s = scaleFactor(findDisplay(null))
      await run('xdotool', ['mousemove', '--sync', String(Math.round(x * s)), String(Math.round(y * s))])
    } else if (process.platform === 'win32') {
      const s = scaleFactor(findDisplay(null))
      const px = Math.round(x * s)
      const py = Math.round(y * s)
      const typeId = `Win32Move_${Date.now()}`
      await run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$sig='[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);'; $t=Add-Type -MemberDefinition $sig -Name "${typeId}" -Namespace Win32 -PassThru; [void]$t::SetCursorPos(${px},${py});`
      ])
    } else return { error: 'Unsupported platform' }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function mouseDrag(
  from: Point,
  to: Point,
  opts?: { button?: string; steps?: number }
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const button = normalizeButton(opts?.button)
    const steps = Math.min(Math.max(opts?.steps ?? 20, 5), 80)
    if (process.platform === 'darwin') {
      try {
        if (button !== 'left') {
          return { error: 'macOS drag currently supports left button only (cliclick).' }
        }
        // cliclick: mouse down → move → up
        await run('cliclick', [
          `dd:${from.x},${from.y}`,
          `dm:${to.x},${to.y}`,
          `du:${to.x},${to.y}`
        ])
      } catch (err) {
        if (isEnoent(err)) {
          return { error: 'cliclick required for drag on macOS: brew install cliclick' }
        }
        // Stepwise fallback
        await run('cliclick', [`m:${from.x},${from.y}`, `dd:${from.x},${from.y}`])
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const x = Math.round(from.x + (to.x - from.x) * t)
          const y = Math.round(from.y + (to.y - from.y) * t)
          await run('cliclick', [`m:${x},${y}`])
        }
        await run('cliclick', [`du:${to.x},${to.y}`])
      }
    } else if (process.platform === 'linux') {
      const s = scaleFactor(findDisplay(null))
      const x1 = Math.round(from.x * s)
      const y1 = Math.round(from.y * s)
      const x2 = Math.round(to.x * s)
      const y2 = Math.round(to.y * s)
      const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1'
      await run('xdotool', [
        'mousemove',
        '--sync',
        String(x1),
        String(y1),
        'mousedown',
        btn,
        'mousemove',
        '--sync',
        String(x2),
        String(y2),
        'mouseup',
        btn
      ])
    } else if (process.platform === 'win32') {
      const s = scaleFactor(findDisplay(null))
      const x1 = Math.round(from.x * s)
      const y1 = Math.round(from.y * s)
      const x2 = Math.round(to.x * s)
      const y2 = Math.round(to.y * s)
      const down = button === 'right' ? 0x0008 : 0x0002
      const up = button === 'right' ? 0x0010 : 0x0004
      const typeId = `Win32Drag_${Date.now()}`
      const body = `
$sig = '[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);';
$t = Add-Type -MemberDefinition $sig -Name "${typeId}" -Namespace Win32 -PassThru;
[void]$t::SetCursorPos(${x1},${y1});
$t::mouse_event(${down},0,0,0,0);
$steps=${steps};
for ($i=1; $i -le $steps; $i++) {
  $xx = [int](${x1} + (${x2}-${x1}) * $i / $steps);
  $yy = [int](${y1} + (${y2}-${y1}) * $i / $steps);
  [void]$t::SetCursorPos($xx,$yy);
  Start-Sleep -Milliseconds 8;
}
$t::mouse_event(${up},0,0,0,0);
`
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', body])
    } else return { error: 'Unsupported platform' }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function mouseScroll(
  x: number,
  y: number,
  opts: { dy?: number; dx?: number }
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const dy = Math.round(opts.dy ?? 0)
    const dx = Math.round(opts.dx ?? 0)
    if (!dy && !dx) return { error: 'Provide dy and/or dx (positive dy = scroll down)' }

    if (process.platform === 'darwin') {
      try {
        await run('cliclick', [`m:${x},${y}`])
        // cliclick wheel: w:lines (positive = down in some versions)
        if (dy) await run('cliclick', [`w:${dy}`])
        // horizontal not well supported
      } catch (err) {
        if (isEnoent(err)) {
          return { error: 'cliclick required for scroll on macOS: brew install cliclick' }
        }
        throw err
      }
    } else if (process.platform === 'linux') {
      const s = scaleFactor(findDisplay(null))
      await run('xdotool', ['mousemove', '--sync', String(Math.round(x * s)), String(Math.round(y * s))])
      // xdotool click 4 = up, 5 = down; 6/7 horizontal
      const downs = dy > 0 ? dy : 0
      const ups = dy < 0 ? -dy : 0
      for (let i = 0; i < Math.min(downs, 50); i++) await run('xdotool', ['click', '5'])
      for (let i = 0; i < Math.min(ups, 50); i++) await run('xdotool', ['click', '4'])
      for (let i = 0; i < Math.min(Math.max(dx, 0), 50); i++) await run('xdotool', ['click', '7'])
      for (let i = 0; i < Math.min(Math.max(-dx, 0), 50); i++) await run('xdotool', ['click', '6'])
    } else if (process.platform === 'win32') {
      const s = scaleFactor(findDisplay(null))
      const px = Math.round(x * s)
      const py = Math.round(y * s)
      // WHEEL_DELTA = 120
      const wheel = -dy * 120
      const hwheel = dx * 120
      const typeId = `Win32Wheel_${Date.now()}`
      const body = `
$sig = '[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);';
$t = Add-Type -MemberDefinition $sig -Name "${typeId}" -Namespace Win32 -PassThru;
[void]$t::SetCursorPos(${px},${py});
if (${wheel} -ne 0) { $t::mouse_event(0x0800, 0, 0, ${wheel}, 0); }
if (${hwheel} -ne 0) { $t::mouse_event(0x01000, 0, 0, ${hwheel}, 0); }
`
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', body])
    } else return { error: 'Unsupported platform' }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
