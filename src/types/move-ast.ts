/**
 * Move v2 AST Type Definitions
 * Represents the structure of generated Move code
 */

// Move type system
export type MoveType =
  | MovePrimitiveType
  | MoveVectorType
  | MoveStructType
  | MoveReferenceType
  | MoveGenericType;

export interface MovePrimitiveType {
  kind: 'primitive';
  name: 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'u256' |
        'i8' | 'i16' | 'i32' | 'i64' | 'i128' | 'i256' |
        'bool' | 'address' | 'signer';
}

export interface MoveVectorType {
  kind: 'vector';
  elementType: MoveType;
}

export interface MoveStructType {
  kind: 'struct';
  module?: string;
  name: string;
  typeArgs?: MoveType[];
}

export interface MoveReferenceType {
  kind: 'reference';
  mutable: boolean;
  innerType: MoveType;
}

export interface MoveGenericType {
  kind: 'generic';
  name: string;
  constraints?: MoveAbility[];
}

// Move abilities
export type MoveAbility = 'copy' | 'drop' | 'store' | 'key';

// Move visibility
export type MoveVisibility = 'public' | 'public(friend)' | 'public(package)' | 'private';

// Move module
export interface MoveModule {
  address: string;
  name: string;
  uses: MoveUseDeclaration[];
  friends: string[];
  structs: MoveStruct[];
  enums: MoveEnum[];
  constants: MoveConstant[];
  functions: MoveFunction[];
}

// Use declarations
export interface MoveUseDeclaration {
  module: string;
  members?: string[];
  alias?: string;
}

// Struct definition
export interface MoveStruct {
  name: string;
  abilities: MoveAbility[];
  typeParams?: MoveTypeParameter[];
  fields: MoveStructField[];
  isEvent?: boolean;
  isResource?: boolean;
}

export interface MoveStructField {
  name: string;
  type: MoveType;
}

export interface MoveTypeParameter {
  name: string;
  constraints?: MoveAbility[];
  isPhantom?: boolean;
}

// Enum definition (Move 2.0)
export interface MoveEnum {
  name: string;
  abilities: MoveAbility[];
  typeParams?: MoveTypeParameter[];
  variants: MoveEnumVariant[];
}

export interface MoveEnumVariant {
  name: string;
  fields?: MoveStructField[];
}

// Constant definition
export interface MoveConstant {
  name: string;
  type: MoveType;
  value: MoveExpression;
}

// Function definition
export interface MoveFunction {
  name: string;
  visibility: MoveVisibility;
  isEntry?: boolean;
  isView?: boolean;
  typeParams?: MoveTypeParameter[];
  params: MoveFunctionParam[];
  returnType?: MoveType | MoveType[];
  acquires?: string[];
  body: MoveStatement[];
}

export interface MoveFunctionParam {
  name: string;
  type: MoveType;
}

// Statements
export type MoveStatement =
  | MoveLetStatement
  | MoveAssignStatement
  | MoveIfStatement
  | MoveWhileStatement
  | MoveLoopStatement
  | MoveForStatement
  | MoveReturnStatement
  | MoveAbortStatement
  | MoveExpressionStatement
  | MoveBlockStatement;

export interface MoveLetStatement {
  kind: 'let';
  pattern: string | string[];
  mutable?: boolean;
  type?: MoveType;
  value?: MoveExpression;
}

export interface MoveAssignStatement {
  kind: 'assign';
  target: MoveExpression;
  operator?: '+=' | '-=' | '*=' | '/=' | '%=' | '|=' | '&=' | '^=';
  value: MoveExpression;
}

export interface MoveIfStatement {
  kind: 'if';
  condition: MoveExpression;
  thenBlock: MoveStatement[];
  elseBlock?: MoveStatement[];
}

export interface MoveWhileStatement {
  kind: 'while';
  label?: string;
  condition: MoveExpression;
  body: MoveStatement[];
}

export interface MoveLoopStatement {
  kind: 'loop';
  label?: string;
  body: MoveStatement[];
}

export interface MoveForStatement {
  kind: 'for';
  label?: string;
  iterator: string;
  iterable: MoveExpression;
  body: MoveStatement[];
}

export interface MoveReturnStatement {
  kind: 'return';
  value?: MoveExpression;
}

export interface MoveAbortStatement {
  kind: 'abort';
  code: MoveExpression;
}

export interface MoveExpressionStatement {
  kind: 'expression';
  expression: MoveExpression;
}

export interface MoveBlockStatement {
  kind: 'block';
  statements: MoveStatement[];
}

// Expressions
export type MoveExpression =
  | MoveLiteralExpression
  | MoveIdentifierExpression
  | MoveBinaryExpression
  | MoveUnaryExpression
  | MoveCallExpression
  | MoveMethodCallExpression
  | MoveFieldAccessExpression
  | MoveIndexExpression
  | MoveStructExpression
  | MoveBorrowExpression
  | MoveDereferenceExpression
  | MoveCastExpression
  | MoveIfExpression
  | MoveTupleExpression
  | MoveVectorExpression
  | MoveBreakExpression
  | MoveContinueExpression
  | MoveMoveExpression
  | MoveCopyExpression;

