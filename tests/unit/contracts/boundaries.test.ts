// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps every Shared import inside Shared or the Zod dependency', () => {
  const shared = resolve('src/shared');
  const inspect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
      const visit = (node: ts.Node) => {
        let module: string | undefined;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) module = node.moduleSpecifier.text;
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) module = node.argument.literal.text;
        if (module) expect(module === 'zod' || module.startsWith('.') && resolve(dirname(file), module).startsWith(shared + '/'), `${file}: ${module}`).toBe(true);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  inspect(shared);
});
