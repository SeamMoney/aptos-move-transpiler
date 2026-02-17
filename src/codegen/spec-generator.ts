/**
 * Move Specification Language (MSL) Generator
 *
 * Extracts formal specifications from the Move AST and generates MSL spec
 * blocks. Translates Solidity require() conditions into aborts_if specs,
 * detects state access patterns for exists/modifies specs, and generates
 * struct invariants where applicable.
 *
 * Spec blocks use `pragma aborts_if_is_partial = true` because the transpiler
 * can only capture conditions it knows about — the Move runtime may abort for
 * additional reasons (e.g., arithmetic overflow, vector out-of-bounds).
 */

import type {
  MoveModule,
  MoveFunction,
  MoveStatement,
  MoveExpression,
  MoveSpecBlock,
  MoveSpecCondition,
  MoveStruct,
} from '../types/move-ast.js';

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Generate MSL spec blocks for a Move module.
 *
 * Walks the module's functions and structs, extracting:
 * - aborts_if conditions from assert!() calls
 * - aborts_if conditions from abort statements
 * - modifies declarations from borrow_global_mut calls
 * - aborts_if !exists<T>(addr) from borrow_global calls
 * - struct invariants for numeric bounds
 *
 * @returns Array of MoveSpecBlock (also sets module.specs)
 */
export function generateSpecs(module: MoveModule): MoveSpecBlock[] {
  const specs: MoveSpecBlock[] = [];

  // Module-level spec with partial pragma
  specs.push({
    target: 'module',
    targetKind: 'module',
    pragmas: [
      { name: 'aborts_if_is_partial', value: 'true' },
    ],
  });

  // Function specs
  for (const func of module.functions) {
    const spec = generateFunctionSpec(func, module);
    if (spec && hasContent(spec)) {
      specs.push(spec);
    }
  }

  // Struct specs (invariants)
  for (const struct of module.structs) {
    if (struct.isEvent) continue; // Skip event structs
    const spec = generateStructSpec(struct);
    if (spec && hasContent(spec)) {
      specs.push(spec);
    }
  }

  module.specs = specs;
  return specs;
}

/**
 * Render MSL spec blocks to Move source code.
 * Returns an array of lines to be appended inside the module body.
 */
export function renderSpecs(specs: MoveSpecBlock[], indent: number = 4): string[] {
  const lines: string[] = [];

  for (const spec of specs) {
    lines.push('');

    const pad = ' '.repeat(indent);
    const innerPad = ' '.repeat(indent + 4);

    if (spec.targetKind === 'module') {
      lines.push(`${pad}spec module {`);
    } else {
      lines.push(`${pad}spec ${spec.target} {`);
    }

    // Pragmas
    if (spec.pragmas) {
      for (const pragma of spec.pragmas) {
        if (pragma.value !== undefined) {
          lines.push(`${innerPad}pragma ${pragma.name} = ${pragma.value};`);
        } else {
          lines.push(`${innerPad}pragma ${pragma.name};`);
        }
      }
    }

    // Requires (pre-conditions)
    if (spec.requires && spec.requires.length > 0) {
      for (const req of spec.requires) {
        if (req.comment) lines.push(`${innerPad}// ${req.comment}`);
        lines.push(`${innerPad}requires ${req.expression};`);
      }
    }

    // Aborts_if conditions
    if (spec.abortsIf && spec.abortsIf.length > 0) {
      for (const abort of spec.abortsIf) {
        if (abort.comment) lines.push(`${innerPad}// ${abort.comment}`);
        if (abort.abortCode) {
          lines.push(`${innerPad}aborts_if ${abort.expression} with ${abort.abortCode};`);
        } else {
          lines.push(`${innerPad}aborts_if ${abort.expression};`);
        }
      }
    }

    // Modifies
    if (spec.modifies && spec.modifies.length > 0) {
      for (const mod of spec.modifies) {
        lines.push(`${innerPad}modifies ${mod};`);
      }
    }

    // Ensures (post-conditions)
    if (spec.ensures && spec.ensures.length > 0) {
      for (const ens of spec.ensures) {
        if (ens.comment) lines.push(`${innerPad}// ${ens.comment}`);
        lines.push(`${innerPad}ensures ${ens.expression};`);
      }
    }

    // Invariants
    if (spec.invariants && spec.invariants.length > 0) {
      for (const inv of spec.invariants) {
        if (inv.comment) lines.push(`${innerPad}// ${inv.comment}`);
        lines.push(`${innerPad}invariant ${inv.expression};`);
      }
    }

    lines.push(`${pad}}`);
  }

  return lines;
}

