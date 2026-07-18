// Minimal TS -> ESM loader for the parser harness. The repo has no build step
// for scripts, so we transpile a single .ts file with the installed typescript
// compiler (type-stripping only, no type-checking), stub out any imports the
// harness doesn't exercise, and hand back a file:// URL that Node can import.
//
// This exists so the harness runs the REAL parser source, not a copy — a copy
// would drift from what ships and quietly invalidate the tests.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, basename, join } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const OUT_DIR = join(process.env.SCRATCHPAD_DIR || dirname(new URL(import.meta.url).pathname), '_transpiled');
try {
  mkdirSync(OUT_DIR, { recursive: true });
} catch {}

let counter = 0;
const emptyStub = join(OUT_DIR, '__empty.mjs');
writeFileSync(emptyStub, 'export default {}; export const __stub = true;\n');

/**
 * Transpile `tsPath` to an ESM file and return its file:// URL.
 * `stubImports` lists import specifiers to redirect to an empty module (used for
 * expo/native/relative deps the harness never calls into).
 */
export async function transform(tsPath, stubImports = []) {
  let source = readFileSync(tsPath, 'utf8');
  // Delete whole import statements for stubbed specifiers — the harness never
  // calls the code that uses them, so removing them avoids resolving expo /
  // native / sibling modules that would fail under plain Node.
  for (const spec of stubImports) {
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    source = source.replace(new RegExp(`^\\s*import[^;]*?from\\s*['"\`]${escaped}['"\`];?\\s*$`, 'gm'), '');
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
      verbatimModuleSyntax: false,
    },
    fileName: tsPath,
  });

  const stubUrl = pathToFileURL(emptyStub).href;
  let rewritten = outputText;
  for (const spec of stubImports) {
    // Replace the module specifier in `from '...'` / `import '...'` with the stub.
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rewritten = rewritten.replace(new RegExp(`(['"\`])${escaped}\\1`, 'g'), `'${stubUrl}'`);
  }

  const outPath = join(OUT_DIR, `${basename(tsPath, '.ts')}.${counter++}.mjs`);
  writeFileSync(outPath, rewritten);
  return pathToFileURL(outPath).href;
}