export interface MoveLiteralExpression {
  kind: 'literal';
  type: 'number' | 'bool' | 'address' | 'bytestring' | 'string';
  value: string | number | boolean;
  suffix?: string; // e.g., 'u64', 'u256'
}

export interface MoveIdentifierExpression {
  kind: 'identifier';
  name: string;
}

export interface MoveBinaryExpression {
  kind: 'binary';
  operator: '+' | '-' | '*' | '/' | '%' |
            '==' | '!=' | '<' | '>' | '<=' | '>=' |
            '&&' | '||' | '&' | '|' | '^' | '<<' | '>>';
  left: MoveExpression;
  right: MoveExpression;
}

export interface MoveUnaryExpression {
  kind: 'unary';
  operator: '!' | '-';
  operand: MoveExpression;
}

export interface MoveCallExpression {
  kind: 'call';
  function: string;
  module?: string;
  typeArgs?: MoveType[];
  args: MoveExpression[];
}

export interface MoveMethodCallExpression {
  kind: 'method_call';
  receiver: MoveExpression;
  method: string;
  typeArgs?: MoveType[];
  args: MoveExpression[];
}

export interface MoveFieldAccessExpression {
  kind: 'field_access';
  object: MoveExpression;
  field: string;
}

export interface MoveIndexExpression {
  kind: 'index';
  object: MoveExpression;
  index: MoveExpression;
}

export interface MoveStructExpression {
  kind: 'struct';
  module?: string;
  name: string;
  typeArgs?: MoveType[];
  fields: { name: string; value: MoveExpression }[];
}

export interface MoveBorrowExpression {
  kind: 'borrow';
  mutable: boolean;
  value: MoveExpression;
}

export interface MoveDereferenceExpression {
  kind: 'dereference';
  value: MoveExpression;
}

export interface MoveCastExpression {
  kind: 'cast';
  value: MoveExpression;
  targetType: MoveType;
}

export interface MoveIfExpression {
  kind: 'if_expr';
  condition: MoveExpression;
  thenExpr: MoveExpression;
  elseExpr?: MoveExpression;
}

export interface MoveTupleExpression {
  kind: 'tuple';
  elements: MoveExpression[];
}

export interface MoveVectorExpression {
  kind: 'vector';
  elementType?: MoveType;
  elements: MoveExpression[];
}

export interface MoveBreakExpression {
  kind: 'break';
  label?: string;
  value?: MoveExpression;
}

export interface MoveContinueExpression {
  kind: 'continue';
  label?: string;
}

export interface MoveMoveExpression {
  kind: 'move';
  value: MoveExpression;
}

export interface MoveCopyExpression {
  kind: 'copy';
  value: MoveExpression;
}

// Helper functions to create types
export const MoveTypes = {
  u8: (): MovePrimitiveType => ({ kind: 'primitive', name: 'u8' }),
  u16: (): MovePrimitiveType => ({ kind: 'primitive', name: 'u16' }),
  u32: (): MovePrimitiveType => ({ kind: 'primitive', name: 'u32' }),
  u64: (): MovePrimitiveType => ({ kind: 'primitive', name: 'u64' }),
  u128: (): MovePrimitiveType => ({ kind: 'primitive', name: 'u128' }),
  u256: (): MovePrimitiveType => ({ kind: 'primitive', name: 'u256' }),
  i8: (): MovePrimitiveType => ({ kind: 'primitive', name: 'i8' }),
  i16: (): MovePrimitiveType => ({ kind: 'primitive', name: 'i16' }),
  i32: (): MovePrimitiveType => ({ kind: 'primitive', name: 'i32' }),
  i64: (): MovePrimitiveType => ({ kind: 'primitive', name: 'i64' }),
  i128: (): MovePrimitiveType => ({ kind: 'primitive', name: 'i128' }),
  i256: (): MovePrimitiveType => ({ kind: 'primitive', name: 'i256' }),
  bool: (): MovePrimitiveType => ({ kind: 'primitive', name: 'bool' }),
  address: (): MovePrimitiveType => ({ kind: 'primitive', name: 'address' }),
  signer: (): MovePrimitiveType => ({ kind: 'primitive', name: 'signer' }),
  vector: (elementType: MoveType): MoveVectorType => ({ kind: 'vector', elementType }),
  struct: (name: string, module?: string, typeArgs?: MoveType[]): MoveStructType => ({
    kind: 'struct',
    name,
    module,
    typeArgs
  }),
  ref: (innerType: MoveType, mutable = false): MoveReferenceType => ({
    kind: 'reference',
    mutable,
    innerType
  }),
  mutRef: (innerType: MoveType): MoveReferenceType => ({
    kind: 'reference',
    mutable: true,
    innerType
  }),
};
