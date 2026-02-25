/**
 * Move Code Generator
 * Generates Move v2 source code from Move AST
 */

import type {
  MoveModule,
  MoveUseDeclaration,
  MoveStruct,
  MoveFunction,
  MoveEnum,
  MoveConstant,
  MoveStatement,
  MoveExpression,
  MoveType,
  MoveAbility,
  MoveStructField,
  MoveFunctionParam,
  MoveTypeParameter,
} from '../types/move-ast.js';
import { renderSpecs } from './spec-generator.js';

/**
 * Module-level call style flag, set at the start of generateMoveCode().
 * Controls whether known stdlib calls are rendered as module-qualified
 * (e.g., `vector::length(&v)`) or receiver syntax (e.g., `v.length()`).
 */
let _currentCallStyle: 'module-qualified' | 'receiver' = 'module-qualified';

/**
 * Module-level index notation flag, set at the start of generateMoveCode().
 * When true, renders vector::borrow/borrow_mut as v[i] and
 * borrow_global/borrow_global_mut as Type[addr] (Move 2.0+ syntax).
 */
let _currentIndexNotation = false;

/**
 * Unwrap a borrow (reference) expression to get the inner value.
 * Strips `&` or `&mut` from an expression for index notation rendering.
 */
function unwrapBorrow(expr: MoveExpression): MoveExpression {
  if (expr.kind === 'borrow') return expr.value;
  return expr;
}

/**
 * Generate the correct XOR mask for bitwise NOT based on integer type width.
 * Move has no `~` operator; `~x` must be lowered to `x ^ MAX_VALUE`.
 */
function bitwiseNotMask(typeName: string): string {
  switch (typeName) {
    case 'u8': return '0xffu8';
    case 'u16': return '0xffffu16';
    case 'u32': return '0xffffffffu32';
    case 'u64': return '0xffffffffffffffffu64';
    case 'u128': return '0xffffffffffffffffffffffffffffffffu128';
    case 'u256':
    default:
      return '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256';
  }
}

/**
 * Set of module::function names eligible for receiver syntax conversion.
 * These are known Move stdlib/framework functions where the first parameter
 * is a reference to (or owned value of) the receiver type.
 */
const RECEIVER_ELIGIBLE_FUNCTIONS = new Set([
  // vector
  'vector::length',
  'vector::is_empty',
  'vector::push_back',
  'vector::pop_back',
  'vector::borrow',
  'vector::borrow_mut',
  'vector::contains',
  'vector::index_of',
  'vector::remove',
  'vector::swap',
  'vector::reverse',
  'vector::append',
  'vector::trim',
  // string
  'string::length',
  'string::bytes',
  'string::is_empty',
  'string::append',
  'string::utf8',
  // table
  'table::contains',
  'table::borrow',
  'table::borrow_mut',
  'table::borrow_with_default',
  'table::borrow_mut_with_default',
  'table::add',
  'table::remove',
  'table::upsert',
  'table::length',
  // smart_table
  'smart_table::contains',
  'smart_table::borrow',
  'smart_table::borrow_mut',
  'smart_table::add',
  'smart_table::remove',
  'smart_table::upsert',
  'smart_table::length',
  // option
  'option::is_none',
  'option::is_some',
  'option::borrow',
  'option::extract',
  'option::contains',
  'option::swap',
]);

/**
 * Generate Move source code from a module AST
 */
