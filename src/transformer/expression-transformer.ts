/**
 * Expression Transformer
 * Transforms Solidity expressions and statements to Move
 */

import type { MoveStatement, MoveExpression, MoveType } from '../types/move-ast.js';
import type { IRStatement, IRExpression, TranspileContext } from '../types/ir.js';
import { MoveTypes } from '../types/move-ast.js';
import { createIRType } from '../mapper/type-mapper.js';

/**
 * Transform a Solidity statement AST node to IR
 * Uses 'any' type because the parser's AST types vary
 */
export function solidityStatementToIR(stmt: any): IRStatement {
  switch (stmt.type) {
    case 'VariableDeclarationStatement':
      const vars = stmt.variables || [];
      return {
        kind: 'variable_declaration',
        name: vars.map((v: any, i: number) => v?.name ? v.name : `_${i}`),
        type: vars[0]?.typeName ? createIRType(vars[0].typeName) : undefined,
        initialValue: stmt.initialValue ? solidityExpressionToIR(stmt.initialValue) : undefined,
      };

    case 'ExpressionStatement':
      // Check if this is a modifier placeholder (_)
      const exprNode = stmt.expression;
      if (exprNode?.type === 'Identifier' && exprNode.name === '_') {
        return { kind: 'placeholder' };
      }
      // Check if this is an assignment expression (a = b or a += b, etc.)
      if (exprNode?.type === 'BinaryOperation' && isAssignmentOperator(exprNode.operator)) {
        return {
          kind: 'assignment',
          target: solidityExpressionToIR(exprNode.left),
          operator: exprNode.operator,
          value: solidityExpressionToIR(exprNode.right),
        };
      }
      return {
        kind: 'expression',
        expression: solidityExpressionToIR(stmt.expression),
      };

    case 'IfStatement':
      return {
        kind: 'if',
        condition: solidityExpressionToIR(stmt.condition),
        thenBlock: [solidityStatementToIR(stmt.trueBody)],
        elseBlock: stmt.falseBody ? [solidityStatementToIR(stmt.falseBody)] : undefined,
      };

    case 'ForStatement':
      return {
        kind: 'for',
        init: stmt.initExpression ? solidityStatementToIR(stmt.initExpression) : undefined,
        condition: stmt.conditionExpression ? solidityExpressionToIR(stmt.conditionExpression) : undefined,
        update: stmt.loopExpression?.expression ? solidityExpressionToIR(stmt.loopExpression.expression) : undefined,
        body: [solidityStatementToIR(stmt.body)],
      };

    case 'WhileStatement':
      return {
        kind: 'while',
        condition: solidityExpressionToIR(stmt.condition),
        body: [solidityStatementToIR(stmt.body)],
      };

    case 'DoWhileStatement':
      return {
        kind: 'do_while',
        condition: solidityExpressionToIR(stmt.condition),
        body: [solidityStatementToIR(stmt.body)],
      };

    case 'ReturnStatement':
      return {
        kind: 'return',
        value: stmt.expression ? solidityExpressionToIR(stmt.expression) : undefined,
      };

    case 'EmitStatement':
      const eventCall = stmt.eventCall;
      return {
        kind: 'emit',
        event: eventCall?.expression?.name || eventCall?.name || 'Unknown',
        args: (eventCall?.arguments || []).map(solidityExpressionToIR),
      };

    case 'RevertStatement':
      return {
        kind: 'revert',
        error: stmt.revertCall?.expression?.name,
        args: (stmt.revertCall?.arguments || []).map(solidityExpressionToIR),
      };

    case 'Block':
      return {
        kind: 'block',
        statements: (stmt.statements || []).map(solidityStatementToIR),
      };

    case 'BreakStatement':
      return { kind: 'break' };

    case 'ContinueStatement':
      return { kind: 'continue' };

    case 'UncheckedStatement':
      return {
        kind: 'unchecked',
        statements: (stmt.block?.statements || []).map(solidityStatementToIR),
      };

    case 'PlaceholderStatement':
      // The _ placeholder in modifiers - indicates where function body is inserted
      return { kind: 'placeholder' };

    case 'InlineAssemblyStatement':
      // Attempt to transpile Yul assembly to Move IR
      // Common patterns: bit manipulation (shl, shr, and, or, not), arithmetic
      if (stmt.body?.operations) {
        const assemblyStatements = transpileAssemblyBlock(stmt.body.operations);
        if (assemblyStatements.length > 0) {
          return { kind: 'block', statements: assemblyStatements };
        }
      }
      // Fallback for unsupported assembly patterns
      return {
        kind: 'expression',
        expression: {
          kind: 'literal',
          type: 'string',
          value: 'UNSUPPORTED: inline assembly (Yul) - complex pattern not yet supported',
        },
      };

    case 'TryStatement':
      // Basic try/catch support - extract the expression and body
      return {
        kind: 'try',
        expression: stmt.expression ? solidityExpressionToIR(stmt.expression) : { kind: 'literal', type: 'number', value: 0 },
        body: (stmt.body?.statements || []).map(solidityStatementToIR),
        catchClauses: (stmt.catchClauses || []).map((c: any) => ({
          errorName: c.kind,
          params: (c.parameters || []).map((p: any) => ({
            name: p.name || '',
            type: p.typeName ? createIRType(p.typeName) : { solidity: 'bytes', move: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } }, isArray: false, isMapping: false },
          })),
          body: (c.body?.statements || []).map(solidityStatementToIR),
        })),
      };

    default:
      // Fallback for unsupported statements
      return {
        kind: 'expression',
        expression: { kind: 'literal', type: 'number', value: 0 },
      };
  }
}

/**
 * Transform a Solidity expression AST node to IR
 */
export function solidityExpressionToIR(expr: any): IRExpression {
  if (!expr) {
    return { kind: 'literal', type: 'number', value: 0 };
  }

  switch (expr.type) {
    case 'NumberLiteral':
      return {
        kind: 'literal',
        type: 'number',
        value: expr.number,
        subdenomination: expr.subdenomination || undefined,
      };

    case 'BooleanLiteral':
      return {
        kind: 'literal',
        type: 'bool',
        value: expr.value,
      };

    case 'StringLiteral':
      return {
        kind: 'literal',
        type: 'string',
        value: expr.value,
      };

    case 'HexLiteral':
      return {
        kind: 'literal',
        type: 'hex',
        value: expr.value,
      };

    case 'Identifier':
      // Check for special identifiers
      if (expr.name === 'msg') {
        return { kind: 'identifier', name: 'msg' };
      }
      if (expr.name === 'block') {
        return { kind: 'identifier', name: 'block' };
      }
      if (expr.name === 'tx') {
        return { kind: 'identifier', name: 'tx' };
      }
      return {
        kind: 'identifier',
        name: expr.name,
      };

    case 'BinaryOperation':
      return {
        kind: 'binary',
        operator: expr.operator,
        left: solidityExpressionToIR(expr.left),
        right: solidityExpressionToIR(expr.right),
      };

    case 'UnaryOperation':
      return {
        kind: 'unary',
        operator: expr.operator,
        operand: solidityExpressionToIR(expr.subExpression),
        prefix: expr.isPrefix,
      };

    case 'FunctionCall':
      const funcExpr = expr.expression;

      // Handle require/assert
      if (funcExpr?.name === 'require') {
        return {
          kind: 'function_call',
          function: { kind: 'identifier', name: 'require' },
          args: (expr.arguments || []).map(solidityExpressionToIR),
        };
      }

      if (funcExpr?.name === 'assert') {
        return {
          kind: 'function_call',
          function: { kind: 'identifier', name: 'assert' },
          args: (expr.arguments || []).map(solidityExpressionToIR),
        };
      }

      // Handle type conversions
      if (funcExpr?.type === 'ElementaryTypeName') {
        return {
          kind: 'type_conversion',
          targetType: createIRType(funcExpr),
          expression: solidityExpressionToIR(expr.arguments[0]),
        };
      }

      // Handle type casts where the type name is an Identifier (e.g., address(0), uint256(x))
      if (funcExpr?.type === 'Identifier' && isTypecastIdentifier(funcExpr.name)) {
        return {
          kind: 'type_conversion',
          targetType: {
            solidity: funcExpr.name,
            move: mapIdentifierToMoveType(funcExpr.name),
          } as any,
          expression: solidityExpressionToIR(expr.arguments[0]),
        };
      }

      return {
        kind: 'function_call',
        function: solidityExpressionToIR(expr.expression),
        args: (expr.arguments || []).map(solidityExpressionToIR),
        names: expr.names?.length ? expr.names : undefined,
      };

    case 'MemberAccess':
      const baseExpr = solidityExpressionToIR(expr.expression);

      // Handle msg.sender, msg.value, etc.
      if (baseExpr.kind === 'identifier' && baseExpr.name === 'msg') {
        return {
          kind: 'msg_access',
          property: expr.memberName,
        };
      }

      // Handle block.timestamp, block.number, etc.
      if (baseExpr.kind === 'identifier' && baseExpr.name === 'block') {
        return {
          kind: 'block_access',
          property: expr.memberName,
        };
      }

      // Handle tx.origin, tx.gasprice
      if (baseExpr.kind === 'identifier' && baseExpr.name === 'tx') {
        return {
          kind: 'tx_access',
          property: expr.memberName,
        };
      }

      // Handle type(T).max, type(T).min patterns
      if (expr.expression?.type === 'FunctionCall' &&
          expr.expression?.expression?.name === 'type') {
        const typeArg = expr.expression.arguments?.[0];
        const typeName = typeArg?.name || typeArg?.type || 'uint256';
        return {
          kind: 'type_member',
          typeName,
          member: expr.memberName,
        } as any;
      }

      return {
        kind: 'member_access',
        object: baseExpr,
        member: expr.memberName,
      };

    case 'IndexAccess':
      return {
        kind: 'index_access',
        base: solidityExpressionToIR(expr.base),
        index: solidityExpressionToIR(expr.index),
      };

    case 'Conditional':
      return {
        kind: 'conditional',
        condition: solidityExpressionToIR(expr.condition),
        trueExpression: solidityExpressionToIR(expr.trueExpression),
        falseExpression: solidityExpressionToIR(expr.falseExpression),
      };

    case 'TupleExpression':
      return {
        kind: 'tuple',
        elements: (expr.components || []).map((c: any) => c ? solidityExpressionToIR(c) : null),
      };

    case 'NewExpression':
      return {
        kind: 'new',
        typeName: expr.typeName?.name || expr.typeName?.namePath || 'unknown',
      };

    default:
      return {
        kind: 'literal',
        type: 'number',
        value: 0,
      };
  }
}

/**
 * Transform IR statement to Move statement
 */