// ─── Function spec extraction ────────────────────────────────────────

function generateFunctionSpec(
  func: MoveFunction,
  module: MoveModule
): MoveSpecBlock | null {
  const spec: MoveSpecBlock = {
    target: func.name,
    targetKind: 'function',
    abortsIf: [],
    modifies: [],
    ensures: [],
  };

  const stateStructName = findStateStructName(module);

  // Walk the function body
  for (const stmt of func.body) {
    collectSpecsFromStatement(stmt, spec, module);
  }

  // Detect state access patterns from acquires
  if (func.acquires && func.acquires.length > 0) {
    for (const resource of func.acquires) {
      // If function acquires a resource, it might abort if resource doesn't exist
      spec.abortsIf!.push({
        expression: `!exists<${resource}>(@${module.address})`,
        comment: `${resource} must exist at module address`,
      });
    }
  }

  // Detect mutable state access → modifies
  if (func.acquires && func.acquires.length > 0) {
    const hasMutableAccess = bodyContainsMutableBorrow(func.body);
    if (hasMutableAccess) {
      for (const resource of func.acquires) {
        spec.modifies!.push(`global<${resource}>(@${module.address})`);
      }
    }
  }

  // Deduplicate
  spec.abortsIf = deduplicateConditions(spec.abortsIf!);
  spec.modifies = [...new Set(spec.modifies)];

  return spec;
}

// ─── Struct spec extraction ──────────────────────────────────────────

function generateStructSpec(struct: MoveStruct): MoveSpecBlock | null {
  const spec: MoveSpecBlock = {
    target: struct.name,
    targetKind: 'struct',
    invariants: [],
  };

  // Generate invariants for bounded numeric fields
  for (const field of struct.fields) {
    if (field.type.kind === 'primitive') {
      const name = field.type.name;
      // For small unsigned integers that were likely bounded in Solidity
      // (e.g., uint8 mapped to u8), add upper bound invariants
      if (name === 'u8') {
        spec.invariants!.push({
          expression: `${field.name} <= 255`,
          comment: `uint8 range`,
        });
      }
    }
  }

  return spec;
}

// ─── AST walking ─────────────────────────────────────────────────────

function collectSpecsFromStatement(
  stmt: MoveStatement,
  spec: MoveSpecBlock,
  module: MoveModule
): void {
  switch (stmt.kind) {
    case 'expression':
      collectSpecsFromExpression(stmt.expression, spec, module);
      break;

    case 'abort':
      // abort(code) → aborts_if true with code (generic, included for completeness)
      // We skip generic aborts since they're covered by other conditions
      break;

    case 'if':
      // Walk both branches
      for (const s of stmt.thenBlock) {
        collectSpecsFromStatement(s, spec, module);
      }
      if (stmt.elseBlock) {
        for (const s of stmt.elseBlock) {
          collectSpecsFromStatement(s, spec, module);
        }
      }
      break;

    case 'block':
      for (const s of stmt.statements) {
        collectSpecsFromStatement(s, spec, module);
      }
      break;

    case 'while':
    case 'loop':
    case 'for':
      for (const s of stmt.body) {
        collectSpecsFromStatement(s, spec, module);
      }
      break;
  }
}

