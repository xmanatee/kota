import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

export type CodemodResult = {
  readonly modified: boolean;
  readonly content: string;
};

/**
 * Narrow, idempotent codemod: adds a missing module dependency to a KotaModule's
 * `dependencies: [...]` array in its `index.ts`.
 *
 * Uses TypeScript AST transformation to ensure syntactic safety and idempotency.
 */
export function codemodAddModuleDependency(
  indexPath: string,
  dependencyName: string,
  applyToFile = false,
): CodemodResult {
  const content = readFileSync(indexPath, "utf-8");
  const sourceFile = ts.createSourceFile(
    indexPath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  let modified = false;
  let alreadyHasDependency = false;
  let hasDependenciesProperty = false;

  // First pass: check if already present
  function checkPass(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile);
      if (name === "dependencies") {
        hasDependenciesProperty = true;
        if (ts.isArrayLiteralExpression(node.initializer)) {
          for (const el of node.initializer.elements) {
            if (ts.isStringLiteral(el) && el.text === dependencyName) {
              alreadyHasDependency = true;
              return;
            }
          }
        }
      }
    }
    ts.forEachChild(node, checkPass);
  }
  checkPass(sourceFile);

  if (alreadyHasDependency) {
    return { modified: false, content };
  }

  // Transformation pass
  const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
    return (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isPropertyAssignment(node)) {
          const name = node.name.getText(sourceFile);
          if (name === "dependencies" && ts.isArrayLiteralExpression(node.initializer)) {
            const elements = [...node.initializer.elements];
            elements.push(context.factory.createStringLiteral(dependencyName));
            modified = true;
            return context.factory.updatePropertyAssignment(
              node,
              node.name,
              context.factory.updateArrayLiteralExpression(node.initializer, elements),
            );
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(rootNode, visit);
    };
  };

  let newContent = content;

  if (hasDependenciesProperty) {
    const result = ts.transform(sourceFile, [transformer]);
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    newContent = printer.printFile(result.transformed[0] as ts.SourceFile);
  } else {
    // Add dependencies property to the module definition
    const objTransformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      return (rootNode: T) => {
        function visit(node: ts.Node): ts.Node {
          if (ts.isObjectLiteralExpression(node)) {
            // Check if this looks like a KotaModule (has 'name' property)
            const hasNameProp = node.properties.some(
              (p) =>
                ts.isPropertyAssignment(p) &&
                p.name.getText(sourceFile) === "name",
            );
            if (hasNameProp && !modified) {
              modified = true;
              const newProps = [
                ...node.properties,
                context.factory.createPropertyAssignment(
                  context.factory.createIdentifier("dependencies"),
                  context.factory.createArrayLiteralExpression([
                    context.factory.createStringLiteral(dependencyName),
                  ]),
                ),
              ];
              return context.factory.updateObjectLiteralExpression(node, newProps);
            }
          }
          return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(rootNode, visit);
      };
    };
    const result = ts.transform(sourceFile, [objTransformer]);
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    newContent = printer.printFile(result.transformed[0] as ts.SourceFile);
  }

  if (modified && applyToFile) {
    writeFileSync(indexPath, newContent, "utf-8");
  }

  return { modified, content: newContent };
}

/**
 * Narrow, idempotent codemod: removes an unused top-level import statement by module specifier.
 */
export function codemodRemoveUnusedImport(
  filePath: string,
  specifierText: string,
  applyToFile = false,
): CodemodResult {
  const content = readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  let found = false;
  const filteredStatements = sourceFile.statements.filter((stmt) => {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === specifierText
    ) {
      found = true;
      return false;
    }
    return true;
  });

  if (!found) {
    return { modified: false, content };
  }

  const updatedSourceFile = ts.factory.updateSourceFile(sourceFile, filteredStatements);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const newContent = printer.printFile(updatedSourceFile);

  if (applyToFile) {
    writeFileSync(filePath, newContent, "utf-8");
  }

  return { modified: true, content: newContent };
}