export function transformStatement(
  stmt: IRStatement,
  context: TranspileContext
): MoveStatement | undefined {
  switch (stmt.kind) {
    case 'variable_declaration':
      return transformVariableDeclaration(stmt, context);

    case 'assignment':
      return transformAssignment(stmt, context);

    case 'if':
      return transformIf(stmt, context);

    case 'for':
      return transformFor(stmt, context);

    case 'while':
      return transformWhile(stmt, context);

    case 'do_while':
      return transformDoWhile(stmt, context);

    case 'return':
      return transformReturn(stmt, context);

    case 'emit':
      return transformEmit(stmt, context);

    case 'require':
      return transformRequire(stmt, context);

    case 'revert':
      return transformRevert(stmt, context);

    case 'expression':
      return transformExpressionStatement(stmt, context);

    case 'block':
      return {
        kind: 'block',
        statements: stmt.statements
          .map(s => transformStatement(s, context))
          .filter((s): s is MoveStatement => s !== undefined),
      };

    case 'break':
      return { kind: 'expression', expression: { kind: 'break' } };

    case 'continue':
      return { kind: 'expression', expression: { kind: 'continue' } };

    case 'unchecked':
      // Move doesn't have unchecked blocks - operations are unchecked by default
      // We return undefined here and handle flattening at a higher level
      // For now, just transform to a block (will be handled by if-statement flattening)
      return {
        kind: 'block',
        statements: stmt.statements
          .map(s => transformStatement(s, context))
          .filter((s): s is MoveStatement => s !== undefined),
      };

    default:
      context.warnings.push({
        message: `Unsupported statement type: ${(stmt as any).kind}`,
        severity: 'warning',
      });
      return undefined;
  }
}

/**
 * Transform variable declaration
 */
function transformVariableDeclaration(
  stmt: any,
  context: TranspileContext
): MoveStatement {
  const names = Array.isArray(stmt.name) ? stmt.name : [stmt.name];
  const pattern = names.length === 1 ? toSnakeCase(names[0]) : names.map(toSnakeCase);

  return {
    kind: 'let',
    pattern,
    type: stmt.type?.move,
    value: stmt.initialValue ? transformExpression(stmt.initialValue, context) : undefined,
  };
}

/**
 * Transform assignment
 */
function transformAssignment(
  stmt: any,
  context: TranspileContext
): MoveStatement {
  // Check if the target is an index access (mapping/array) - use mutable borrow
  let target: any;
  if (stmt.target?.kind === 'index_access') {
    target = transformIndexAccessMutable(stmt.target, context);
  } else if (stmt.target?.kind === 'member_access') {
    // Handle state.field assignments
    target = transformExpression(stmt.target, context);
  } else {
    target = transformExpression(stmt.target, context);
  }

  let value = transformExpression(stmt.value, context);

  // Handle compound assignment
  if (stmt.operator && stmt.operator !== '=') {
    // For shift compound assignments, right operand must be u8 in Move
    if (stmt.operator === '<<=' || stmt.operator === '>>=') {
      value = castToU8ForShift(value);
    }
    return {
      kind: 'assign',
      target,
      operator: stmt.operator as any,
      value,
    };
  }

  return {
    kind: 'assign',
    target,
    value,
  };
}

/**
 * Transform if statement
 */
function transformIf(stmt: any, context: TranspileContext): MoveStatement {
  // Detect assignment-in-condition pattern: if ((y = expr) != x)
  // Split into: y = expr; if (y != x) { ... }
  const extracted = extractAssignmentFromCondition(stmt.condition, context);
  if (extracted) {
    return {
      kind: 'block',
      statements: [
        ...extracted.preStatements,
        {
          kind: 'if',
          condition: extracted.condition,
          thenBlock: stmt.thenBlock
            .map((s: any) => transformStatement(s, context))
            .filter((s: any): s is MoveStatement => s !== undefined),
          elseBlock: stmt.elseBlock
            ? stmt.elseBlock
                .map((s: any) => transformStatement(s, context))
                .filter((s: any): s is MoveStatement => s !== undefined)
            : undefined,
        },
      ],
    };
  }

  return {
    kind: 'if',
    condition: transformExpression(stmt.condition, context),
    thenBlock: stmt.thenBlock
      .map((s: any) => transformStatement(s, context))
      .filter((s: any): s is MoveStatement => s !== undefined),
    elseBlock: stmt.elseBlock
      ? stmt.elseBlock
          .map((s: any) => transformStatement(s, context))
          .filter((s: any): s is MoveStatement => s !== undefined)
      : undefined,
  };
}

/**
 * Extract assignment expressions from if conditions.
 * Solidity allows `if ((y = expr) != x)` — Move does not.
 * Returns pre-statements and a cleaned condition, or null if no assignment found.
 */
function extractAssignmentFromCondition(condition: any, context: TranspileContext): { preStatements: MoveStatement[]; condition: MoveExpression } | null {
  if (!condition || condition.kind !== 'binary') return null;

  // Unwrap single-element tuple/parenthesized expressions on left side
  let left = condition.left;
  if (left?.kind === 'tuple' && left.elements?.length === 1) {
    left = left.elements[0];
  }

  // Check left side for assignment: (y = expr) != x  or  (y = expr) == x
  if (left?.kind === 'assignment' || (left?.kind === 'binary' && left.operator === '=')) {
    const assign = left;
    const target = transformExpression(assign.target || assign.left, context);
    const value = transformExpression(assign.value || assign.right, context);
    const preStmt: MoveStatement = { kind: 'assign', target, value };

    // The condition becomes: target != right (or whatever the comparison operator is)
    const newCondition: MoveExpression = {
      kind: 'binary',
      operator: condition.operator,
      left: target,
      right: transformExpression(condition.right, context),
    };

    return { preStatements: [preStmt], condition: newCondition };
  }

  // Unwrap single-element tuple on right side too
  let right = condition.right;
  if (right?.kind === 'tuple' && right.elements?.length === 1) {
    right = right.elements[0];
  }

  if (right?.kind === 'assignment' || (right?.kind === 'binary' && right.operator === '=')) {
    const assign = right;
    const target = transformExpression(assign.target || assign.left, context);
    const value = transformExpression(assign.value || assign.right, context);
    const preStmt: MoveStatement = { kind: 'assign', target, value };

    const newCondition: MoveExpression = {
      kind: 'binary',
      operator: condition.operator,
      left: transformExpression(condition.left, context),
      right: target,
    };

    return { preStatements: [preStmt], condition: newCondition };
  }

  return null;
}

/**
 * Transform an increment/decrement expression (i++, ++i, i--, --i) into an assignment statement.
 * Returns undefined if the expression is not an increment/decrement.
 */
function transformIncrementDecrementToAssignment(
  expr: any,
  context: TranspileContext
): MoveStatement | undefined {
  if (expr.kind !== 'unary') return undefined;
  if (expr.operator !== '++' && expr.operator !== '--') return undefined;

  const operand = transformExpression(expr.operand, context);
  const op = expr.operator === '++' ? '+' : '-';

  return {
    kind: 'assign',
    target: operand,
    value: {
      kind: 'binary',
      operator: op as any,
      left: operand,
      right: { kind: 'literal', type: 'number', value: 1 },
    },
  };
}

/**
 * Transform for loop
 * Detects range-based loops and uses Move 2.0 native for loops when possible
 */
function transformFor(stmt: any, context: TranspileContext): MoveStatement {
  // Try to detect simple range-based for loops: for (uint i = 0; i < n; i++)
  const rangeLoop = detectRangeLoop(stmt);

  if (rangeLoop) {
    // Use Move 2.0 native for loop: for (i in start..end)
    const body: MoveStatement[] = stmt.body
      .map((s: any) => transformStatement(s, context))
      .filter((s: any): s is MoveStatement => s !== undefined);

    return {
      kind: 'for',
      iterator: rangeLoop.iterator,
      iterable: {
        kind: 'call',
        function: 'range',
        args: [
          rangeLoop.start,
          rangeLoop.end,
        ],
      },
      body,
    } as MoveStatement;
  }

  // Fallback: Convert to a while loop for complex for loops
  const statements: MoveStatement[] = [];

  // Init
  if (stmt.init) {
    const initStmt = transformStatement(stmt.init, context);
    if (initStmt) statements.push(initStmt);
  }

  // While loop body
  const body: MoveStatement[] = stmt.body
    .map((s: any) => transformStatement(s, context))
    .filter((s: any): s is MoveStatement => s !== undefined);

  // Add update at end of body
  if (stmt.update) {
    const updateStmt = transformIncrementDecrementToAssignment(stmt.update, context);
    if (updateStmt) {
      body.push(updateStmt);
    } else {
      body.push({
        kind: 'expression',
        expression: transformExpression(stmt.update, context),
      });
    }
  }

  statements.push({
    kind: 'while',
    condition: stmt.condition
      ? transformExpression(stmt.condition, context)
      : { kind: 'literal', type: 'bool', value: true },
    body,
  });

  return {
    kind: 'block',
    statements,
  };
}

/**
 * Detect if a for loop is a simple range-based loop
 * Pattern: for (uint i = start; i < end; i++) or for (uint i = start; i < end; i += 1)
 */
function detectRangeLoop(stmt: any): { iterator: string; start: any; end: any } | null {
  // Check init: must be a variable declaration with initial value
  if (!stmt.init || stmt.init.kind !== 'variable_declaration') {
    return null;
  }

  const iteratorName = typeof stmt.init.name === 'string' ? stmt.init.name : null;
  if (!iteratorName) {
    return null;
  }

  // Check condition: must be i < end or i <= end
  if (!stmt.condition || stmt.condition.kind !== 'binary') {
    return null;
  }

  const condOp = stmt.condition.operator;
  if (condOp !== '<' && condOp !== '<=') {
    return null;
  }

  // Check that left side of condition is the iterator
  if (stmt.condition.left?.kind !== 'identifier' || stmt.condition.left.name !== iteratorName) {
    return null;
  }

  // Check update: must be i++ or i += 1
  if (!stmt.update) {
    return null;
  }

  const isValidUpdate = (
    // i++ or ++i
    (stmt.update.kind === 'unary' &&
     (stmt.update.operator === '++') &&
     stmt.update.operand?.kind === 'identifier' &&
     stmt.update.operand.name === iteratorName) ||
    // i += 1
    (stmt.update.kind === 'assignment' &&
     stmt.update.operator === '+=' &&
     stmt.update.target?.kind === 'identifier' &&
     stmt.update.target.name === iteratorName &&
     stmt.update.value?.kind === 'literal' &&
     stmt.update.value.value === 1)
  );

  if (!isValidUpdate) {
    return null;
  }

  // Build the start and end values
  const start = stmt.init.initialValue
    ? transformExpression(stmt.init.initialValue, {} as TranspileContext)
    : { kind: 'literal', type: 'number', value: 0 };

  let end = transformExpression(stmt.condition.right, {} as TranspileContext);

  // For <= operator, we need to add 1 to the end
  if (condOp === '<=') {
    end = {
      kind: 'binary',
      operator: '+',
      left: end,
      right: { kind: 'literal', type: 'number', value: 1 },
    };
  }

  return {
    iterator: toSnakeCase(iteratorName),
    start,
    end,
  };
}

/**
 * Transform while loop
 */
function transformWhile(stmt: any, context: TranspileContext): MoveStatement {
  return {
    kind: 'while',
    condition: transformExpression(stmt.condition, context),
    body: stmt.body
      .map((s: any) => transformStatement(s, context))
      .filter((s: any): s is MoveStatement => s !== undefined),
  };
}

/**
 * Transform do-while loop
 */
