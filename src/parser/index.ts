export {
  parseSolidity,
  extractContracts,
  extractPragmas,
  extractImports,
  visitAST,
  getLocationString,
} from './solidity-parser.js';

export type {
  ParseResult,
  ParseError,
  ParseOptions,
  ImportInfo,
} from './solidity-parser.js';

// Move parser (requires optional tree-sitter dependencies)
export {
  parseMoveCode,
  validateMoveCode,
  isMoveParserAvailable,
  resetMoveParser,
} from './move-parser/index.js';

export type {
  MoveParseResult,
  MoveParseError,
  MoveValidationResult,
  MoveParseNode,
  MoveSourcePosition,
} from './move-parser/index.js';
