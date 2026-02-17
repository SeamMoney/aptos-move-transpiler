/**
 * Type abstractions for the Move parser.
 * These types decouple consumers from tree-sitter internals.
 */

/**
 * Position in source code (0-indexed row and column).
 */
export interface MoveSourcePosition {
  row: number;
  column: number;
}

/**
 * A node in the parsed Move syntax tree.
 * Wraps tree-sitter's SyntaxNode with a stable, documented interface.
 */
export interface MoveParseNode {
  /** Grammar node type, e.g. "module_declaration", "function_declaration" */
  type: string;
  /** The source text this node spans */
  text: string;
  /** Whether this is a named node in the grammar (vs anonymous tokens like `;`, `{`) */
  isNamed: boolean;
  /** Whether this node or any descendant has a parse error */
  hasError: boolean;
  /** Start position in source */
  startPosition: MoveSourcePosition;
  /** End position in source */
  endPosition: MoveSourcePosition;
  /** Byte offset of the start of this node */
  startIndex: number;
  /** Byte offset of the end of this node */
  endIndex: number;
  /** Named children (filters out anonymous punctuation tokens) */
  children: MoveParseNode[];
  /** Access a specific child by grammar field name, e.g. "name", "body" */
  fieldChild(fieldName: string): MoveParseNode | null;
  /** Access all children for a grammar field name */
  fieldChildren(fieldName: string): MoveParseNode[];
}

/**
 * A syntax error found during parsing.
 */
export interface MoveParseError {
  /** Human-readable description of the error */
  message: string;
  /** Start position in source */
  startPosition: MoveSourcePosition;
  /** End position in source */
  endPosition: MoveSourcePosition;
  /** The problematic source text (truncated to 200 chars) */
  text: string;
}

/**
 * Result of parsing Move source code into a full syntax tree.
 */
export interface MoveParseResult {
  /** Whether parsing succeeded without errors */
  success: boolean;
  /** Root node of the parse tree (always present, may contain ERROR nodes) */
  tree: MoveParseNode;
  /** Extracted error nodes with positions and context */
  errors: MoveParseError[];
}

/**
 * Result of validating Move source code (lighter than full parse).
 */
export interface MoveValidationResult {
  /** Whether the source is syntactically valid */
  valid: boolean;
  /** Syntax errors found (empty if valid) */
  errors: MoveParseError[];
  /** High-level structure extracted from valid code */
  structure?: {
    modules: string[];
    functions: string[];
    structs: string[];
  };
}
