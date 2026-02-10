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

/**
 * Generate Move source code from a module AST
 */
export function generateMoveCode(module: MoveModule): string {
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

  // Body
  for (const stmt of func.body) {
    lines.push(generateStatement(stmt, indent + 4));
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
        return `${pad}${generateExpression(stmt.value)}`;
      }
      return `${pad}return`;

    case 'abort':
      return `${pad}abort ${generateExpression(stmt.code)}`;

    case 'expression':
      const exprStr = generateExpression(stmt.expression);
      // Skip empty expressions (e.g., from modifier placeholders)
      if (!exprStr || exprStr.trim() === '' || exprStr === '/* unsupported expression */') {
        return '';
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
      // Move doesn't have bitwise NOT (~), convert to XOR with max value
      if (expr.operator === '~') {
        return `(${generateExpression(expr.operand)} ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256)`;
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

    case 'field_access':
      return `${generateExpression(expr.object)}.${expr.field}`;

    case 'index':
      return `${generateExpression(expr.object)}[${generateExpression(expr.index)}]`;

    case 'struct':
      return generateStructExpression(expr);

    case 'borrow':
      const borrowPrefix = expr.mutable ? '&mut ' : '&';
      return borrowPrefix + generateExpression(expr.value);

    case 'dereference':
      return `*${generateExpression(expr.value)}`;

    case 'cast':
      // Move doesn't support casting to bool - use != 0 instead
      if (expr.targetType?.kind === 'primitive' && expr.targetType.name === 'bool') {
        return `(${generateExpression(expr.value)} != 0)`;
      }
      // Collapse chained casts: (x as T1) as T2 → (x as T2)
      if (expr.value?.kind === 'cast') {
        return `(${generateExpression(expr.value.value)} as ${generateType(expr.targetType)})`;
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
        return `if (${cond}) ${thenExpr} else ${generateExpression(expr.elseExpr)}`;
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
 * Generate call expression
 */
function generateCallExpression(expr: any): string {
  let funcName = expr.function;

  // Handle module-qualified functions
  if (expr.module) {
    funcName = `${expr.module}::${funcName}`;
  }

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