function transformDoWhile(stmt: any, context: TranspileContext): MoveStatement {
  // Move doesn't have do-while, convert to loop with break
  const body: MoveStatement[] = stmt.body
    .map((s: any) => transformStatement(s, context))
    .filter((s: any): s is MoveStatement => s !== undefined);

  // Add condition check at end
  body.push({
    kind: 'if',
    condition: {
      kind: 'unary',
      operator: '!',
      operand: transformExpression(stmt.condition, context),
    },
    thenBlock: [{ kind: 'expression', expression: { kind: 'break' } }],
  });

  return {
    kind: 'loop',
    body,
  };
}

/**
 * Transform return statement
 */
function transformReturn(stmt: any, context: TranspileContext): MoveStatement {
  return {
    kind: 'return',
    value: stmt.value ? transformExpression(stmt.value, context) : undefined,
  };
}

/**
 * Transform emit statement
 */
function transformEmit(stmt: any, context: TranspileContext): MoveStatement {
  context.usedModules.add('aptos_framework::event');

  // Look up event definition to get field names
  const eventDef = context.events.get(stmt.event);
  const fields = stmt.args.map((arg: any, i: number) => {
    // Use actual field name if available, otherwise use generic name
    const fieldName = eventDef?.params[i]?.name || `arg${i}`;
    return {
      name: toSnakeCase(fieldName),
      value: transformExpression(arg, context),
    };
  });

  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'event::emit',
      args: [
        {
          kind: 'struct',
          name: stmt.event,
          fields,
        },
      ],
    },
  };
}

/**
 * Transform require statement
 */
function transformRequire(stmt: any, context: TranspileContext): MoveStatement {
  // require(condition, message) -> assert!(condition, ERROR_CODE)
  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'assert!',
      args: [
        transformExpression(stmt.condition, context),
        { kind: 'identifier', name: 'E_INVALID_ARGUMENT' },
      ],
    },
  };
}

/**
 * Transform revert statement
 */
function transformRevert(stmt: any, context: TranspileContext): MoveStatement {
  const errorName = stmt.error ? `E_${toScreamingSnakeCase(stmt.error)}` : 'E_INVALID_ARGUMENT';

  return {
    kind: 'abort',
    code: { kind: 'identifier', name: errorName },
  };
}

/**
 * Transform expression statement
 * Enhanced with better require/assert/revert handling
 */
function transformExpressionStatement(
  stmt: any,
  context: TranspileContext
): MoveStatement {
  const expr = stmt.expression;

  // Handle require/assert function calls
  if (expr.kind === 'function_call') {
    const funcName = expr.function?.kind === 'identifier' ? expr.function.name : null;

    if (funcName === 'require') {
      const errorCode = extractErrorCode(expr.args[1], context);
      return {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'assert!',
          args: [
            transformExpression(expr.args[0], context),
            errorCode,
          ],
        },
      };
    }

    if (funcName === 'assert') {
      return {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'assert!',
          args: [
            transformExpression(expr.args[0], context),
            { kind: 'identifier', name: 'E_ASSERT_FAILED' },
          ],
        },
      };
    }

    // Handle revert() and revert(message)
    if (funcName === 'revert') {
      if (expr.args && expr.args.length > 0) {
        const errorCode = extractErrorCode(expr.args[0], context);
        return {
          kind: 'abort',
          code: errorCode,
        };
      }
      return {
        kind: 'abort',
        code: { kind: 'identifier', name: 'E_REVERT' },
      };
    }
  }

  // Handle standalone increment/decrement (i++, i--, ++i, --i)
  if (expr.kind === 'unary' && (expr.operator === '++' || expr.operator === '--')) {
    const assignStmt = transformIncrementDecrementToAssignment(expr, context);
    if (assignStmt) return assignStmt;
  }

  return {
    kind: 'expression',
    expression: transformExpression(expr, context),
  };
}

/**
 * Extract error code from require/revert message
 * Tries to convert string messages to meaningful error constants
 */
function extractErrorCode(errorArg: any, context: TranspileContext): MoveExpression {
  if (!errorArg) {
    return { kind: 'identifier', name: 'E_REQUIRE_FAILED' };
  }

  // If it's a string literal, try to extract a meaningful error code
  if (errorArg.kind === 'literal' && errorArg.type === 'string') {
    const message = String(errorArg.value).toLowerCase();

    // Map common error messages to error codes
    const errorMappings: [RegExp, string][] = [
      [/insufficient.*balance|not enough/i, 'E_INSUFFICIENT_BALANCE'],
      [/unauthorized|not.*owner|only.*owner|access.*denied/i, 'E_UNAUTHORIZED'],
      [/invalid.*address|zero.*address/i, 'E_INVALID_ADDRESS'],
      [/overflow/i, 'E_OVERFLOW'],
      [/underflow/i, 'E_UNDERFLOW'],
      [/division.*zero|divide.*zero/i, 'E_DIVISION_BY_ZERO'],
      [/already.*exists|duplicate/i, 'E_ALREADY_EXISTS'],
      [/not.*found|does.*not.*exist/i, 'E_NOT_FOUND'],
      [/paused|not.*active/i, 'E_PAUSED'],
      [/expired|deadline/i, 'E_EXPIRED'],
      [/reentrancy|reentrant/i, 'E_REENTRANCY'],
      [/locked|not.*unlocked/i, 'E_LOCKED'],
      [/invalid.*amount|amount/i, 'E_INVALID_AMOUNT'],
      [/invalid.*argument|invalid.*param/i, 'E_INVALID_ARGUMENT'],
      [/transfer.*failed/i, 'E_TRANSFER_FAILED'],
      [/approve|allowance/i, 'E_INSUFFICIENT_ALLOWANCE'],
    ];

    for (const [pattern, errorCode] of errorMappings) {
      if (pattern.test(message)) {
        // Register the error code constant
        context.errorCodes = context.errorCodes || new Map();
        if (!context.errorCodes.has(errorCode)) {
          context.errorCodes.set(errorCode, { message: errorArg.value, code: context.errorCodes.size + 1 });
        }
        return { kind: 'identifier', name: errorCode };
      }
    }

    // Default: generate a constant from the message
    const constantName = 'E_' + toScreamingSnakeCase(
      message.replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0, 30)
    );
    context.errorCodes = context.errorCodes || new Map();
    if (!context.errorCodes.has(constantName)) {
      context.errorCodes.set(constantName, { message: errorArg.value, code: context.errorCodes.size + 1 });
    }
    return { kind: 'identifier', name: constantName };
  }

  // If it's a custom error, convert to error code
  if (errorArg.kind === 'function_call') {
    const errorName = errorArg.function?.name || 'CustomError';
    const constantName = 'E_' + toScreamingSnakeCase(errorName);
    return { kind: 'identifier', name: constantName };
  }

  return { kind: 'identifier', name: 'E_REQUIRE_FAILED' };
}

/**
 * Transform IR expression to Move expression
 */
export function transformExpression(
  expr: IRExpression,
  context: TranspileContext
): MoveExpression {
  switch (expr.kind) {
    case 'literal':
      return transformLiteral(expr, context);

    case 'identifier':
      return transformIdentifier(expr, context);

    case 'binary':
      return transformBinary(expr, context);

    case 'unary':
      return transformUnary(expr, context);

    case 'function_call':
      return transformFunctionCall(expr, context);

    case 'member_access':
      return transformMemberAccess(expr, context);

    case 'index_access':
      return transformIndexAccess(expr, context);

    case 'conditional':
      return transformConditional(expr, context);

    case 'tuple':
      return transformTuple(expr, context);

    case 'type_conversion':
      return transformTypeConversion(expr, context);

    case 'msg_access':
      return transformMsgAccess(expr, context);

    case 'block_access':
      return transformBlockAccess(expr, context);

    case 'tx_access':
      return transformTxAccess(expr, context);

    case 'type_member':
      return transformTypeMember(expr, context);

    default:
      return { kind: 'literal', type: 'number', value: 0 };
  }
}

/**
 * Transform literal
 */
function transformLiteral(expr: any, context: TranspileContext): MoveExpression {
  switch (expr.type) {
    case 'number':
      // Handle subdenominations (ether, wei, etc.)
      let value = expr.value;
      if (expr.subdenomination) {
        const multipliers: Record<string, bigint> = {
          wei: 1n,
          gwei: 1_000_000_000n,
          ether: 1_000_000_000_000_000_000n,
        };
        const mult = multipliers[expr.subdenomination] || 1n;
        value = (BigInt(value) * mult).toString();
      }
      // Move infers literal types from context (variable type annotation, comparison operand, etc.)
      // Only add explicit suffix for values that exceed u64 range (need disambiguation)
      // or hex literals (which are common in bitwise contexts and need u256)
      const suffix = needsExplicitSuffix(String(value)) ? 'u256' : undefined;
      return {
        kind: 'literal',
        type: 'number',
        value,
        suffix,
      };

    case 'bool':
      return {
        kind: 'literal',
        type: 'bool',
        value: expr.value,
      };

    case 'string':
      context.usedModules.add('std::string');
      return {
        kind: 'call',
        function: 'string::utf8',
        args: [{
          kind: 'literal',
          type: 'bytestring',
          value: `b"${expr.value}"`,
        }],
      };

    case 'hex':
      return {
        kind: 'literal',
        type: 'bytestring',
        value: `x"${String(expr.value).replace('0x', '')}"`,
      };

    case 'address':
      return {
        kind: 'literal',
        type: 'address',
        value: `@${expr.value}`,
      };

    default:
      return { kind: 'literal', type: 'number', value: 0 };
  }
}

/**
 * Check if a numeric literal value needs an explicit type suffix.
 * Move infers literal types from context, but values > u64::MAX need u256 suffix
 * to avoid defaulting to u64 (which would overflow).
 * Hex literals also get suffix since they're common in bitwise contexts.
 */
function needsExplicitSuffix(value: string): boolean {
  // Hex literals always need suffix (commonly used in bit masks)
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return true;
  }
  // Scientific notation — will be expanded later, check the expanded value
  if (/[eE]/.test(value)) {
    try {
      const sciMatch = value.match(/^(\d+(?:\.\d+)?)[eE]\+?(\d+)$/);
      if (sciMatch) {
        const mantissa = sciMatch[1];
        const exponent = parseInt(sciMatch[2], 10);
        let expanded: string;
        if (mantissa.includes('.')) {
          const [intPart, decPart] = mantissa.split('.');
          expanded = intPart + decPart + '0'.repeat(Math.max(0, exponent - decPart.length));
        } else {
          expanded = mantissa + '0'.repeat(exponent);
        }
        return BigInt(expanded.replace(/^0+/, '') || '0') > 18446744073709551615n;
      }
    } catch { return true; }
  }
  // Decimal literals — check if they exceed u64 max
  try {
    return BigInt(value) > 18446744073709551615n;
  } catch {
    return true; // Can't parse, play it safe
  }
}

/**
 * Transform identifier
 */
