/**
 * Intermediate Representation (IR) for the transpiler
 * Bridge between Solidity AST and Move AST
 */

import type { MoveType, MoveAbility } from './move-ast.js';

// Contract IR
export interface IRContract {
  name: string;
  stateVariables: IRStateVariable[];
  functions: IRFunction[];
  events: IREvent[];
  errors: IRError[];
  modifiers: IRModifier[];
  structs: IRStruct[];
  enums: IREnum[];
  constructor?: IRConstructor;
  inheritedContracts: string[];
  isAbstract: boolean;
  isInterface: boolean;
  isLibrary: boolean;
  usingFor?: IRUsingFor[];  // using Library for Type declarations
}

// Using X for Y declaration
export interface IRUsingFor {
  libraryName: string;
  typeName: string;  // '*' means all types
}

// Struct definition
export interface IRStruct {
  name: string;
  fields: IRStructField[];
}

// Enum definition
export interface IREnum {
  name: string;
  members: string[];
}

// State variable
export interface IRStateVariable {
  name: string;
  type: IRType;
  visibility: 'public' | 'private' | 'internal';
  mutability: 'mutable' | 'immutable' | 'constant';
  initialValue?: IRExpression;
  isMapping: boolean;
  mappingKeyType?: IRType;
  mappingValueType?: IRType;
}

// Type representation
export interface IRType {
  solidity: string;  // Original Solidity type string
  move?: MoveType;   // Mapped Move type
  isArray: boolean;
  arrayLength?: number; // undefined for dynamic arrays
  isMapping: boolean;
  keyType?: IRType;
  valueType?: IRType;
  structName?: string;
  structFields?: IRStructField[];
}

export interface IRStructField {
  name: string;
  type: IRType;
}

// Function representation
export interface IRFunction {
  name: string;
  visibility: 'public' | 'external' | 'internal' | 'private';
  stateMutability: 'pure' | 'view' | 'nonpayable' | 'payable';
  params: IRFunctionParam[];
  returnParams: IRFunctionParam[];
  modifiers: IRModifierInvocation[];
  body: IRStatement[];
  isVirtual: boolean;
  isOverride: boolean;
}

export interface IRFunctionParam {
  name: string;
  type: IRType;
  storageLocation?: 'memory' | 'storage' | 'calldata';
}

export interface IRModifierInvocation {
  name: string;
  args: IRExpression[];
}

// Function signature for type inference (used in TranspileContext)
export interface FunctionSignature {
  params: MoveType[];
  returnType?: MoveType | MoveType[];  // undefined = void, array = tuple return
  module?: string;  // Qualified module name if from another module
}

// Constructor
export interface IRConstructor {
  params: IRFunctionParam[];
  modifiers: IRModifierInvocation[];
  body: IRStatement[];
}

// Event
export interface IREvent {
  name: string;
  params: IREventParam[];
}

export interface IREventParam {
  name: string;
  type: IRType;
  indexed: boolean;
}

// Error
export interface IRError {
  name: string;
  params: IRFunctionParam[];
}

// Modifier
export interface IRModifier {
  name: string;
  params: IRFunctionParam[];
  body: IRStatement[];
}

// Statements
export type IRStatement =
  | IRVariableDeclaration
  | IRAssignment
  | IRIfStatement
  | IRForStatement
  | IRWhileStatement
  | IRDoWhileStatement
  | IRReturnStatement
  | IREmitStatement
  | IRRevertStatement
  | IRRequireStatement
  | IRExpressionStatement
  | IRBlockStatement
  | IRBreakStatement
  | IRContinueStatement
  | IRTryStatement
  | IRUncheckedBlock
  | IRPlaceholderStatement;

export interface IRVariableDeclaration {
  kind: 'variable_declaration';
  name: string | string[];
  type?: IRType;
  initialValue?: IRExpression;
}

export interface IRAssignment {
  kind: 'assignment';
  target: IRExpression;
  operator: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '|=' | '&=' | '^=' | '<<=' | '>>=';
  value: IRExpression;
}

export interface IRIfStatement {
  kind: 'if';
  condition: IRExpression;
  thenBlock: IRStatement[];
  elseBlock?: IRStatement[];
}

export interface IRForStatement {
  kind: 'for';
  init?: IRStatement;
  condition?: IRExpression;
  update?: IRExpression;
  body: IRStatement[];
}

export interface IRWhileStatement {
  kind: 'while';
  condition: IRExpression;
  body: IRStatement[];
}

export interface IRDoWhileStatement {
  kind: 'do_while';
  condition: IRExpression;
  body: IRStatement[];
}

export interface IRReturnStatement {
  kind: 'return';
  value?: IRExpression;
}

export interface IREmitStatement {
  kind: 'emit';
  event: string;
  args: IRExpression[];
}

export interface IRRevertStatement {
  kind: 'revert';
  error?: string;
  args?: IRExpression[];
  message?: string;
}

export interface IRRequireStatement {
  kind: 'require';
  condition: IRExpression;
  message?: IRExpression;
}

