/**
 * Centralized type inference utilities for Move expression types.
 *
 * Provides functions to determine, compare, and reconcile Move types
 * across expressions — replacing ad-hoc pattern matching on identifiers.
 */

import type {
  MoveType,
  MovePrimitiveType,
  MoveExpression,
  MoveCastExpression,
} from '../types/move-ast.js';
import type { TranspileContext, IRType } from '../types/ir.js';

// Integer type width map: positive = unsigned, negative = signed
const INT_WIDTH_MAP: Record<string, number> = {
  'u8': 8, 'u16': 16, 'u32': 32, 'u64': 64, 'u128': 128, 'u256': 256,
  'i8': -8, 'i16': -16, 'i32': -32, 'i64': -64, 'i128': -128, 'i256': -256,
};

// Suffix to MoveType mapping
const SUFFIX_TO_TYPE: Record<string, MovePrimitiveType> = {
  'u8': { kind: 'primitive', name: 'u8' },
  'u16': { kind: 'primitive', name: 'u16' },
  'u32': { kind: 'primitive', name: 'u32' },
  'u64': { kind: 'primitive', name: 'u64' },
  'u128': { kind: 'primitive', name: 'u128' },
  'u256': { kind: 'primitive', name: 'u256' },
  'i8': { kind: 'primitive', name: 'i8' },
  'i16': { kind: 'primitive', name: 'i16' },
  'i32': { kind: 'primitive', name: 'i32' },
  'i64': { kind: 'primitive', name: 'i64' },
  'i128': { kind: 'primitive', name: 'i128' },
  'i256': { kind: 'primitive', name: 'i256' },
};

/**
 * Get the bit width of a Move type.
 * Returns positive for unsigned (8, 16, 32, 64, 128, 256),
 * negative for signed (-8, -16, ..., -256),
 * or undefined for non-integer types.
 */
export function getTypeWidth(type: MoveType | undefined): number | undefined {
  if (!type || type.kind !== 'primitive') return undefined;
  return INT_WIDTH_MAP[type.name];
}

/**
 * Check if a MoveType is a boolean.
 */
export function isBoolType(type: MoveType | undefined): boolean {
  return type?.kind === 'primitive' && type.name === 'bool';
}

/**
 * Check if a MoveType is an integer type (signed or unsigned).
 */
export function isIntegerType(type: MoveType | undefined): boolean {
  return getTypeWidth(type) !== undefined;
}

/**
 * Check if a MoveType is unsigned integer.
 */
export function isUnsignedType(type: MoveType | undefined): boolean {
  const w = getTypeWidth(type);
  return w !== undefined && w > 0;
}

/**
 * Check if a MoveType is signed integer.
 */
export function isSignedType(type: MoveType | undefined): boolean {
  const w = getTypeWidth(type);
  return w !== undefined && w < 0;
}

/**
 * Get the wider of two integer types. Both must be same signedness.
 * Returns the type with the larger bit width, or undefined if incompatible.
 */
export function getWiderType(a: MoveType | undefined, b: MoveType | undefined): MoveType | undefined {
  const wa = getTypeWidth(a);
  const wb = getTypeWidth(b);
  if (wa === undefined || wb === undefined) return undefined;

  // Can't widen between signed and unsigned
  const aSigned = wa < 0;
  const bSigned = wb < 0;
  if (aSigned !== bSigned) return undefined;

  const absA = Math.abs(wa);
  const absB = Math.abs(wb);
  if (absA >= absB) return a;
  return b;
}

/**
 * Infer the result type of a binary operation in Move.
 *
 * Rules:
 * - Comparison operators (==, !=, <, >, <=, >=) → bool
 * - Logical operators (&&, ||) → bool
 * - Arithmetic (+, -, *, /, %) → same type as operands (must match in Move)
 * - Bitwise (&, |, ^) → same type as operands
 * - Shift (<<, >>) → type of left operand (right must be u8)
 */
export function inferBinaryResultType(
  op: string,
  leftType: MoveType | undefined,
  rightType: MoveType | undefined,
): MoveType | undefined {
  // Comparison and logical operators always return bool
  if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(op)) {
    return { kind: 'primitive', name: 'bool' };
  }

  // Shift operators: result is type of left operand
  if (op === '<<' || op === '>>') {
    return leftType;
  }

  // Arithmetic and bitwise: operands must be same type in Move
  // Return whichever is known (they should be the same after harmonization)
  if (leftType) return leftType;
  if (rightType) return rightType;
  return undefined;
}

/**
 * Create a cast expression wrapping `expr` if its type differs from `targetType`.
 * Returns the original expression unchanged if types already match or are unknown.
 */