function transformIdentifier(expr: any, context: TranspileContext): MoveExpression {
  const name = toSnakeCase(expr.name);

  // Handle 'this' - refers to the current contract address
  if (expr.name === 'this') {
    return {
      kind: 'literal',
      type: 'address',
      value: `@${context.moduleAddress}`,
    };
  }

  // Check if it's a constant - constants are accessed directly by their SCREAMING_SNAKE_CASE name
  if (context.constants?.has(expr.name)) {
    return {
      kind: 'identifier',
      name: toScreamingSnakeCase(expr.name),
    };
  }

  // Check if it's a state variable (but not a constant)
  const stateVar = context.stateVariables.get(expr.name);
  if (stateVar && stateVar.mutability !== 'constant') {
    return {
      kind: 'field_access',
      object: { kind: 'identifier', name: 'state' },
      field: name,
    };
  }

  return {
    kind: 'identifier',
    name,
  };
}

/**
 * Transform binary operation
 * Based on e2m's BinaryOp::calc patterns from reverse engineering
 */
function transformBinary(expr: any, context: TranspileContext): MoveExpression {
  const left = transformExpression(expr.left, context);
  const right = transformExpression(expr.right, context);

  // Map operators
  const opMap: Record<string, string> = {
    '**': '*', // Exponentiation needs special handling
    '&&': '&&',
    '||': '||',
  };

  const op = opMap[expr.operator] || expr.operator;

  // Handle exponentiation specially - use math::pow
  if (expr.operator === '**') {
    context.usedModules.add('aptos_std::math128');
    return {
      kind: 'call',
      function: 'math128::pow',
      args: [left, right],
    };
  }

  // Shift operators: right operand must be u8 in Move
  // Also handles compound shift assignments (>>=, <<=) when they appear as binary expressions
  if (expr.operator === '<<' || expr.operator === '>>' || expr.operator === '<<=' || expr.operator === '>>=') {
    const castRight = castToU8ForShift(right);
    return {
      kind: 'binary',
      operator: op as any,
      left,
      right: castRight,
    };
  }

  return {
    kind: 'binary',
    operator: op as any,
    left,
    right,
  };
}

/**
 * Transform unary operation
 */
function transformUnary(expr: any, context: TranspileContext): MoveExpression {
  const operand = transformExpression(expr.operand, context);

  // Handle increment/decrement
  if (expr.operator === '++') {
    return {
      kind: 'binary',
      operator: '+',
      left: operand,
      right: { kind: 'literal', type: 'number', value: 1 },
    };
  }

  if (expr.operator === '--') {
    return {
      kind: 'binary',
      operator: '-',
      left: operand,
      right: { kind: 'literal', type: 'number', value: 1 },
    };
  }

  return {
    kind: 'unary',
    operator: expr.operator as any,
    operand,
  };
}

/**
 * Transform function call
 * Enhanced with EVM built-in function support based on e2m patterns
 */
function transformFunctionCall(expr: any, context: TranspileContext): MoveExpression {
  const args = (expr.args || []).map((a: any) => transformExpression(a, context));

  // Handle special functions
  if (expr.function?.kind === 'identifier') {
    const name = expr.function.name;

    // keccak256 -> aptos_hash::keccak256
    if (name === 'keccak256') {
      context.usedModules.add('aptos_std::aptos_hash');
      return {
        kind: 'call',
        function: 'aptos_hash::keccak256',
        args,
      };
    }

    // sha256 -> hash::sha2_256
    if (name === 'sha256') {
      context.usedModules.add('std::hash');
      return {
        kind: 'call',
        function: 'hash::sha2_256',
        args,
      };
    }

    // addmod(a, b, n) -> ((a + b) % n)
    if (name === 'addmod' && args.length === 3) {
      return {
        kind: 'binary',
        operator: '%',
        left: { kind: 'binary', operator: '+', left: args[0], right: args[1] },
        right: args[2],
      };
    }

    // mulmod(a, b, n) -> ((a * b) % n)
    if (name === 'mulmod' && args.length === 3) {
      return {
        kind: 'binary',
        operator: '%',
        left: { kind: 'binary', operator: '*', left: args[0], right: args[1] },
        right: args[2],
      };
    }

    // gasleft() - not supported but provide placeholder
    if (name === 'gasleft') {
      context.warnings.push({
        message: 'gasleft() has no equivalent in Move, using max u64',
        severity: 'warning',
      });
      return {
        kind: 'literal',
        type: 'number',
        value: '18446744073709551615',
        suffix: 'u64',
      };
    }

    // blockhash(blockNumber) - not supported
    if (name === 'blockhash') {
      context.warnings.push({
        message: 'blockhash() has no equivalent in Move',
        severity: 'warning',
      });
      return {
        kind: 'call',
        function: 'vector::empty',
        args: [],
      };
    }

    // ecrecover - not directly available
    if (name === 'ecrecover') {
      context.warnings.push({
        message: 'ecrecover() needs custom cryptographic implementation',
        severity: 'warning',
      });
      return {
        kind: 'literal',
        type: 'address',
        value: '@0x0',
      };
    }

    // abi.encode, abi.encodePacked -> bcs::to_bytes
    if (name === 'abi') {
      context.usedModules.add('aptos_std::bcs');
      return {
        kind: 'call',
        function: 'bcs::to_bytes',
        args,
      };
    }
  }

  // Handle member function calls (including external contract calls)
  if (expr.function?.kind === 'member_access') {
    const obj = transformExpression(expr.function.object, context);
    const method = expr.function.member;

    // Handle super.method() - with inheritance flattening, the parent's function
    // is already in the current module, so just call it directly
    if (expr.function.object?.kind === 'identifier' && expr.function.object.name === 'super') {
      return {
        kind: 'call',
        function: toSnakeCase(method),
        args,
      };
    }

    // Handle cross-module library calls: LibraryName.method(args) → library_name::method(args)
    // Detect by checking if the object is a PascalCase identifier (looks like a library/contract name)
    if (expr.function.object?.kind === 'identifier') {
      const objName = expr.function.object.name;
      // PascalCase identifier (starts with uppercase, has lowercase letters) = likely a module/library
      if (/^[A-Z]/.test(objName) && /[a-z]/.test(objName)) {
        const moduleName = toSnakeCase(objName);
        return {
          kind: 'call',
          function: `${moduleName}::${toSnakeCase(method)}`,
          args,
        };
      }
    }

    // Handle using X for Y library calls
    // e.g., amount.add(other) with `using SafeMath for uint256` → (amount + other)
    // Common SafeMath patterns: add, sub, mul, div, mod
    if (context.usingFor && context.usingFor.length > 0) {
      const libraryMethod = transformUsingForCall(obj, method, args, context);
      if (libraryMethod) return libraryMethod;
    }

    // Array methods
    if (method === 'push') {
      context.usedModules.add('std::vector');
      return {
        kind: 'call',
        function: 'vector::push_back',
        args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
      };
    }

    if (method === 'pop') {
      context.usedModules.add('std::vector');
      return {
        kind: 'call',
        function: 'vector::pop_back',
        args: [{ kind: 'borrow', mutable: true, value: obj }],
      };
    }

    if (method === 'length') {
      context.usedModules.add('std::vector');
      return {
        kind: 'call',
        function: 'vector::length',
        args: [{ kind: 'borrow', mutable: false, value: obj }],
      };
    }

    // String methods
    if (method === 'concat') {
      context.usedModules.add('std::string');
      return {
        kind: 'call',
        function: 'string::append',
        args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
      };
    }

    // bytes methods
    if (method === 'concat' && obj.kind === 'identifier') {
      context.usedModules.add('std::vector');
      return {
        kind: 'call',
        function: 'vector::append',
        args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
      };
    }

    // Address methods (for external calls)
    if (method === 'transfer') {
      context.usedModules.add('aptos_framework::coin');
      context.usedModules.add('aptos_framework::aptos_coin');
      context.warnings.push({
        message: 'address.transfer() converted to coin::transfer - verify coin type',
        severity: 'warning',
      });
      return {
        kind: 'call',
        function: 'coin::transfer',
        typeArgs: [{ kind: 'struct', module: 'aptos_framework::aptos_coin', name: 'AptosCoin' }],
        args: [
          { kind: 'identifier', name: 'account' },
          obj,
          args[0] || { kind: 'literal', type: 'number', value: 0 },
        ],
      };
    }

    if (method === 'send') {
      context.usedModules.add('aptos_framework::coin');
      context.warnings.push({
        message: 'address.send() returns bool in Solidity but Move uses abort on failure',
        severity: 'warning',
      });
      return {
        kind: 'call',
        function: 'coin::transfer',
        typeArgs: [{ kind: 'struct', module: 'aptos_framework::aptos_coin', name: 'AptosCoin' }],
        args: [
          { kind: 'identifier', name: 'account' },
          obj,
          args[0] || { kind: 'literal', type: 'number', value: 0 },
        ],
      };
    }

    if (method === 'call') {
      context.warnings.push({
        message: 'Low-level call() not supported - use direct module calls',
        severity: 'warning',
      });
      return {
        kind: 'tuple',
        elements: [
          { kind: 'literal', type: 'bool', value: true },
          { kind: 'call', function: 'vector::empty', args: [] },
        ],
      };
    }

    if (method === 'delegatecall') {
      context.errors.push({
        message: 'UNSUPPORTED: delegatecall cannot be transpiled to Move - Move has no execution context switching. Consider using the capability pattern instead.',
        severity: 'error',
      });
      return {
        kind: 'tuple',
        elements: [
          { kind: 'literal', type: 'bool', value: false },
          { kind: 'call', function: 'vector::empty', args: [] },
        ],
      };
    }

    if (method === 'staticcall') {
      context.warnings.push({
        message: 'staticcall not directly supported - all Move view functions are static',
        severity: 'warning',
      });
      return {
        kind: 'tuple',
        elements: [
          { kind: 'literal', type: 'bool', value: true },
          { kind: 'call', function: 'vector::empty', args: [] },
        ],
      };
    }

    // Interface/external contract calls - transform to direct module calls
    // obj is the contract instance, method is the function name
    if (isExternalContractCall(expr.function.object, context)) {
      return transformExternalCall(expr.function.object, method, args, context);
    }

    return {
      kind: 'method_call',
      receiver: obj,
      method: toSnakeCase(method),
      args,
    };
  }

  const funcExpr = expr.function ? transformExpression(expr.function, context) : null;
  const funcName = funcExpr?.kind === 'identifier' ? funcExpr.name : undefined;

  // Check if this is a struct constructor call: StructName(arg1, arg2, ...)
  // In Solidity, structs can be constructed with positional args
  if (expr.function?.kind === 'identifier') {
    const structName = expr.function.name;
    const structDef = context.structs?.get(structName);
    if (structDef) {
      // Map positional args to struct fields
      const fields = structDef.fields.map((field: any, i: number) => ({
        name: toSnakeCase(field.name),
        value: args[i] || { kind: 'literal', type: 'number', value: 0, suffix: 'u256' },
      }));
      return {
        kind: 'struct',
        name: structName,
        fields,
      };
    }
  }

  // If calling an internal/private function that takes state, append state arg
  // This prevents double mutable borrow - internal functions receive state as param
  if (funcName && funcName !== 'unknown') {
    const originalName = expr.function?.name;
    if (originalName && isInternalStateFunction(originalName, context)) {
      args.push({ kind: 'identifier', name: 'state' });
    }
  }

  return {
    kind: 'call',
    function: funcName || 'unknown',
    args,
  };
}