export interface IRExpressionStatement {
  kind: 'expression';
  expression: IRExpression;
}

export interface IRBlockStatement {
  kind: 'block';
  statements: IRStatement[];
}

export interface IRBreakStatement {
  kind: 'break';
}

export interface IRContinueStatement {
  kind: 'continue';
}

export interface IRPlaceholderStatement {
  kind: 'placeholder';
}

export interface IRTryStatement {
  kind: 'try';
  expression: IRExpression;
  returnParams?: IRFunctionParam[];
  body: IRStatement[];
  catchClauses: IRCatchClause[];
}

export interface IRCatchClause {
  errorName?: string;
  params?: IRFunctionParam[];
  body: IRStatement[];
}

export interface IRUncheckedBlock {
  kind: 'unchecked';
  statements: IRStatement[];
}

// Expressions
export type IRExpression =
  | IRLiteral
  | IRIdentifier
  | IRBinaryOp
  | IRUnaryOp
  | IRFunctionCall
  | IRMemberAccess
  | IRIndexAccess
  | IRConditional
  | IRNewExpression
  | IRTupleExpression
  | IRArrayLiteral
  | IRTypeConversion
  | IRMsgAccess
  | IRBlockAccess
  | IRTxAccess;

export interface IRLiteral {
  kind: 'literal';
  type: 'number' | 'string' | 'bool' | 'hex' | 'address';
  value: string | number | boolean;
  subdenomination?: string; // ether, wei, gwei, etc.
}

export interface IRIdentifier {
  kind: 'identifier';
  name: string;
}

export interface IRBinaryOp {
  kind: 'binary';
  operator: string;
  left: IRExpression;
  right: IRExpression;
}

export interface IRUnaryOp {
  kind: 'unary';
  operator: string;
  operand: IRExpression;
  prefix: boolean;
}

export interface IRFunctionCall {
  kind: 'function_call';
  function: IRExpression;
  args: IRExpression[];
  names?: string[]; // Named arguments
}

export interface IRMemberAccess {
  kind: 'member_access';
  object: IRExpression;
  member: string;
}

export interface IRIndexAccess {
  kind: 'index_access';
  base: IRExpression;
  index: IRExpression;
}

export interface IRConditional {
  kind: 'conditional';
  condition: IRExpression;
  trueExpression: IRExpression;
  falseExpression: IRExpression;
}

export interface IRNewExpression {
  kind: 'new';
  typeName: string;
  args?: IRExpression[];
}

export interface IRTupleExpression {
  kind: 'tuple';
  elements: (IRExpression | null)[];
}

export interface IRArrayLiteral {
  kind: 'array_literal';
  elements: IRExpression[];
}

export interface IRTypeConversion {
  kind: 'type_conversion';
  targetType: IRType;
  expression: IRExpression;
}

// Special EVM context accessors
export interface IRMsgAccess {
  kind: 'msg_access';
  property: 'sender' | 'value' | 'data' | 'sig';
}

export interface IRBlockAccess {
  kind: 'block_access';
  property: 'timestamp' | 'number' | 'difficulty' | 'gaslimit' | 'coinbase' | 'basefee' | 'chainid';
}

export interface IRTxAccess {
  kind: 'tx_access';
  property: 'origin' | 'gasprice';
}

// Transpilation context
export interface TranspileContext {
  contractName: string;
  moduleAddress: string;
  currentFunction?: string;
  currentFunctionStateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  stateVariables: Map<string, IRStateVariable>;
  localVariables: Map<string, IRType>;
  events: Map<string, IREvent>;  // Event definitions for field name lookup
  modifiers?: Map<string, IRModifier>;  // Modifier definitions for inlining
  constants?: Map<string, { type: any; value: any }>;  // Constant definitions (not in state)
  errorCodes?: Map<string, { message: string; code: number }>;  // Error code mappings
  enums?: Map<string, IREnum>;  // Enum definitions for variant lookup
  structs?: Map<string, IRStruct>;  // Struct definitions for constructor detection
  errors: TranspileError[];
  warnings: TranspileWarning[];
  usedModules: Set<string>;
  acquiredResources: Set<string>;
  inheritedContracts?: Map<string, IRContract>;  // For inheritance flattening
  paramNameMap?: Map<string, string>;  // Maps Solidity param names to Move snake_case names
  usingFor?: IRUsingFor[];  // using Library for Type declarations
  libraryFunctions?: Map<string, string>;  // Maps function_name → library_module_name for cross-module calls
  functionSignatures?: Map<string, FunctionSignature>;  // Maps qualified function name → signature for type inference
}

export interface TranspileError {
  message: string;
  location?: { line: number; column: number };
  severity: 'error';
}

export interface TranspileWarning {
  message: string;
  location?: { line: number; column: number };
  severity: 'warning';
}

// Result types
export interface TranspileResult {
  success: boolean;
  module?: import('./move-ast.js').MoveModule;
  errors: TranspileError[];
  warnings: TranspileWarning[];
}
