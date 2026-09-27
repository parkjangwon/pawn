/**
 * One name per call for permissions, Plan mode, safety (parallel vs serial),
 * hooks and the permission dialog. Model-native tools (Claude's computer /
 * text editor / bash) map onto the Pawn tool they act as.
 */

import type { ToolCall } from './toolDefinitionsTypes'
import { permissionName as computerPermissionName } from './computerToolset'
import { nativeCodingPermissionName } from './nativeTools'

export function effectiveToolName(call: Pick<ToolCall, 'name' | 'toolset' | 'arguments'>): string {
  return nativeCodingPermissionName(call) ?? computerPermissionName(call)
}