export function generateMoveCode(module: MoveModule): string {
  _currentCallStyle = module.callStyle || 'module-qualified';
  _currentIndexNotation = module.indexNotation || false;

  const lines: string[] = [];

  // Module declaration
  lines.push(`module ${module.address}::${module.name} {`);

  // Use declarations
  if (module.uses.length > 0) {
    lines.push('');
    for (const use of module.uses) {
      lines.push(`    ${generateUse(use)}`);
    }
  }

  // Friend declarations
  if (module.friends.length > 0) {
    lines.push('');
    for (const friend of module.friends) {
      lines.push(`    friend ${friend};`);
    }
  }

  // Constants
  if (module.constants.length > 0) {
    lines.push('');
    lines.push('    // Error codes');
    for (const constant of module.constants) {
      lines.push(`    ${generateConstant(constant)}`);
    }
  }

  // Structs
  for (const struct of module.structs) {
    lines.push('');
    lines.push(generateStruct(struct, 4));
  }

  // Enums
  for (const enumDef of module.enums) {
    lines.push('');
    lines.push(generateEnum(enumDef, 4));
  }

  // Functions
  for (const func of module.functions) {
    lines.push('');
    lines.push(generateFunction(func, 4));
  }

  // Spec blocks (MSL)
  if (module.specs && module.specs.length > 0) {
    lines.push('');
    lines.push('    // ─── Specifications (MSL) ───────────────────────────────────');
    lines.push(...renderSpecs(module.specs, 4));
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * Generate use declaration
 */
function generateUse(use: MoveUseDeclaration): string {
  if (use.members && use.members.length > 0) {
    const members = use.members.join(', ');
    return `use ${use.module}::{${members}};`;
  }
  if (use.alias) {
    return `use ${use.module} as ${use.alias};`;
  }
  return `use ${use.module};`;
}

/**
 * Generate constant declaration
 */
function generateConstant(constant: MoveConstant): string {
  const typeStr = generateType(constant.type);
  const valueStr = generateExpression(constant.value);
  return `const ${constant.name}: ${typeStr} = ${valueStr};`;
}

/**
 * Generate struct definition
 */
function generateStruct(struct: MoveStruct, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  // Event attribute
  if (struct.isEvent) {
    lines.push(`${pad}#[event]`);
  }

  // Struct declaration
  let decl = `${pad}struct ${struct.name}`;

  // Type parameters
  if (struct.typeParams && struct.typeParams.length > 0) {
    decl += `<${struct.typeParams.map(generateTypeParam).join(', ')}>`;
  }

  // Abilities
  if (struct.abilities.length > 0) {
    decl += ` has ${struct.abilities.join(', ')}`;
  }

  decl += ' {';
  lines.push(decl);

  // Fields
  for (let i = 0; i < struct.fields.length; i++) {
    const field = struct.fields[i];
    const comma = i < struct.fields.length - 1 ? ',' : '';
    lines.push(`${pad}    ${field.name}: ${generateType(field.type)}${comma}`);
  }

  lines.push(`${pad}}`);

  return lines.join('\n');
}

/**
 * Generate enum definition
 */
function generateEnum(enumDef: MoveEnum, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  let decl = `${pad}enum ${enumDef.name}`;

  if (enumDef.typeParams && enumDef.typeParams.length > 0) {
    decl += `<${enumDef.typeParams.map(generateTypeParam).join(', ')}>`;
  }

  if (enumDef.abilities.length > 0) {
    decl += ` has ${enumDef.abilities.join(', ')}`;
  }

  decl += ' {';
  lines.push(decl);

  for (let i = 0; i < enumDef.variants.length; i++) {
    const variant = enumDef.variants[i];
    const comma = i < enumDef.variants.length - 1 ? ',' : '';

    if (variant.fields && variant.fields.length > 0) {
      const fields = variant.fields
        .map(f => `${f.name}: ${generateType(f.type)}`)
        .join(', ');
      lines.push(`${pad}    ${variant.name} { ${fields} }${comma}`);
    } else {
      lines.push(`${pad}    ${variant.name}${comma}`);
    }
  }

  lines.push(`${pad}}`);

  return lines.join('\n');
}

/**
 * Generate function definition
 */
function generateFunction(func: MoveFunction, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  // Source comment (emitSourceComments flag)
  if (func.sourceComment) {
    lines.push(`${pad}// ${func.sourceComment}`);
  }

  // View attribute
  if (func.isView) {
    lines.push(`${pad}#[view]`);
  }

  // Function signature
  let sig = pad;

  // Visibility
  if (func.visibility === 'public') {
    sig += 'public ';
  } else if (func.visibility === 'public(friend)') {
    sig += 'public(friend) ';
  } else if (func.visibility === 'public(package)') {
    sig += 'public(package) ';
  }

  // Inline
  if (func.isInline) {
    sig += 'inline ';
  }

  // Entry
  if (func.isEntry) {
    sig += 'entry ';
  }

  sig += `fun ${func.name}`;

  // Type parameters
  if (func.typeParams && func.typeParams.length > 0) {
    sig += `<${func.typeParams.map(generateTypeParam).join(', ')}>`;
  }

  // Parameters
  sig += '(';
  sig += func.params.map(p => `${p.name}: ${generateType(p.type)}`).join(', ');
  sig += ')';

  // Return type
  if (func.returnType) {
    if (Array.isArray(func.returnType)) {
      sig += `: (${func.returnType.map(generateType).join(', ')})`;
    } else {
      sig += `: ${generateType(func.returnType)}`;
    }
  }

  // Acquires
  if (func.acquires && func.acquires.length > 0) {
    sig += ` acquires ${func.acquires.join(', ')}`;
  }

  sig += ' {';
  lines.push(sig);

  // Body (stop after return to eliminate dead code)
  for (const stmt of func.body) {
    lines.push(generateStatement(stmt, indent + 4));
    if (stmt.kind === 'return') break;
  }

  lines.push(`${pad}}`);

  return lines.join('\n');
}

/**
 * Generate type parameter
 */
function generateTypeParam(param: MoveTypeParameter): string {
  let str = '';
  if (param.isPhantom) {
    str += 'phantom ';
  }
  str += param.name;
  if (param.constraints && param.constraints.length > 0) {
    str += `: ${param.constraints.join(' + ')}`;
  }
  return str;
}

/**
 * Generate type
 */
function generateType(type: MoveType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;

    case 'vector':
      return `vector<${generateType(type.elementType)}>`;

    case 'struct':
      let str = '';
      if (type.module) {
        str += `${type.module}::`;
      }
      str += type.name;
      if (type.typeArgs && type.typeArgs.length > 0) {
        str += `<${type.typeArgs.map(generateType).join(', ')}>`;
      }
      return str;

    case 'reference':
      const prefix = type.mutable ? '&mut ' : '&';
      return prefix + generateType(type.innerType);

    case 'generic':
      return type.name;

    default:
      return 'unknown';
  }
}

/**
 * Generate statement
 */
function generateStatement(stmt: MoveStatement, indent: number): string {
  const pad = ' '.repeat(indent);

  switch (stmt.kind) {
    case 'let':
      return generateLetStatement(stmt, pad);

    case 'assign':
      return generateAssignStatement(stmt, pad);

    case 'if':
      return generateIfStatement(stmt, indent);

    case 'while':
      return generateWhileStatement(stmt, indent);

    case 'loop':
      return generateLoopStatement(stmt, indent);

    case 'for':
      return generateForStatement(stmt, indent);

    case 'return':
      if (stmt.value) {
        return `${pad}return ${generateExpression(stmt.value)}`;
      }
      return `${pad}return`;

    case 'abort':
      if (stmt.comment) {
        return `${pad}abort ${generateExpression(stmt.code)} // ${stmt.comment}`;
      }
      return `${pad}abort ${generateExpression(stmt.code)}`;

    case 'expression':
      const exprStr = generateExpression(stmt.expression);
      // Skip empty expressions (e.g., from modifier placeholders)
      if (!exprStr || exprStr.trim() === '' || exprStr === '/* unsupported expression */') {
        return '';
      }
      if (stmt.comment) {
        return `${pad}${exprStr}; // ${stmt.comment}`;
      }
      return `${pad}${exprStr};`;

    case 'block':
      // Generate statements without wrapping braces (flattened)
      // Nested blocks from unchecked are handled in if-statement generator
      return stmt.statements
        .map((s: any) => generateStatement(s, indent))
        .filter((s: string) => s.trim() !== '')
        .join('\n');

    default:
      return `${pad}// Unsupported statement`;
  }
}

/**
 * Generate let statement
 * Note: Move doesn't use 'mut' keyword - all local variables are mutable by default
 */
function generateLetStatement(stmt: any, pad: string): string {
  let str = `${pad}let `;
  const isTuple = Array.isArray(stmt.pattern);

  // Pattern
  if (isTuple) {
    str += `(${stmt.pattern.join(', ')})`;
  } else {
    str += stmt.pattern;
  }

  // Type annotation - only add for non-tuple patterns
  // Move tuple destructuring infers types from the value
  if (stmt.type && !isTuple) {
    str += `: ${generateType(stmt.type)}`;
  }

  // Value
  if (stmt.value) {
    str += ` = ${generateExpression(stmt.value)}`;
  }

  return str + ';';
}

/**
 * Generate assign statement
 */
function generateAssignStatement(stmt: any, pad: string): string {
  const target = generateExpression(stmt.target);
  const value = generateExpression(stmt.value);
  const op = stmt.operator || '=';

  return `${pad}${target} ${op} ${value};`;
}

/**
 * Generate if statement
 * Flattens nested block statements from unchecked blocks
 * In Move, if-else used as statement needs trailing semicolon
 */
function generateIfStatement(stmt: any, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  lines.push(`${pad}if (${generateExpression(stmt.condition)}) {`);

  // Flatten block statements in then block
  for (const s of flattenStatements(stmt.thenBlock)) {
    lines.push(generateStatement(s, indent + 4));
  }

  if (stmt.elseBlock && stmt.elseBlock.length > 0) {
    lines.push(`${pad}} else {`);
    // Flatten block statements in else block
    for (const s of flattenStatements(stmt.elseBlock)) {
      lines.push(generateStatement(s, indent + 4));
    }
  }

  // Add trailing semicolon - in Move, if-else as statement needs it
  lines.push(`${pad}};`);

  return lines.join('\n');
}

/**
 * Flatten nested block statements (from unchecked blocks)
 * If a statement is a block with just statements inside, inline those statements
 */
function flattenStatements(stmts: any[]): any[] {
  const result: any[] = [];
  for (const s of stmts) {
    if (s.kind === 'block' && s.statements) {
      // Inline the block's statements
      result.push(...s.statements);
    } else {
      result.push(s);
    }
  }
  return result;
}

/**
 * Generate while statement
 */
function generateWhileStatement(stmt: any, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  let header = `${pad}`;
  if (stmt.label) {
    header += `'${stmt.label}: `;
  }
  header += `while (${generateExpression(stmt.condition)}) {`;
  lines.push(header);

  for (const s of stmt.body) {
    lines.push(generateStatement(s, indent + 4));
  }

  lines.push(`${pad}}`);

  return lines.join('\n');
}

/**
 * Generate loop statement
 */
function generateLoopStatement(stmt: any, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  let header = `${pad}`;
  if (stmt.label) {
    header += `'${stmt.label}: `;
  }
  header += 'loop {';
  lines.push(header);

  for (const s of stmt.body) {
    lines.push(generateStatement(s, indent + 4));
  }

  lines.push(`${pad}}`);

  return lines.join('\n');
}

/**
 * Generate for statement (Move 2.0+ foreach)
 */
function generateForStatement(stmt: any, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  let header = `${pad}`;
  if (stmt.label) {
    header += `'${stmt.label}: `;
  }

  // Handle range-based iteration (range(start, end) -> start..end)
  let iterableStr: string;
  if (stmt.iterable?.kind === 'call' && stmt.iterable.function === 'range' && stmt.iterable.args?.length === 2) {
    const start = generateExpression(stmt.iterable.args[0]);
    const end = generateExpression(stmt.iterable.args[1]);
    iterableStr = `${start}..${end}`;
  } else {
    iterableStr = generateExpression(stmt.iterable);
  }

  header += `for (${stmt.iterator} in ${iterableStr}) {`;
  lines.push(header);

  for (const s of stmt.body) {
    lines.push(generateStatement(s, indent + 4));
  }

  lines.push(`${pad}}`);

  return lines.join('\n');
}

/**
 * Generate expression
 */
function generateExpression(expr: MoveExpression): string {
  switch (expr.kind) {
    case 'literal':
      return generateLiteral(expr);

    case 'identifier':
      return expr.name;

    case 'binary':
      return `(${generateExpression(expr.left)} ${expr.operator} ${generateExpression(expr.right)})`;

    case 'unary':
      // Move doesn't have bitwise NOT (~), convert to XOR with max value for the correct type width
      if (expr.operator === '~') {
        const operandCode = generateExpression(expr.operand);
        const typeName = expr.operand.inferredType?.kind === 'primitive'
          ? expr.operand.inferredType.name
          : (expr.inferredType?.kind === 'primitive' ? expr.inferredType.name : 'u256');
        return `(${operandCode} ^ ${bitwiseNotMask(typeName)})`;
      }
      return `${expr.operator}${generateExpression(expr.operand)}`;

    case 'call':
      return generateCallExpression(expr);

    case 'method_call':
      const receiver = generateExpression(expr.receiver);
      const args = expr.args.map(generateExpression).join(', ');
      let methodCall = `${receiver}.${expr.method}`;
      if (expr.typeArgs && expr.typeArgs.length > 0) {
        methodCall += `<${expr.typeArgs.map(generateType).join(', ')}>`;
      }
      return `${methodCall}(${args})`;

    case 'field_access': {
      const objStr = generateExpression(expr.object);
      // Wrap dereferences in parens to ensure correct precedence:
      // (*table::borrow(...)).field  instead of  *table::borrow(...).field
      const needsParens = expr.object?.kind === 'dereference';
      return needsParens ? `(${objStr}).${expr.field}` : `${objStr}.${expr.field}`;
    }

    case 'index':
      return `${generateExpression(expr.object)}[${generateExpression(expr.index)}]`;

    case 'struct':
      return generateStructExpression(expr);

    case 'borrow':
      const borrowPrefix = expr.mutable ? '&mut ' : '&';
      return borrowPrefix + generateExpression(expr.value);

    case 'dereference': {
      // Index notation: *vector::borrow(&v, i) → v[i]
      // Also handles *borrow_global<T>(addr) → T[addr]
      if (_currentIndexNotation && expr.value.kind === 'call') {
        const callExpr = expr.value as import('../types/move-ast.js').MoveCallExpression;
        // vector::borrow(&v, i) → v[i]  (strip the outer dereference)
        if (callExpr.function === 'vector::borrow' && callExpr.args.length === 2) {
          const vecExpr = unwrapBorrow(callExpr.args[0]);
          const indexExpr = callExpr.args[1];
          return `${generateExpression(vecExpr)}[${generateExpression(indexExpr)}]`;
        }
        // vector::borrow_mut(&mut v, i) → &mut v[i]  (strip deref, add &mut)
        if (callExpr.function === 'vector::borrow_mut' && callExpr.args.length === 2) {
          const vecExpr = unwrapBorrow(callExpr.args[0]);
          const indexExpr = callExpr.args[1];
          return `&mut ${generateExpression(vecExpr)}[${generateExpression(indexExpr)}]`;
        }
        // borrow_global<Type>(addr) → Type[addr]
        const bgMatch = callExpr.function.match(/^borrow_global<(.+)>$/);
        if (bgMatch && callExpr.args.length >= 1) {
          return `${bgMatch[1]}[${generateExpression(callExpr.args[0])}]`;
        }
        // borrow_global_mut<Type>(addr) → &mut Type[addr]
        const bgmMatch = callExpr.function.match(/^borrow_global_mut<(.+)>$/);
        if (bgmMatch && callExpr.args.length >= 1) {
          return `&mut ${bgmMatch[1]}[${generateExpression(callExpr.args[0])}]`;
        }
      }
      return `*${generateExpression(expr.value)}`;
    }

    case 'cast':
      // Move doesn't support casting to bool - use != 0 instead
      if (expr.targetType?.kind === 'primitive' && expr.targetType.name === 'bool') {
        return `(${generateExpression(expr.value)} != 0)`;
      }
      // Collapse chained casts: (x as T1) as T2 → (x as T2), but only when
      // T1 and T2 are the same type (truly redundant) or when the inner value
      // is a simple expression (no intermediate operations that need T1)
      if (expr.value?.kind === 'cast') {
        const innerTarget = expr.value.targetType;
        const outerTarget = expr.targetType;
        // Only collapse if the inner cast target matches outer (redundant double cast)
        if (innerTarget?.kind === 'primitive' && outerTarget?.kind === 'primitive' &&
            innerTarget.name === outerTarget.name) {
          return `(${generateExpression(expr.value.value)} as ${generateType(expr.targetType)})`;
        }
        // Otherwise, keep both casts (the inner one may be needed for type correctness)
      }
      // Skip no-op casts where value is a literal with matching type suffix
      if (expr.value?.kind === 'literal' && expr.value?.type === 'number' && expr.value?.suffix) {
        const targetName = expr.targetType?.kind === 'primitive' ? expr.targetType.name : null;
        if (targetName && expr.value.suffix === targetName) {
          return generateExpression(expr.value);
        }
      }
      return `(${generateExpression(expr.value)} as ${generateType(expr.targetType)})`;

    case 'if_expr':
      const cond = generateExpression(expr.condition);
      const thenExpr = generateExpression(expr.thenExpr);
      if (expr.elseExpr) {
        return `(if (${cond}) ${thenExpr} else ${generateExpression(expr.elseExpr)})`;
      }
      return `if (${cond}) ${thenExpr}`;

    case 'tuple':
      return `(${expr.elements.map(generateExpression).join(', ')})`;

    case 'vector':
      if (expr.elements.length === 0) {
        if (expr.elementType) {
          return `vector<${generateType(expr.elementType)}>[]`;
        }
        return 'vector[]';
      }
      return `vector[${expr.elements.map(generateExpression).join(', ')}]`;

    case 'break':
      if (expr.label) {
        return `break '${expr.label}`;
      }
      return 'break';

    case 'continue':
      if (expr.label) {
        return `continue '${expr.label}`;
      }
      return 'continue';

    case 'move':
      return `move ${generateExpression(expr.value)}`;

    case 'copy':
      return `copy ${generateExpression(expr.value)}`;

    case 'block_expr': {
      const stmts = expr.statements.map((s: any) => generateStatement(s, 8)).join('\n');
      const val = generateExpression(expr.value);
      return `{\n${stmts}\n        ${val}\n    }`;
    }

    default:
      return '/* unsupported expression */';
  }
}

/**
 * Generate literal
 */
function generateLiteral(expr: any): string {
  switch (expr.type) {
    case 'number':
      // Convert the value, handling scientific notation
      const numValue = normalizeNumber(String(expr.value));
      if (expr.suffix) {
        return `${numValue}${expr.suffix}`;
      }
      return numValue;

    case 'bool':
      return expr.value ? 'true' : 'false';

    case 'address':
      return expr.value;

    case 'bytestring':
      return expr.value;

    case 'string':
      return `"${expr.value}"`;

    default:
      return String(expr.value);
  }
}

/**
 * Normalize a number string, converting scientific notation to full integer
 * Move doesn't support scientific notation like 1e18
 */
function normalizeNumber(value: string): string {
  // Check for scientific notation (e.g., 1e18, 1E18, 10e5)
  const sciMatch = value.match(/^(\d+(?:\.\d+)?)[eE]\+?(\d+)$/);
  if (sciMatch) {
    const mantissa = sciMatch[1];
    const exponent = parseInt(sciMatch[2], 10);

    // Handle mantissa with decimal point
    let result: string;
    if (mantissa.includes('.')) {
      const [intPart, decPart] = mantissa.split('.');
      const decLen = decPart.length;
      if (exponent >= decLen) {
        // All decimals move to integer part, add zeros
        result = intPart + decPart + '0'.repeat(exponent - decLen);
      } else {
        // Some decimals remain - but for integer types, truncate
        result = intPart + decPart.slice(0, exponent);
      }
    } else {
      // No decimal point, just add zeros
      result = mantissa + '0'.repeat(exponent);
    }
    // Strip leading zeros from the expanded result (e.g., 0.1e18 → "0100..." → "100...")
    if (/^0\d/.test(result)) {
      result = result.replace(/^0+/, '') || '0';
    }
    return result;
  }

  // Handle hex numbers
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return value;
  }

  // Strip leading zeros from decimal numbers (0100... → 100...)
  // but preserve "0" itself
  if (/^0\d/.test(value)) {
    value = value.replace(/^0+/, '') || '0';
  }

  // Return as-is if already a plain number
  return value;
}