function collectSpecsFromExpression(
  expr: MoveExpression,
  spec: MoveSpecBlock,
  module: MoveModule
): void {
  if (expr.kind !== 'call') return;

  // assert!(condition, ERROR_CODE) → aborts_if !condition with ERROR_CODE
  if (expr.function === 'assert!' && expr.args.length >= 2) {
    const condition = expr.args[0];
    const errorCode = expr.args[1];

    const negatedCondition = negateExpression(condition);
    const errorCodeStr = expressionToString(errorCode);

    spec.abortsIf!.push({
      expression: negatedCondition,
      abortCode: errorCodeStr,
      comment: `from require()/assert!`,
    });
  }
}

// ─── Expression → string conversion ─────────────────────────────────

/**
 * Convert a MoveExpression to a spec-compatible string.
 * This is a lightweight renderer for use in spec conditions.
 */
function expressionToString(expr: MoveExpression): string {
  switch (expr.kind) {
    case 'literal':
      if (expr.suffix) return `${expr.value}${expr.suffix}`;
      return String(expr.value);

    case 'identifier':
      return expr.name;

    case 'binary':
      return `${expressionToString(expr.left)} ${expr.operator} ${expressionToString(expr.right)}`;

    case 'unary':
      return `${expr.operator}${expressionToString(expr.operand)}`;

    case 'call': {
      const args = expr.args.map(a => expressionToString(a)).join(', ');
      const typeArgs = expr.typeArgs
        ? `<${expr.typeArgs.map(typeToString).join(', ')}>`
        : '';
      const modulePart = expr.module ? `${expr.module}::` : '';
      return `${modulePart}${expr.function}${typeArgs}(${args})`;
    }

    case 'method_call': {
      const receiver = expressionToString(expr.receiver);
      const args = expr.args.map(a => expressionToString(a)).join(', ');
      return `${receiver}.${expr.method}(${args})`;
    }

    case 'field_access':
      return `${expressionToString(expr.object)}.${expr.field}`;

    case 'index':
      return `${expressionToString(expr.object)}[${expressionToString(expr.index)}]`;

    case 'borrow':
      return `&${expr.mutable ? 'mut ' : ''}${expressionToString(expr.value)}`;

    case 'dereference':
      return `*${expressionToString(expr.value)}`;

    case 'cast':
      return `(${expressionToString(expr.value)} as ${typeToString(expr.targetType)})`;

    case 'struct': {
      const fields = expr.fields
        .map(f => `${f.name}: ${expressionToString(f.value)}`)
        .join(', ');
      return `${expr.name} { ${fields} }`;
    }

    case 'tuple': {
      const elems = expr.elements.map(e => expressionToString(e)).join(', ');
      return `(${elems})`;
    }

    default:
      return '/* unknown */';
  }
}

/**
 * Convert a MoveType to a string for spec blocks.
 */
function typeToString(type: import('../types/move-ast.js').MoveType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'vector':
      return `vector<${typeToString(type.elementType)}>`;
    case 'struct': {
      const args = type.typeArgs
        ? `<${type.typeArgs.map(typeToString).join(', ')}>`
        : '';
      return type.module ? `${type.module}::${type.name}${args}` : `${type.name}${args}`;
    }
    case 'reference':
      return `&${type.mutable ? 'mut ' : ''}${typeToString(type.innerType)}`;
    case 'generic':
      return type.name;
    default:
      return 'unknown';
  }
}

// ─── Expression negation ─────────────────────────────────────────────

/**
 * Negate a condition expression for aborts_if generation.
 * assert!(cond, err) → aborts_if !cond
 *
 * Applies simple logical inversions:
 *   a == b  →  a != b
 *   a != b  →  a == b
 *   a >= b  →  a < b
 *   a > b   →  a <= b
 *   a <= b  →  a > b
 *   a < b   →  a >= b
 *   !x      →  x
 *   a && b  →  !a || !b (simplified to just !(...))
 */