/**
 * Transform member access
 * Handles enum variant access (EnumName.Variant -> EnumName::Variant)
 */
function transformMemberAccess(expr: any, context: TranspileContext): MoveExpression {
  // Check if this is an enum variant access
  if (expr.object?.kind === 'identifier' && context.enums?.has(expr.object.name)) {
    // This is an enum variant access: EnumName.Variant -> EnumName::Variant
    return {
      kind: 'identifier',
      name: `${expr.object.name}::${expr.member}`,
    };
  }

  // Handle cross-module constant references like constants.BASIS_POINT_MAX or encoded.MASK_UINT16
  // In Solidity, libraries can reference constants from other libraries via LibName.CONSTANT
  // In Move, constants are module-private, so we copy them into the current module
  if (expr.object?.kind === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(expr.member)) {
    const libName = expr.object.name;
    // Track this as an imported constant so the contract transformer can copy it
    if (!(context as any).importedConstants) {
      (context as any).importedConstants = new Map<string, { source: string; name: string }>();
    }
    (context as any).importedConstants.set(expr.member, { source: libName, name: expr.member });
    // Emit as just the constant name (will be defined in this module)
    return { kind: 'identifier', name: expr.member };
  }

  const obj = transformExpression(expr.object, context);

  // Handle .length on arrays/vectors → vector::length(&v)
  if (expr.member === 'length') {
    context.usedModules.add('std::vector');
    return {
      kind: 'call',
      function: 'vector::length',
      args: [{ kind: 'borrow', mutable: false, value: obj }],
    };
  }

  return {
    kind: 'field_access',
    object: obj,
    field: toSnakeCase(expr.member),
  };
}

/**
 * Transform index access (mapping/array access)
 * Based on e2m's StorageOp::handle patterns for SLOAD/SSTORE
 */
function transformIndexAccess(expr: any, context: TranspileContext): MoveExpression {
  const base = transformExpression(expr.base, context);
  const index = transformExpression(expr.index, context);

  // Check if base is a state variable mapping
  if (expr.base?.kind === 'identifier') {
    const stateVar = context.stateVariables.get(expr.base.name);
    if (stateVar?.isMapping) {
      context.usedModules.add('aptos_std::table');

      // Use table::borrow_with_default for safe access
      // Solidity mappings return 0/false/address(0) for missing keys
      const defaultValue = getDefaultForMappingValue(stateVar, context);
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: 'table::borrow_with_default',
          args: [
            { kind: 'borrow', mutable: false, value: base },
            index,
            { kind: 'borrow', mutable: false, value: defaultValue },
          ],
        },
      };
    }
  }

  // Handle nested index access (e.g., nestedMapping[addr1][addr2])
  if (expr.base?.kind === 'index_access') {
    const outerAccess = transformIndexAccess(expr.base, context);
    context.usedModules.add('aptos_std::table');

    // Nested table access - the outer access should give us an inner table
    return {
      kind: 'dereference',
      value: {
        kind: 'call',
        function: 'table::borrow',
        args: [
          { kind: 'borrow', mutable: false, value: outerAccess },
          index,
        ],
      },
    };
  }

  // Vector index access - cast index to u64 (Move vectors require u64 index)
  context.usedModules.add('std::vector');
  return {
    kind: 'dereference',
    value: {
      kind: 'call',
      function: 'vector::borrow',
      args: [
        { kind: 'borrow', mutable: false, value: base },
        castToU64IfNeeded(index),
      ],
    },
  };
}

/**
 * Cast an expression to u64 if it's not already a u64 literal.
 * Move vectors require u64 indices, but Solidity uses uint256 by default.
 */
function castToU64IfNeeded(expr: MoveExpression): MoveExpression {
  // If it's already a u64 literal, no cast needed
  if (expr.kind === 'literal' && expr.type === 'number' && (expr as any).suffix === 'u64') {
    return expr;
  }
  // If it's a number literal with u256 suffix, just change the suffix
  if (expr.kind === 'literal' && expr.type === 'number') {
    return { ...expr, suffix: 'u64' } as any;
  }
  // For identifiers and complex expressions, add a cast
  return {
    kind: 'cast',
    value: expr,
    targetType: { kind: 'primitive', name: 'u64' },
  };
}

/**
 * Cast an expression to u8 for use as a shift amount.
 * Move requires shift right operands to be u8.
 */
function castToU8ForShift(expr: MoveExpression): MoveExpression {
  // If it's already a u8 literal, no cast needed
  if (expr.kind === 'literal' && expr.type === 'number' && (expr as any).suffix === 'u8') {
    return expr;
  }
  // If it's a number literal, just change the suffix
  if (expr.kind === 'literal' && expr.type === 'number') {
    return { ...expr, suffix: 'u8' } as any;
  }
  // If it's already a cast to u8, return as-is
  if (expr.kind === 'cast' && (expr as any).targetType?.kind === 'primitive' && (expr as any).targetType.name === 'u8') {
    return expr;
  }
  // For identifiers and complex expressions, add a cast to u8
  return {
    kind: 'cast',
    value: expr,
    targetType: { kind: 'primitive', name: 'u8' },
  };
}

/**
 * Get the default value for a mapping's value type.
 * Solidity mappings return 0/false/address(0) for missing keys.
 */
function getDefaultForMappingValue(stateVar: any, context: TranspileContext): MoveExpression {
  const valueType = stateVar.mappingValueType?.move;
  if (!valueType) {
    return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
  }

  return getDefaultForMoveType(valueType, stateVar.mappingValueType, context);
}

/**
 * Get a default value expression for a given Move type.
 * Handles primitives, vectors, and structs (with zero-initialized fields).
 */
function getDefaultForMoveType(moveType: any, irType: any, context: TranspileContext): MoveExpression {
  if (!moveType) {
    return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
  }

  switch (moveType.kind) {
    case 'primitive':
      if (moveType.name === 'bool') return { kind: 'literal', type: 'bool', value: false };
      if (moveType.name === 'address') return { kind: 'literal', type: 'address', value: '@0x0' };
      return { kind: 'literal', type: 'number', value: 0, suffix: moveType.name };

    case 'vector':
      return { kind: 'call', function: 'vector::empty', args: [] };

    case 'struct': {
      // Try to find the struct definition to generate a zero-initialized struct literal
      const structName = moveType.name || irType?.structName;
      const structDef = structName ? context.structs?.get(structName) : undefined;
      if (structDef && structDef.fields.length > 0) {
        return {
          kind: 'struct',
          name: structName,
          fields: structDef.fields.map((field: any) => ({
            name: toSnakeCase(field.name),
            value: getDefaultForMoveType(
              field.type?.move || { kind: 'primitive', name: 'u256' },
              field.type,
              context,
            ),
          })),
        };
      }
      // Fallback if struct def not found
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
    }

    default:
      // Check if the IR type has a struct name (e.g., mapping value is a custom struct)
      if (irType?.structName) {
        const structDef = context.structs?.get(irType.structName);
        if (structDef && structDef.fields.length > 0) {
          return {
            kind: 'struct',
            name: irType.structName,
            fields: structDef.fields.map((field: any) => ({
              name: toSnakeCase(field.name),
              value: getDefaultForMoveType(
                field.type?.move || { kind: 'primitive', name: 'u256' },
                field.type,
                context,
              ),
            })),
          };
        }
      }
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
  }
}

/**
 * Transform index access for mutation (assignment target)
 * Returns a mutable borrow suitable for assignment
 */
export function transformIndexAccessMutable(expr: any, context: TranspileContext): MoveExpression {
  const base = transformExpression(expr.base, context);
  const index = transformExpression(expr.index, context);

  // Check if base is a state variable mapping
  if (expr.base?.kind === 'identifier') {
    const stateVar = context.stateVariables.get(expr.base.name);
    if (stateVar?.isMapping) {
      context.usedModules.add('aptos_std::table');
      // Use table::upsert pattern: add default if key doesn't exist, then borrow_mut
      // This mirrors Solidity's behavior where writing to mapping[key] auto-initializes
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: 'table::borrow_mut_with_default',
          args: [
            { kind: 'borrow', mutable: true, value: base },
            index,
            getDefaultForMappingValue(stateVar, context),
          ],
        },
      };
    }
  }

  // Handle nested index access for mutation
  if (expr.base?.kind === 'index_access') {
    const outerAccess = transformIndexAccessMutable(expr.base, context);
    context.usedModules.add('aptos_std::table');
    return {
      kind: 'dereference',
      value: {
        kind: 'call',
        function: 'table::borrow_mut',
        args: [
          { kind: 'borrow', mutable: true, value: outerAccess },
          index,
        ],
      },
    };
  }

  // Vector index access (mutable) - cast index to u64
  context.usedModules.add('std::vector');
  return {
    kind: 'dereference',
    value: {
      kind: 'call',
      function: 'vector::borrow_mut',
      args: [
        { kind: 'borrow', mutable: true, value: base },
        castToU64IfNeeded(index),
      ],
    },
  };
}

/**
 * Transform conditional expression
 */
function transformConditional(expr: any, context: TranspileContext): MoveExpression {
  return {
    kind: 'if_expr',
    condition: transformExpression(expr.condition, context),
    thenExpr: transformExpression(expr.trueExpression, context),
    elseExpr: transformExpression(expr.falseExpression, context),
  };
}

/**
 * Transform tuple
 * Preserves null elements as underscore-prefixed placeholders for destructuring
 */
function transformTuple(expr: any, context: TranspileContext): MoveExpression {
  let placeholderIdx = 0;
  return {
    kind: 'tuple',
    elements: (expr.elements || []).map((e: any) => {
      if (e === null) {
        // Generate a placeholder for ignored tuple elements: _0, _1, _2, etc.
        return { kind: 'identifier', name: `_${placeholderIdx++}` };
      }
      placeholderIdx++;
      return transformExpression(e, context);
    }),
  };
}

/**
 * Transform type conversion
 * Handles Solidity type conversions to Move equivalents
 */
