import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { extname } from 'path'
import type { DiscoveredMod, ModModuleSource } from './types'

type TsCompiler = {
  transpileModule: (
    source: string,
    options: {
      compilerOptions: { target: number; module: number; isolatedModules: boolean }
      reportDiagnostics: boolean
    }
  ) => { outputText?: string }
  ScriptTarget: { ES2022: number }
  ModuleKind: { ESNext: number }
}

let compiler: TsCompiler | null | undefined

/**
 * Load the compiler as CommonJS. A static import is inlined into the ESM main
 * bundle, and TypeScript's filesystem probe then throws `__filename is not defined`
 * before the app window opens.
 */
function typescriptCompiler(): TsCompiler | null {
  if (compiler !== undefined) return compiler
  try {
    const require = createRequire(import.meta.url)
    compiler = require('typescript') as TsCompiler
  } catch {
    compiler = null
  }
  return compiler
}

/**
 * Turn a hooks module into JavaScript.
 * The TypeScript compiler erases types. The regex path is only a fallback.
 */
export function stripTypeScript(source: string): string {
  try {
    const ts = typescriptCompiler()
    if (!ts) return stripTypeScriptRegex(source)
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true
      },
      reportDiagnostics: false
    })
    const text = out.outputText?.trim()
    if (text) return text
  } catch {
    /* regex fallback */
  }
  return stripTypeScriptRegex(source)
}

function stripTypeScriptRegex(source: string): string {
  let s = source
  // Remove import type / export type lines
  s = s.replace(/^\s*import\s+type\b[^\n]*$/gm, '')
  s = s.replace(/^\s*export\s+type\b[^\n]*$/gm, '')
  s = s.replace(/^\s*export\s+interface\b[\s\S]*?\{[\s\S]*?\}\s*$/gm, '')
  s = s.replace(/^\s*interface\b[\s\S]*?\{[\s\S]*?\}\s*$/gm, '')
  s = s.replace(/^\s*type\s+[A-Za-z_][\w<>,\s]*=[^\n]*$/gm, '')
  // Strip `as Type` and `satisfies Type`
  s = s.replace(/\s+as\s+const\b/g, '')
  s = s.replace(/\s+as\s+[A-Za-z_][\w.<>,\s|&[\]?]*/g, '')
  s = s.replace(/\s+satisfies\s+[A-Za-z_][\w.<>,\s|&[\]?]*/g, '')
  // Strip parameter / property type annotations in simple cases: name: Type
  s = s.replace(/([,([]\s*[A-Za-z_][\w]*)\s*:\s*[A-Za-z_][\w.<>,\s|&[\]?]*(?=\s*[,)=])/g, '$1')
  // Strip return types: ): Type {
  s = s.replace(/\)\s*:\s*[A-Za-z_][\w.<>,\s|&[\]?]*(?=\s*[{=>])/g, ')')
  return s
}

export function loadModSource(mod: DiscoveredMod): ModModuleSource {
  const raw = readFileSync(mod.modulePath, 'utf-8')
  const ext = extname(mod.modulePath).toLowerCase()
  const isTs = ext === '.ts' || ext === '.mts' || ext === '.cts' || ext === '.tsx'
  return {
    mod,
    source: isTs ? stripTypeScript(raw) : raw,
    language: isTs ? 'ts' : 'js'
  }
}

export function loadEnabledModSources(mods: DiscoveredMod[]): ModModuleSource[] {
  const out: ModModuleSource[] = []
  for (const mod of mods) {
    if (!mod.enabled) continue
    try {
      out.push(loadModSource(mod))
    } catch {
      /* skip unreadable */
    }
  }
  return out
}