export function createCastIfNeeded(
  expr: MoveExpression,
  fromType: MoveType | undefined,
  targetType: MoveType | undefined,
): MoveExpression {
  if (!fromType || !targetType) return expr;
  if (typesEqual(fromType, targetType)) return expr;

  // Only cast between integer types
  if (!isIntegerType(fromType) || !isIntegerType(targetType)) return expr;

  const cast: MoveCastExpression = {
    kind: 'cast',
    value: expr,
    targetType,
    inferredType: targetType,
  };
  return cast;
}

/**
 * Harmonize two expressions for a comparison. If they have different integer
 * widths (same signedness), upcast the narrower one to the wider type.
 * Returns { left, right } with potential casts applied.
 */
export function harmonizeComparisonTypes(
  left: MoveExpression,
  right: MoveExpression,
): { left: MoveExpression; right: MoveExpression } {
  const leftType = getExprInferredType(left);
  const rightType = getExprInferredType(right);

  const leftWidth = getTypeWidth(leftType);
  const rightWidth = getTypeWidth(rightType);

  if (leftWidth === undefined || rightWidth === undefined) {
    return { left, right };
  }
  if (leftWidth === rightWidth) {
    return { left, right };
  }

  const leftSigned = leftWidth < 0;
  const rightSigned = rightWidth < 0;

  // Only harmonize same-signedness types
  if (leftSigned !== rightSigned) {
    return { left, right };
  }

  const absLeft = Math.abs(leftWidth);
  const absRight = Math.abs(rightWidth);
  const wider = getWiderType(leftType!, rightType!);
  if (!wider) return { left, right };

  if (absLeft < absRight) {
    return { left: createCastIfNeeded(left, leftType, wider), right };
  } else {
    return { left, right: createCastIfNeeded(right, rightType, wider) };
  }
}

/**
 * Get the inferredType from a MoveExpression (any variant).
 * Returns undefined if the expression doesn't have one set.
 */
export function getExprInferredType(expr: MoveExpression): MoveType | undefined {
  return (expr as any).inferredType;
}

/**
 * Set the inferredType on a MoveExpression.
 */
export function setExprInferredType(expr: MoveExpression, type: MoveType | undefined): void {
  if (type) {
    (expr as any).inferredType = type;
  }
}

/**
 * Resolve an IRType to a MoveType for use in type inference.
 */
export function irTypeToMoveType(irType: IRType | undefined): MoveType | undefined {
  if (!irType) return undefined;
  return irType.move ?? undefined;
}

/**
 * Look up the type of a variable from the TranspileContext.
 * Checks localVariables, then stateVariables, then constants.
 */
export function lookupVariableType(name: string, context: TranspileContext): MoveType | undefined {
  // Local variables
  const localType = context.localVariables?.get(name);
  if (localType?.move) return localType.move;

  // State variables
  const stateVar = context.stateVariables?.get(name);
  if (stateVar?.type?.move) return stateVar.type.move;

  // Constants
  const constant = context.constants?.get(name);
  if (constant?.type?.move) return constant.type.move;

  return undefined;
}

/**
 * Convert a literal suffix string to a MoveType.
 */
export function suffixToMoveType(suffix: string | undefined): MoveType | undefined {
  if (!suffix) return undefined;
  return SUFFIX_TO_TYPE[suffix] ?? undefined;
}

/**
 * Make a primitive MoveType from a type name string.
 */
export function makePrimitiveType(name: string): MovePrimitiveType | undefined {
  if (name in INT_WIDTH_MAP || name === 'bool' || name === 'address' || name === 'signer') {
    return { kind: 'primitive', name: name as MovePrimitiveType['name'] };
  }
  return undefined;
}

/**
 * Check structural equality of two MoveTypes.
 */
export function typesEqual(a: MoveType, b: MoveType): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === 'primitive' && b.kind === 'primitive') {
    return a.name === b.name;
  }
  if (a.kind === 'vector' && b.kind === 'vector') {
    return typesEqual(a.elementType, b.elementType);
  }
  if (a.kind === 'struct' && b.kind === 'struct') {
    if (a.name !== b.name || a.module !== b.module) return false;
    if ((a.typeArgs?.length ?? 0) !== (b.typeArgs?.length ?? 0)) return false;
    if (a.typeArgs && b.typeArgs) {
      return a.typeArgs.every((t: MoveType, i: number) => typesEqual(t, b.typeArgs![i]));
    }
    return true;
  }
  if (a.kind === 'reference' && b.kind === 'reference') {
    return a.mutable === b.mutable && typesEqual(a.innerType, b.innerType);
  }
  if (a.kind === 'generic' && b.kind === 'generic') {
    return a.name === b.name;
  }
  return false;
}