function transformTypeConversion(expr: any, context: TranspileContext): MoveExpression {
  const value = transformExpression(expr.expression, context);
  const targetType = expr.targetType?.move;
  const targetTypeName = expr.targetType?.solidity || expr.targetType?.name;

  // Special case: address(0) -> @0x0 (zero address)
  if (targetTypeName === 'address') {
    // If already an address literal, return as-is (e.g., address(this) where this is @0x1)
    if (value.kind === 'literal' && (value as any).type === 'address') {
      return value;
    }
    // Check if converting a literal number to address
    if (value.kind === 'literal' && value.type === 'number') {
      const numValue = value.value;
      if (numValue === 0 || numValue === '0') {
        return { kind: 'literal', type: 'address', value: '@0x0' };
      }
      // For other numeric literals, convert to hex address
      const hexValue = typeof numValue === 'number'
        ? numValue.toString(16)
        : numValue.toString();
      return { kind: 'literal', type: 'address', value: `@0x${hexValue}` };
    }
    // For non-literal values, use evm_compat::to_address if needed
    // This is a limitation - Move doesn't support runtime int-to-address conversion
    // We'll generate a comment indicating this needs manual review
    context.usedModules.add('transpiler::evm_compat');
    return {
      kind: 'call',
      function: 'evm_compat::to_address',
      args: [value],
    };
  }

  // Special case: uint256(someAddress) - convert address to u256
  if (targetTypeName === 'uint256' && value.kind === 'literal' && (value as any).type === 'address') {
    context.usedModules.add('transpiler::evm_compat');
    return {
      kind: 'call',
      function: 'evm_compat::address_to_u256',
      args: [value],
    };
  }

  // For non-standard uint widths (uint24, uint40, uint48, etc.), Move doesn't have
  // a native type at that width. The type maps to the nearest larger Move type (e.g., u32, u64).
  // Solidity truncates silently to the target width, so we need a bitmask to emulate truncation.
  // Standard Move types (u8, u16, u32, u64, u128, u256) use native `as` cast which aborts on overflow.
  if (targetTypeName && targetTypeName.startsWith('uint')) {
    const bits = parseInt(targetTypeName.slice(4)) || 256;
    const standardBits = [8, 16, 32, 64, 128, 256];
    if (!standardBits.includes(bits)) {
      // Non-standard width: use bitmask to truncate
      // uint24(x) → (x & 0xffffff), uint40(x) → (x & 0xffffffffff), etc.
      const mask = ((1n << BigInt(bits)) - 1n).toString();
      const suffix = targetType?.name || 'u256';
      return {
        kind: 'binary',
        operator: '&',
        left: value,
        right: { kind: 'literal', type: 'number', value: mask, suffix },
      };
    }
  }

  // For non-standard int widths, also use bitmask approach
  if (targetTypeName && targetTypeName.startsWith('int') && !targetTypeName.startsWith('interface')) {
    const bits = parseInt(targetTypeName.slice(3)) || 256;
    const standardBits = [8, 16, 32, 64, 128, 256];
    if (!standardBits.includes(bits)) {
      const mask = ((1n << BigInt(bits)) - 1n).toString();
      const suffix = targetType?.name || 'i256';
      return {
        kind: 'binary',
        operator: '&',
        left: value,
        right: { kind: 'literal', type: 'number', value: mask, suffix },
      };
    }
  }

  // Regular numeric type casts use Move's cast syntax
  if (targetType) {
    return {
      kind: 'cast',
      value,
      targetType,
    };
  }

  return value;
}

/**
 * Transform msg.sender, msg.value, etc.
 */
function transformMsgAccess(expr: any, context: TranspileContext): MoveExpression {
  switch (expr.property) {
    case 'sender':
      // For view/pure functions, account is already an address parameter
      // For other functions, account is a &signer that needs address_of
      const isViewOrPure = context.currentFunctionStateMutability === 'view' ||
                           context.currentFunctionStateMutability === 'pure';
      if (isViewOrPure) {
        return { kind: 'identifier', name: 'account' };
      } else {
        context.usedModules.add('std::signer');
        return {
          kind: 'call',
          function: 'signer::address_of',
          args: [{ kind: 'identifier', name: 'account' }],
        };
      }

    case 'value':
      context.warnings.push({
        message: 'msg.value has no direct equivalent in Move',
        severity: 'warning',
      });
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };

    default:
      context.warnings.push({
        message: `msg.${expr.property} is not supported`,
        severity: 'warning',
      });
      return { kind: 'literal', type: 'number', value: 0 };
  }
}

/**
 * Transform block.timestamp, block.number, etc.
 */
function transformBlockAccess(expr: any, context: TranspileContext): MoveExpression {
  switch (expr.property) {
    case 'timestamp':
      context.usedModules.add('aptos_framework::timestamp');
      // timestamp::now_seconds() returns u64, but Solidity block.timestamp is uint256
      // Cast to u256 for compatibility with u256 arithmetic
      return {
        kind: 'cast',
        value: {
          kind: 'call',
          function: 'timestamp::now_seconds',
          args: [],
        },
        targetType: { kind: 'primitive', name: 'u256' },
      };

    case 'number':
      context.usedModules.add('aptos_framework::block');
      // block::get_current_block_height() returns u64, but Solidity block.number is uint256
      return {
        kind: 'cast',
        value: {
          kind: 'call',
          function: 'block::get_current_block_height',
          args: [],
        },
        targetType: { kind: 'primitive', name: 'u256' },
      };

    default:
      context.warnings.push({
        message: `block.${expr.property} is not supported`,
        severity: 'warning',
      });
      return { kind: 'literal', type: 'number', value: 0 };
  }
}

/**
 * Transform type(T).max, type(T).min patterns
 * Maps to Move numeric maximum/minimum constants
 */
function transformTypeMember(expr: any, context: TranspileContext): MoveExpression {
  const typeName = String(expr.typeName).toLowerCase();
  const member = expr.member;

  // Move 2.3 builtin constants: u8::MAX, u64::MAX, u256::MAX, i64::MIN, etc.
  // These are cleaner and more idiomatic than hardcoded numeric values
  const moveTypeMap: Record<string, string> = {
    'uint8': 'u8', 'uint16': 'u16', 'uint32': 'u32', 'uint64': 'u64',
    'uint128': 'u128', 'uint256': 'u256', 'uint': 'u256',
    'int8': 'i8', 'int16': 'i16', 'int32': 'i32', 'int64': 'i64',
    'int128': 'i128', 'int256': 'i256', 'int': 'i256',
  };

  const moveType = moveTypeMap[typeName];
  if (moveType && (member === 'max' || member === 'min')) {
    const constName = member === 'max' ? 'MAX' : 'MIN';
    context.usedModules.add(`std::${moveType}`);
    return {
      kind: 'identifier',
      name: `${moveType}::${constName}`,
    };
  }

  // Fallback: Map Solidity types to Move max values (for non-standard uint widths)
  const maxValues: Record<string, { value: string; suffix: string }> = {
    'uint8': { value: '255', suffix: 'u8' },
    'uint16': { value: '65535', suffix: 'u16' },
    'uint32': { value: '4294967295', suffix: 'u32' },
    'uint64': { value: '18446744073709551615', suffix: 'u64' },
    'uint128': { value: '340282366920938463463374607431768211455', suffix: 'u128' },
    'uint256': { value: '115792089237316195423570985008687907853269984665640564039457584007913129639935', suffix: 'u256' },
    'uint': { value: '115792089237316195423570985008687907853269984665640564039457584007913129639935', suffix: 'u256' },
  };

  if (member === 'max') {
    const maxInfo = maxValues[typeName];
    if (maxInfo) {
      return {
        kind: 'literal',
        type: 'number',
        value: maxInfo.value,
        suffix: maxInfo.suffix,
      };
    }
    // Fallback for unknown types
    context.warnings.push({
      message: `type(${expr.typeName}).max not fully supported, using u256 max`,
      severity: 'warning',
    });
    return {
      kind: 'literal',
      type: 'number',
      value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      suffix: 'u256',
    };
  }

  if (member === 'min') {
    // All unsigned types have min of 0
    const suffix = maxValues[typeName]?.suffix || 'u256';
    return {
      kind: 'literal',
      type: 'number',
      value: '0',
      suffix,
    };
  }

  context.warnings.push({
    message: `type(${expr.typeName}).${member} not supported`,
    severity: 'warning',
  });
  return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
}

/**
 * Transform tx.origin, tx.gasprice
 */
function transformTxAccess(expr: any, context: TranspileContext): MoveExpression {
  context.warnings.push({
    message: `tx.${expr.property} is not supported in Move`,
    severity: 'warning',
  });
  return { kind: 'literal', type: 'number', value: 0 };
}

// ============================================================================
// Yul Assembly to Move IR Transpiler
// Handles common bit manipulation patterns found in DeFi libraries
// ============================================================================

/**
 * Transpile a Yul assembly block to Move IR statements.
 * Supports: assignments, let declarations, if/for blocks, and common Yul builtins.
 */
function transpileAssemblyBlock(operations: any[]): IRStatement[] {
  const statements: IRStatement[] = [];

  for (const op of operations) {
    const stmt = transpileAssemblyOperation(op);
    if (stmt) {
      if (Array.isArray(stmt)) {
        statements.push(...stmt);
      } else {
        statements.push(stmt);
      }
    }
  }

  return statements;
}

/**
 * Transpile a single Yul assembly operation to Move IR.
 */