function negateExpression(expr: MoveExpression): string {
  if (expr.kind === 'binary') {
    // Direct comparison negation
    const negatedOp = negateOperator(expr.operator);
    if (negatedOp) {
      return `${expressionToString(expr.left)} ${negatedOp} ${expressionToString(expr.right)}`;
    }
    // For && and || operators, wrap in !()
    return `!(${expressionToString(expr)})`;
  }

  if (expr.kind === 'unary' && expr.operator === '!') {
    // Double negation: !!x → x
    return expressionToString(expr.operand);
  }

  // Default: wrap in !()
  return `!${expressionToString(expr)}`;
}

function negateOperator(
  op: string
): string | null {
  switch (op) {
    case '==': return '!=';
    case '!=': return '==';
    case '>=': return '<';
    case '>': return '<=';
    case '<=': return '>';
    case '<': return '>=';
    default: return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function findStateStructName(module: MoveModule): string | null {
  // The state struct typically has `key` ability and ends with "State"
  for (const s of module.structs) {
    if (s.abilities.includes('key') && !s.isEvent) {
      return s.name;
    }
  }
  return null;
}

function bodyContainsMutableBorrow(stmts: MoveStatement[]): boolean {
  for (const stmt of stmts) {
    if (stmtContainsMutableBorrow(stmt)) return true;
  }
  return false;
}

function stmtContainsMutableBorrow(stmt: MoveStatement): boolean {
  switch (stmt.kind) {
    case 'let':
      return stmt.value ? exprContainsMutableBorrow(stmt.value) : false;
    case 'expression':
      return exprContainsMutableBorrow(stmt.expression);
    case 'assign':
      return exprContainsMutableBorrow(stmt.target) || exprContainsMutableBorrow(stmt.value);
    case 'if':
      return bodyContainsMutableBorrow(stmt.thenBlock) ||
        (stmt.elseBlock ? bodyContainsMutableBorrow(stmt.elseBlock) : false);
    case 'while':
    case 'loop':
    case 'for':
      return bodyContainsMutableBorrow(stmt.body);
    case 'block':
      return bodyContainsMutableBorrow(stmt.statements);
    case 'return':
      return stmt.value ? exprContainsMutableBorrow(stmt.value) : false;
    default:
      return false;
  }
}

function exprContainsMutableBorrow(expr: MoveExpression): boolean {
  if (expr.kind === 'call' && expr.function === 'borrow_global_mut') return true;
  if (expr.kind === 'call') return expr.args.some(a => exprContainsMutableBorrow(a));
  if (expr.kind === 'method_call') {
    return exprContainsMutableBorrow(expr.receiver) ||
      expr.args.some(a => exprContainsMutableBorrow(a));
  }
  if (expr.kind === 'binary') {
    return exprContainsMutableBorrow(expr.left) || exprContainsMutableBorrow(expr.right);
  }
  if (expr.kind === 'unary') return exprContainsMutableBorrow(expr.operand);
  if (expr.kind === 'field_access') return exprContainsMutableBorrow(expr.object);
  if (expr.kind === 'borrow') return exprContainsMutableBorrow(expr.value);
  if (expr.kind === 'dereference') return exprContainsMutableBorrow(expr.value);
  return false;
}

function hasContent(spec: MoveSpecBlock): boolean {
  return (
    (spec.abortsIf && spec.abortsIf.length > 0) ||
    (spec.ensures && spec.ensures.length > 0) ||
    (spec.requires && spec.requires.length > 0) ||
    (spec.modifies && spec.modifies.length > 0) ||
    (spec.invariants && spec.invariants.length > 0) ||
    (spec.pragmas && spec.pragmas.length > 0)
  ) as boolean;
}

function deduplicateConditions(conditions: MoveSpecCondition[]): MoveSpecCondition[] {
  const seen = new Set<string>();
  return conditions.filter(c => {
    const key = `${c.expression}::${c.abortCode || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
