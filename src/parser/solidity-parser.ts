/**
 * Solidity Parser Wrapper
 * Parses Solidity source code into AST using @solidity-parser/parser
 */

import * as parser from '@solidity-parser/parser';
import type { ASTNode, SourceUnit, ContractDefinition } from '@solidity-parser/parser/dist/src/ast-types.js';

export interface ParseResult {
  success: boolean;
  ast?: SourceUnit;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line?: number;
  column?: number;
}

export interface ParseOptions {
  tolerant?: boolean;
  range?: boolean;
  loc?: boolean;
}

/**
 * Parse Solidity source code into AST
 */
export function parseSolidity(source: string, options: ParseOptions = {}): ParseResult {
  try {
    const ast = parser.parse(source, {
      tolerant: options.tolerant ?? true,
      range: options.range ?? true,
      loc: options.loc ?? true,
    });

    return {
      success: true,
      ast,
      errors: [],
    };
  } catch (error) {
    const err = error as Error & { errors?: any[] };

    // Handle parser errors
    if (err.errors && Array.isArray(err.errors)) {
      return {
        success: false,
        errors: err.errors.map((e: any) => ({
          message: e.message || String(e),
          line: e.line,
          column: e.column,
        })),
      };
    }

    return {
      success: false,
      errors: [{
        message: err.message || 'Unknown parse error',
      }],
    };
  }
}

/**
 * Extract all contract definitions from a parsed AST
 */
export function extractContracts(ast: SourceUnit): ContractDefinition[] {
  return ast.children.filter(
    (node): node is ContractDefinition => node.type === 'ContractDefinition'
  );
}

/**
 * Extract pragma directives
 */
export function extractPragmas(ast: SourceUnit): string[] {
  return ast.children
    .filter((node) => node.type === 'PragmaDirective')
    .map((node: any) => `${node.name} ${node.value}`);
}

/**
 * Extract import statements
 */
export function extractImports(ast: SourceUnit): ImportInfo[] {
  return ast.children
    .filter((node) => node.type === 'ImportDirective')
    .map((node: any) => ({
      path: node.path,
      unitAlias: node.unitAlias,
      symbolAliases: node.symbolAliases || [],
    }));
}

export interface ImportInfo {
  path: string;
  unitAlias?: string;
  symbolAliases: { symbol: string; alias?: string }[];
}

/**
 * Visit all nodes in an AST
 */
export function visitAST(
  ast: ASTNode,
  visitor: { [key: string]: (node: ASTNode) => void }
): void {
  parser.visit(ast, visitor);
}

/**
 * Get the source location string for error messages
 */
export function getLocationString(node: ASTNode): string {
  if ('loc' in node && node.loc) {
    return `line ${node.loc.start.line}, column ${node.loc.start.column}`;
  }
  return 'unknown location';
}

// Re-export types from the parser
export type {
  ASTNode,
  SourceUnit,
  ContractDefinition,
  FunctionDefinition,
  StateVariableDeclaration,
  VariableDeclaration,
  EventDefinition,
  ModifierDefinition,
  StructDefinition,
  EnumDefinition,
  TypeName,
  Expression,
  Statement,
  Block,
} from '@solidity-parser/parser/dist/src/ast-types.js';