function transpileAssemblyOperation(op: any): IRStatement | IRStatement[] | null {
  if (!op) return null;

  switch (op.type) {
    case 'AssemblyAssignment': {
      // name := expression
      const nameNode = op.names?.[0];
      if (!nameNode) return null;
      const value = transpileYulExpression(op.expression);
      if (!value) return null;

      // Handle AssemblyMemberAccess targets (e.g., $.slot := value)
      let target: IRExpression;
      if (nameNode.type === 'AssemblyMemberAccess') {
        const objExpr = transpileYulExpression(nameNode.expression);
        const memberName = typeof nameNode.memberName === 'string'
          ? nameNode.memberName
          : nameNode.memberName?.name || 'unknown';
        target = { kind: 'member_access', object: objExpr || { kind: 'identifier', name: 'unknown' }, member: memberName };
      } else {
        const name = typeof nameNode === 'string' ? nameNode : (nameNode.name || 'unknown');
        target = { kind: 'identifier', name: toSnakeCase(name) };
      }

      return { kind: 'assignment', target, value };
    }

    case 'AssemblyLocalDefinition': {
      // let name := expression
      const name = op.names?.[0]?.name || op.names?.[0];
      const value = op.expression ? transpileYulExpression(op.expression) : { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
      if (!name) return null;
      return {
        kind: 'variable_declaration',
        name: toSnakeCase(typeof name === 'string' ? name : name),
        initialValue: value,
      };
    }

    case 'AssemblyIf': {
      // if condition { body }
      const condition = transpileYulExpression(op.condition);
      if (!condition) return null;
      const body = op.body?.operations ? transpileAssemblyBlock(op.body.operations) : [];
      // In Yul, `if` checks for non-zero. If condition is already boolean
      // (comparison, unary !, logical &&/||), use it directly; otherwise wrap with != 0
      const moveCondition = isBooleanExpression(condition) ? condition
        : { kind: 'binary', operator: '!=', left: condition, right: { kind: 'literal', type: 'number', value: 0, suffix: 'u256' } };
      return {
        kind: 'if',
        condition: moveCondition,
        thenBlock: body,
      };
    }

    case 'AssemblyFor': {
      // for { init } condition { post } { body }
      const initStmts = op.pre?.operations ? transpileAssemblyBlock(op.pre.operations) : [];
      const condition = transpileYulExpression(op.condition);
      const postStmts = op.post?.operations ? transpileAssemblyBlock(op.post.operations) : [];
      const body = op.body?.operations ? transpileAssemblyBlock(op.body.operations) : [];
      // Emit as: init; while(condition) { body; post; }
      const allStmts: IRStatement[] = [...initStmts];
      allStmts.push({
        kind: 'while',
        condition: condition || { kind: 'literal', type: 'bool', value: true },
        body: [...body, ...postStmts],
      });
      return allStmts;
    }

    case 'AssemblyExpression':
    case 'AssemblyCall': {
      // Standalone expression (e.g., revert(0, 0))
      const expr = transpileYulExpression(op);
      if (!expr) return null;
      return { kind: 'expression', expression: expr };
    }

    case 'AssemblyBlock': {
      // Nested block
      return op.operations ? transpileAssemblyBlock(op.operations) : null;
    }

    default:
      return null;
  }
}

/**
 * Transpile a Yul expression to Move IR expression.
 * Maps Yul builtins to Move operators/functions.
 */
function transpileYulExpression(expr: any): IRExpression | null {
  if (!expr) return null;

  switch (expr.type) {
    case 'AssemblyCall': {
      const name = expr.functionName;
      const args = expr.arguments || [];

      // Zero-argument calls are identifiers (Yul quirk: variables are calls with no args)
      if (args.length === 0) {
        // Check for known constants
        if (name === 'gas') return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
        if (name === 'caller') return { kind: 'identifier', name: 'caller' };
        if (name === 'callvalue') return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
        if (name === 'calldatasize') return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
        if (name === 'returndatasize') return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
        // Default: treat as identifier
        return { kind: 'identifier', name: toSnakeCase(name) };
      }

      // One-argument builtins
      if (args.length === 1) {
        const a = transpileYulExpression(args[0]);
        if (!a) return null;

        switch (name) {
          case 'not':
            // Bitwise NOT: ~a = a ^ MAX_U256
            return {
              kind: 'binary',
              operator: '^',
              left: a,
              right: { kind: 'literal', type: 'number', value: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', suffix: 'u256' },
            };
          case 'iszero': {
            // If the inner expression is already boolean (comparison, !, &&, ||), negate it
            if (isBooleanExpression(a)) {
              return { kind: 'unary', operator: '!', operand: a };
            }
            return { kind: 'binary', operator: '==', left: a, right: { kind: 'literal', type: 'number', value: 0, suffix: 'u256' } };
          }
          case 'mload':
            // Memory load - no direct Move equivalent, pass through as identifier
            return a;
          default:
            // Unknown unary - emit as function call
            return { kind: 'function_call', function: { kind: 'identifier', name: toSnakeCase(name) }, args: [a] };
        }
      }

      // Two-argument builtins
      if (args.length === 2) {
        const a = transpileYulExpression(args[0]);
        const b = transpileYulExpression(args[1]);
        if (!a || !b) return null;

        switch (name) {
          // Arithmetic — wrap bool operands to u256 (Yul comparisons return 1/0 as u256)
          case 'add': return { kind: 'binary', operator: '+', left: boolToU256(a), right: boolToU256(b) };
          case 'sub': return { kind: 'binary', operator: '-', left: boolToU256(a), right: boolToU256(b) };
          case 'mul': return { kind: 'binary', operator: '*', left: boolToU256(a), right: boolToU256(b) };
          case 'div': return { kind: 'binary', operator: '/', left: boolToU256(a), right: boolToU256(b) };
          case 'mod': return { kind: 'binary', operator: '%', left: boolToU256(a), right: boolToU256(b) };

          // Bitwise — wrap bool operands to u256
          case 'and': return { kind: 'binary', operator: '&', left: boolToU256(a), right: boolToU256(b) };
          case 'or':  return { kind: 'binary', operator: '|', left: boolToU256(a), right: boolToU256(b) };
          case 'xor': return { kind: 'binary', operator: '^', left: boolToU256(a), right: boolToU256(b) };
          case 'shl': {
            // Yul shl(shift, value) = value << shift
            // Note: Yul arg order is (shift, value) not (value, shift)
            // Move shift requires u8 type
            return {
              kind: 'binary', operator: '<<',
              left: b, // value
              right: { kind: 'type_conversion', targetType: { solidity: 'uint8', move: { kind: 'primitive', name: 'u8' }, isArray: false, isMapping: false }, expression: a },
            };
          }
          case 'shr': {
            // Yul shr(shift, value) = value >> shift
            return {
              kind: 'binary', operator: '>>',
              left: b, // value
              right: { kind: 'type_conversion', targetType: { solidity: 'uint8', move: { kind: 'primitive', name: 'u8' }, isArray: false, isMapping: false }, expression: a },
            };
          }

          // Comparison
          case 'lt': return { kind: 'binary', operator: '<', left: a, right: b };
          case 'gt': return { kind: 'binary', operator: '>', left: a, right: b };
          case 'eq': return { kind: 'binary', operator: '==', left: a, right: b };
          case 'slt': return { kind: 'binary', operator: '<', left: a, right: b };
          case 'sgt': return { kind: 'binary', operator: '>', left: a, right: b };

          // Memory operations - no direct Move equivalent
          case 'mstore':
          case 'mstore8':
            return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };

          default:
            // Unknown binary - emit as function call
            return { kind: 'function_call', function: { kind: 'identifier', name: toSnakeCase(name) }, args: [a, b] };
        }
      }

      // Three-argument builtins
      if (args.length === 3) {
        const a = transpileYulExpression(args[0]);
        const b = transpileYulExpression(args[1]);
        const c = transpileYulExpression(args[2]);
        if (!a || !b || !c) return null;

        switch (name) {
          case 'addmod':
            // (a + b) % c
            return { kind: 'binary', operator: '%', left: { kind: 'binary', operator: '+', left: a, right: b }, right: c };
          case 'mulmod':
            // (a * b) % c
            return { kind: 'binary', operator: '%', left: { kind: 'binary', operator: '*', left: a, right: b }, right: c };
          default:
            return { kind: 'function_call', function: { kind: 'identifier', name: toSnakeCase(name) }, args: [a, b, c] };
        }
      }

      // Multi-argument fallback
      const transpiled = args.map(transpileYulExpression).filter(Boolean);
      return { kind: 'function_call', function: { kind: 'identifier', name: toSnakeCase(name) }, args: transpiled as any[] };
    }

    case 'DecimalNumber':
      return { kind: 'literal', type: 'number', value: expr.value, suffix: 'u256' };

    case 'HexNumber':
      return { kind: 'literal', type: 'number', value: expr.value, suffix: 'u256' };

    case 'StringLiteral':
      return { kind: 'literal', type: 'string', value: expr.value };

    case 'BooleanLiteral':
      return { kind: 'literal', type: 'bool', value: expr.value };

    case 'Identifier':
      return { kind: 'identifier', name: toSnakeCase(expr.name) };

    case 'AssemblyMemberAccess': {
      const obj = transpileYulExpression(expr.expression);
      const member = typeof expr.memberName === 'string' ? expr.memberName : (expr.memberName?.name || 'unknown');
      return { kind: 'member_access', object: obj || { kind: 'identifier', name: 'unknown' }, member };
    }

    default:
      return null;
  }
}

/**
 * Check if an IR expression produces a boolean value in Move.
 * Used to avoid wrapping boolean results with `!= 0u256` in assembly conditions.
 */
function isBooleanExpression(expr: any): boolean {
  if (!expr) return false;
  // Comparison operators produce bool
  if (expr.kind === 'binary' && ['>', '<', '==', '!=', '>=', '<=', '&&', '||'].includes(expr.operator)) return true;
  // Unary ! produces bool
  if (expr.kind === 'unary' && expr.operator === '!') return true;
  // Boolean literals
  if (expr.kind === 'literal' && expr.type === 'bool') return true;
  return false;
}

/**
 * Convert a boolean expression to u256 for use in arithmetic context.
 * In Yul, comparisons return 1 or 0 (u256). In Move, they return bool.
 * This wraps: bool_expr → if (bool_expr) 1u256 else 0u256
 */
function boolToU256(expr: any): any {
  if (!isBooleanExpression(expr)) return expr;
  return {
    kind: 'conditional',
    condition: expr,
    trueExpression: { kind: 'literal', type: 'number', value: 1, suffix: 'u256' },
    falseExpression: { kind: 'literal', type: 'number', value: 0, suffix: 'u256' },
  };
}

/**
 * Convert to snake_case
 */
function toSnakeCase(str: string): string {
  if (!str) return '';

  // Check if it's already SCREAMING_SNAKE_CASE (all caps with underscores)
  // Move constants use SCREAMING_SNAKE — preserve as-is
  if (/^[A-Z][A-Z0-9_]*$/.test(str)) {
    return str;
  }

  // Convert camelCase/PascalCase to snake_case
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Convert to SCREAMING_SNAKE_CASE
 * Handles spaces, camelCase, and special characters
 */
function toScreamingSnakeCase(str: string): string {
  if (!str) return '';
  // Already in SCREAMING_SNAKE_CASE format
  if (/^[A-Z][A-Z0-9_]*$/.test(str)) {
    return str;
  }
  return str
    .replace(/\s+/g, '_')           // Replace spaces with underscores
    .replace(/([A-Z])/g, '_$1')     // Add underscore before capitals
    .replace(/[^A-Z0-9_]/gi, '')    // Remove non-alphanumeric except underscore
    .toUpperCase()
    .replace(/^_/, '')              // Remove leading underscore
    .replace(/_+/g, '_');           // Collapse multiple underscores
}

/**
 * Check if operator is an assignment operator
 */
function isAssignmentOperator(op: string): boolean {
  return ['=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>='].includes(op);
}

/**
 * Check if expression is an external contract call
 * External calls are calls on interface-typed variables or contract instances
 */
function isExternalContractCall(obj: any, context: TranspileContext): boolean {
  if (!obj) return false;

  // Check if it's a type cast to an interface (e.g., IERC20(addr).transfer())
  if (obj.type === 'FunctionCall' && obj.expression?.type === 'Identifier') {
    const typeName = obj.expression.name;
    // Interfaces typically start with 'I'
    if (typeName && (typeName.startsWith('I') || typeName.endsWith('Interface'))) {
      return true;
    }
  }

  // Check if it's a variable of interface/contract type
  if (obj.kind === 'identifier') {
    const varType = context.localVariables.get(obj.name);
    if (varType?.structName && (varType.structName.startsWith('I') || varType.structName.endsWith('Interface'))) {
      return true;
    }
  }

  return false;
}

/**
 * Transform external contract call to Move module call
 * In Move, we need to know the module address at compile time
 */
function transformExternalCall(
  obj: any,
  method: string,
  args: MoveExpression[],
  context: TranspileContext
): MoveExpression {
  // Extract interface/contract name and address
  let interfaceName = 'unknown';
  let targetAddress: MoveExpression | null = null;

  if (obj.type === 'FunctionCall') {
    interfaceName = obj.expression?.name || 'unknown';
    if (obj.arguments && obj.arguments.length > 0) {
      targetAddress = transformExpression(
        { kind: 'identifier', name: obj.arguments[0].name || obj.arguments[0].value },
        context
      );
    }
  } else if (obj.kind === 'identifier') {
    interfaceName = context.localVariables.get(obj.name)?.structName || 'unknown';
    targetAddress = { kind: 'identifier', name: obj.name };
  }

  // Generate module call pattern
  // Format: module_name::function_name(target_address, ...args)
  const moduleName = toSnakeCase(interfaceName.replace(/^I/, ''));

  context.warnings.push({
    message: `External call to ${interfaceName}.${method}() - ensure module ${moduleName} is available at expected address`,
    severity: 'warning',
  });

  // For common patterns, provide better mappings
  if (interfaceName === 'IERC20' || interfaceName === 'ERC20') {
    return transformERC20Call(method, targetAddress, args, context);
  }

  if (interfaceName === 'IERC721' || interfaceName === 'ERC721') {
    return transformERC721Call(method, targetAddress, args, context);
  }

  // Generic external call - becomes a module function call
  const fullArgs = targetAddress ? [targetAddress, ...args] : args;

  return {
    kind: 'call',
    function: `${moduleName}::${toSnakeCase(method)}`,
    args: fullArgs,
  };
}

/**
 * Transform ERC20 interface calls to Aptos coin operations
 */
function transformERC20Call(
  method: string,
  tokenAddress: MoveExpression | null,
  args: MoveExpression[],
  context: TranspileContext
): MoveExpression {
  context.usedModules.add('aptos_framework::coin');
  context.usedModules.add('aptos_framework::fungible_asset');

  switch (method) {
    case 'transfer':
      return {
        kind: 'call',
        function: 'coin::transfer',
        typeArgs: [{ kind: 'generic', name: 'CoinType' }],
        args: [
          { kind: 'identifier', name: 'account' },
          args[0], // to
          args[1], // amount
        ],
      };

    case 'transferFrom':
      context.warnings.push({
        message: 'ERC20.transferFrom requires FA transfer_with_ref or alternative pattern',
        severity: 'warning',
      });
      return {
        kind: 'call',
        function: 'coin::transfer_from',
        typeArgs: [{ kind: 'generic', name: 'CoinType' }],
        args: [
          args[0], // from
          args[1], // to
          args[2], // amount
        ],
      };

    case 'approve':
      context.warnings.push({
        message: 'ERC20.approve not directly supported - use capability pattern',
        severity: 'warning',
      });
      return { kind: 'literal', type: 'bool', value: true };

    case 'balanceOf':
      return {
        kind: 'call',
        function: 'coin::balance',
        typeArgs: [{ kind: 'generic', name: 'CoinType' }],
        args: [args[0]], // owner
      };

    case 'allowance':
      context.warnings.push({
        message: 'ERC20.allowance not directly supported in Aptos coin',
        severity: 'warning',
      });
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };

    case 'totalSupply':
      return {
        kind: 'call',
        function: 'coin::supply',
        typeArgs: [{ kind: 'generic', name: 'CoinType' }],
        args: [],
      };

    default:
      return {
        kind: 'call',
        function: `token::${toSnakeCase(method)}`,
        args: tokenAddress ? [tokenAddress, ...args] : args,
      };
  }
}

/**
 * Transform ERC721 interface calls to Aptos token/NFT operations
 */
function transformERC721Call(
  method: string,
  tokenAddress: MoveExpression | null,
  args: MoveExpression[],
  context: TranspileContext
): MoveExpression {
  context.usedModules.add('aptos_token_objects::token');
  context.usedModules.add('aptos_token_objects::collection');

  switch (method) {
    case 'transferFrom':
    case 'safeTransferFrom':
      return {
        kind: 'call',
        function: 'object::transfer',
        args: [
          { kind: 'identifier', name: 'account' },
          args[2], // token_id (object)
          args[1], // to
        ],
      };

    case 'ownerOf':
      return {
        kind: 'call',
        function: 'object::owner',
        args: [args[0]], // token_id
      };

    case 'balanceOf':
      context.warnings.push({
        message: 'ERC721.balanceOf requires custom implementation in Aptos',
        severity: 'warning',
      });
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u64' };

    case 'approve':
      context.warnings.push({
        message: 'ERC721.approve - use object::generate_linear_transfer_ref',
        severity: 'warning',
      });
      return { kind: 'literal', type: 'bool', value: true };

    case 'setApprovalForAll':
      context.warnings.push({
        message: 'ERC721.setApprovalForAll not directly supported',
        severity: 'warning',
      });
      return { kind: 'literal', type: 'bool', value: true };

    case 'tokenURI':
      return {
        kind: 'call',
        function: 'token::uri',
        args: [args[0]], // token_id
      };

    default:
      return {
        kind: 'call',
        function: `nft::${toSnakeCase(method)}`,
        args: tokenAddress ? [tokenAddress, ...args] : args,
      };
  }
}

/**
 * Transform a `using X for Y` library method call.
 * E.g., with `using SafeMath for uint256`, `amount.add(other)` becomes `(amount + other)`.
 * Common library patterns (SafeMath, Address, Strings, etc.) are inlined.
 */
function transformUsingForCall(
  obj: MoveExpression,
  method: string,
  args: MoveExpression[],
  context: TranspileContext
): MoveExpression | undefined {
  // SafeMath-style math operations: amount.add(x) → amount + x
  const mathOps: Record<string, string> = {
    'add': '+',
    'sub': '-',
    'mul': '*',
    'div': '/',
    'mod': '%',
  };

  if (mathOps[method] && args.length >= 1) {
    return {
      kind: 'binary',
      operator: mathOps[method] as any,
      left: obj,
      right: args[0],
    };
  }

  // SafeMath tryAdd/trySub etc. - return (bool, value) tuple
  const tryMathOps: Record<string, string> = {
    'tryAdd': '+',
    'trySub': '-',
    'tryMul': '*',
    'tryDiv': '/',
    'tryMod': '%',
  };

  if (tryMathOps[method] && args.length >= 1) {
    // Return (true, result) — Move arithmetic will abort on overflow anyway
    return {
      kind: 'tuple',
      elements: [
        { kind: 'literal', type: 'bool', value: true },
        {
          kind: 'binary',
          operator: tryMathOps[method] as any,
          left: obj,
          right: args[0],
        },
      ],
    };
  }

  // Address library: addr.isContract() → (not supported, return false)
  if (method === 'isContract') {
    context.warnings.push({
      message: 'address.isContract() not available in Move, using false',
      severity: 'warning',
    });
    return { kind: 'literal', type: 'bool', value: false };
  }

  // Strings library: uint.toString() → string_utils::to_string
  if (method === 'toString' || method === 'toHexString') {
    context.usedModules.add('aptos_std::string_utils');
    return {
      kind: 'call',
      function: 'string_utils::to_string',
      args: [{ kind: 'borrow', mutable: false, value: obj }],
    };
  }

  // If we can't inline it, treat as a direct function call with obj as first arg
  // This handles custom library functions: obj.customMethod(args) → customMethod(obj, args)
  return {
    kind: 'call',
    function: toSnakeCase(method),
    args: [obj, ...args],
  };
}

/**
 * Check if a function is an internal/private function that accesses state.
 * These functions receive state as a parameter to avoid double mutable borrow.
 */
function isInternalStateFunction(name: string, context: TranspileContext): boolean {
  // Libraries have no state, so no function in a library receives state as param
  if ((context as any).isLibrary) return false;

  // Look up the function in the contract's IR to check visibility
  const contractFunctions = context.inheritedContracts?.values();
  if (!contractFunctions) {
    // Check if it's in the stateVariables context (heuristic: if the function
    // name matches an internal function we've seen, assume it accesses state)
    // A more precise approach would store function metadata in context
    return false;
  }

  // If we have a functionRegistry in context, use it
  const registry = (context as any).functionRegistry as Map<string, { visibility: string; accessesState: boolean }> | undefined;
  if (registry) {
    const info = registry.get(name);
    if (info) {
      return (info.visibility === 'private' || info.visibility === 'internal') && info.accessesState;
    }
  }

  return false;
}

/**
 * Check if an identifier name is a type cast (e.g., address, uint256, bytes32)
 */
function isTypecastIdentifier(name: string): boolean {
  const typeCastNames = [
    'address',
    'bool',
    'string',
    'bytes',
    // Uint types
    'uint', 'uint8', 'uint16', 'uint24', 'uint32', 'uint40', 'uint48', 'uint56',
    'uint64', 'uint72', 'uint80', 'uint88', 'uint96', 'uint104', 'uint112', 'uint120',
    'uint128', 'uint136', 'uint144', 'uint152', 'uint160', 'uint168', 'uint176', 'uint184',
    'uint192', 'uint200', 'uint208', 'uint216', 'uint224', 'uint232', 'uint240', 'uint248',
    'uint256',
    // Int types
    'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    // Bytes types
    'bytes1', 'bytes2', 'bytes3', 'bytes4', 'bytes5', 'bytes6', 'bytes7', 'bytes8',
    'bytes9', 'bytes10', 'bytes11', 'bytes12', 'bytes13', 'bytes14', 'bytes15', 'bytes16',
    'bytes17', 'bytes18', 'bytes19', 'bytes20', 'bytes21', 'bytes22', 'bytes23', 'bytes24',
    'bytes25', 'bytes26', 'bytes27', 'bytes28', 'bytes29', 'bytes30', 'bytes31', 'bytes32',
  ];
  return typeCastNames.includes(name);
}

/**
 * Map a type identifier name to a Move type
 */
function mapIdentifierToMoveType(name: string): any {
  if (name === 'address') return { kind: 'primitive', name: 'address' };
  if (name === 'bool') return { kind: 'primitive', name: 'bool' };
  if (name === 'string') return { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } };
  if (name === 'bytes') return { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } };

  // Uint types
  if (name === 'uint' || name === 'uint256') return { kind: 'primitive', name: 'u256' };
  if (name === 'uint8') return { kind: 'primitive', name: 'u8' };
  if (name === 'uint16') return { kind: 'primitive', name: 'u16' };
  if (name === 'uint32') return { kind: 'primitive', name: 'u32' };
  if (name === 'uint64') return { kind: 'primitive', name: 'u64' };
  if (name === 'uint128') return { kind: 'primitive', name: 'u128' };
  if (name.startsWith('uint')) return { kind: 'primitive', name: 'u256' }; // Default larger

  // Int types — Move 2.3+ has signed integers
  if (name === 'int' || name === 'int256') return { kind: 'primitive', name: 'i256' };
  if (name === 'int8') return { kind: 'primitive', name: 'i8' };
  if (name === 'int16') return { kind: 'primitive', name: 'i16' };
  if (name === 'int32') return { kind: 'primitive', name: 'i32' };
  if (name === 'int64') return { kind: 'primitive', name: 'i64' };
  if (name === 'int128') return { kind: 'primitive', name: 'i128' };
  if (name.startsWith('int')) return { kind: 'primitive', name: 'i256' };

  // Bytes fixed-size types -> integer types (for DeFi bit packing)
  if (name === 'bytes1') return { kind: 'primitive', name: 'u8' };
  if (name === 'bytes2') return { kind: 'primitive', name: 'u16' };
  if (name === 'bytes4') return { kind: 'primitive', name: 'u32' };
  if (name === 'bytes8') return { kind: 'primitive', name: 'u64' };
  if (name === 'bytes16') return { kind: 'primitive', name: 'u128' };
  if (name.startsWith('bytes') && name !== 'bytes') return { kind: 'primitive', name: 'u256' };
  // Dynamic bytes -> vector<u8>
  if (name === 'bytes') return { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } };

  return { kind: 'primitive', name: 'u256' }; // Default
}