/**
 * Generate call expression.
 * When _currentCallStyle is 'receiver' and the function is in the
 * RECEIVER_ELIGIBLE_FUNCTIONS set, converts module-qualified calls to
 * receiver syntax (Move 2.2+).
 *
 * Example: vector::length(&v) → v.length()
 */
function generateCallExpression(expr: any): string {
  let funcName: string = expr.function;

  // Handle module-qualified functions
  if (expr.module) {
    funcName = `${expr.module}::${funcName}`;
  }

  // Index notation conversion for Move 2.0+
  // Intercepts vector::borrow, vector::borrow_mut, borrow_global<T>, borrow_global_mut<T>
  // and renders them with bracket syntax.
  if (_currentIndexNotation) {
    // vector::borrow(&v, i) → v[i]
    if (funcName === 'vector::borrow' && expr.args && expr.args.length === 2) {
      const vecExpr = unwrapBorrow(expr.args[0]);
      const indexExpr = expr.args[1];
      return `${generateExpression(vecExpr)}[${generateExpression(indexExpr)}]`;
    }

    // vector::borrow_mut(&mut v, i) → &mut v[i]
    if (funcName === 'vector::borrow_mut' && expr.args && expr.args.length === 2) {
      const vecExpr = unwrapBorrow(expr.args[0]);
      const indexExpr = expr.args[1];
      return `&mut ${generateExpression(vecExpr)}[${generateExpression(indexExpr)}]`;
    }

    // borrow_global<Type>(addr) → Type[addr]
    const bgMatch = funcName.match(/^borrow_global<(.+)>$/);
    if (bgMatch && expr.args && expr.args.length >= 1) {
      return `${bgMatch[1]}[${generateExpression(expr.args[0])}]`;
    }

    // borrow_global_mut<Type>(addr) → &mut Type[addr]
    const bgmMatch = funcName.match(/^borrow_global_mut<(.+)>$/);
    if (bgmMatch && expr.args && expr.args.length >= 1) {
      return `&mut ${bgmMatch[1]}[${generateExpression(expr.args[0])}]`;
    }
  }

  // Receiver syntax conversion for Move 2.2+
  // Only applies to known stdlib functions with at least one argument.
  if (
    _currentCallStyle === 'receiver' &&
    RECEIVER_ELIGIBLE_FUNCTIONS.has(funcName) &&
    expr.args &&
    expr.args.length > 0
  ) {
    const firstArg = expr.args[0];

    // The first argument is typically a reference (borrow).
    // For receiver syntax, Move infers the borrow, so unwrap it.
    let receiverStr: string;
    if (firstArg.kind === 'borrow') {
      receiverStr = generateExpression(firstArg.value);
    } else {
      receiverStr = generateExpression(firstArg);
    }

    // Extract the method name (part after ::)
    const methodName = funcName.split('::')[1];

    // Type arguments go after the method name: receiver.method<T>(args)
    let typeArgsStr = '';
    if (expr.typeArgs && expr.typeArgs.length > 0) {
      typeArgsStr = `<${expr.typeArgs.map(generateType).join(', ')}>`;
    }

    // Remaining arguments (everything after the receiver)
    const restArgs = expr.args.slice(1).map(generateExpression).join(', ');

    return `${receiverStr}.${methodName}${typeArgsStr}(${restArgs})`;
  }

  // Default: module-qualified call syntax
  // Type arguments
  if (expr.typeArgs && expr.typeArgs.length > 0) {
    funcName += `<${expr.typeArgs.map(generateType).join(', ')}>`;
  }

  // Arguments
  const args = expr.args.map(generateExpression).join(', ');

  return `${funcName}(${args})`;
}

