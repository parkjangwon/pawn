import { registerDialogIpc } from './dialog'
import { registerFsIpc } from './fs'
import { registerShellIpc } from './shell'
import { registerComputerIpc } from './computer'
import { registerMiscIpc } from './misc'
import { registerConfigIpc } from './config'
import { registerDbIpc } from './db'
import { registerBrowserIpc } from './browser'
import { registerTerminalIpc } from './terminal'
import { registerRoutineIpc } from './routine'
import { registerKeybindingsIpc } from './keybindings'

/** Register every main-process IPC handler in one place. */
export function registerAllIpc(): void {
  registerDialogIpc()
  registerFsIpc()
  registerShellIpc()
  registerComputerIpc()
  registerMiscIpc()
  registerConfigIpc()
  registerDbIpc()
  registerBrowserIpc()
  registerTerminalIpc()
  registerRoutineIpc()
  registerKeybindingsIpc()
}