/**
 * Generate struct expression
 */
function generateStructExpression(expr: any): string {
  let name = expr.name;
  if (expr.module) {
    name = `${expr.module}::${name}`;
  }

  if (expr.typeArgs && expr.typeArgs.length > 0) {
    name += `<${expr.typeArgs.map(generateType).join(', ')}>`;
  }

  if (expr.fields.length === 0) {
    return `${name} {}`;
  }

  const fields = expr.fields
    .map((f: any) => `${f.name}: ${generateExpression(f.value)}`)
    .join(', ');

  return `${name} { ${fields} }`;
}

/**
 * Generate Move.toml file
 */
export function generateMoveToml(
  packageName: string,
  moduleAddress: string,
  options: { includeTokenObjects?: boolean; includeEvmCompat?: boolean } = {}
): string {
  const { includeTokenObjects = false, includeEvmCompat = true } = options;

  let dependencies = `AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-framework", rev = "main" }
AptosStdlib = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-stdlib", rev = "main" }
MoveStdlib = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/move-stdlib", rev = "main" }`;

  if (includeTokenObjects) {
    dependencies += `
AptosTokenObjects = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-token-objects", rev = "main" }`;
  }

  let addresses = `${packageName} = "${moduleAddress}"`;

  // Add transpiler address for evm_compat module
  if (includeEvmCompat) {
    addresses += `
transpiler = "0x42"`;
  }

  if (includeTokenObjects) {
    addresses += `
aptos_token_objects = "0x4"`;
  }

  return `[package]
name = "${packageName}"
version = "1.0.0"
authors = []

[addresses]
${addresses}

[dependencies]
${dependencies}

[dev-addresses]

[dev-dependencies]
`;
}
