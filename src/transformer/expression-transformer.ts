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
        name: vars.map((v: any) => v?.name || '_').filter(Boolean),
        type: vars[0]?.typeName ? createIRType(vars[0].typeName) : undefined,
        initialValue: stmt.initialValue ? solidityExpressionToIR(stmt.initialValue) : undefined,
      };

    case 'ExpressionStatement':
      // Check if this is an assignment expression (a = b or a += b, etc.)
      const exprNode = stmt.expression;
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

  const value = transformExpression(stmt.value, context);

  // Handle compound assignment
  if (stmt.operator && stmt.operator !== '=') {
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
    body.push({
      kind: 'expression',
      expression: transformExpression(stmt.update, context),
    });
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
      return {
        kind: 'literal',
        type: 'number',
        value,
        suffix: 'u256',
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
 * Transform identifier
 */
function transformIdentifier(expr: any, context: TranspileContext): MoveExpression {
  const name = toSnakeCase(expr.name);

  // Check if it's a state variable
  if (context.stateVariables.has(expr.name)) {
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

  // Handle exponentiation specially - use our evm_compat module
  if (expr.operator === '**') {
    context.usedModules.add('transpiler::evm_compat');
    return {
      kind: 'call',
      function: 'evm_compat::exp_u256',
      args: [left, right],
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

    // addmod(a, b, n) -> evm_compat::addmod
    if (name === 'addmod') {
      context.usedModules.add('transpiler::evm_compat');
      return {
        kind: 'call',
        function: 'evm_compat::addmod',
        args,
      };
    }

    // mulmod(a, b, n) -> evm_compat::mulmod
    if (name === 'mulmod') {
      context.usedModules.add('transpiler::evm_compat');
      return {
        kind: 'call',
        function: 'evm_compat::mulmod',
        args,
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
      context.warnings.push({
        message: 'delegatecall not supported in Move - consider capability pattern',
        severity: 'warning',
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

  const obj = transformExpression(expr.object, context);

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

      // Check context to determine if this is a mutable access (assignment target)
      // For now we assume read access - mutation will be handled in assignment transform
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: 'table::borrow',
          args: [
            { kind: 'borrow', mutable: false, value: base },
            index,
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

  // Vector index access
  context.usedModules.add('std::vector');
  return {
    kind: 'dereference',
    value: {
      kind: 'call',
      function: 'vector::borrow',
      args: [
        { kind: 'borrow', mutable: false, value: base },
        index,
      ],
    },
  };
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
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: 'table::borrow_mut',
          args: [
            { kind: 'borrow', mutable: true, value: base },
            index,
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

  // Vector index access (mutable)
  context.usedModules.add('std::vector');
  return {
    kind: 'dereference',
    value: {
      kind: 'call',
      function: 'vector::borrow_mut',
      args: [
        { kind: 'borrow', mutable: true, value: base },
        index,
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
 */
function transformTuple(expr: any, context: TranspileContext): MoveExpression {
  return {
    kind: 'tuple',
    elements: (expr.elements || [])
      .filter((e: any) => e !== null)
      .map((e: any) => transformExpression(e, context)),
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
      return {
        kind: 'call',
        function: 'timestamp::now_seconds',
        args: [],
      };

    case 'number':
      context.usedModules.add('aptos_framework::block');
      return {
        kind: 'call',
        function: 'block::get_current_block_height',
        args: [],
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
 * Transform tx.origin, tx.gasprice
 */
function transformTxAccess(expr: any, context: TranspileContext): MoveExpression {
  context.warnings.push({
    message: `tx.${expr.property} is not supported in Move`,
    severity: 'warning',
  });
  return { kind: 'literal', type: 'number', value: 0 };
}

/**
 * Convert to snake_case
 */
function toSnakeCase(str: string): string {
  if (!str) return '';

  // Check if it's already SCREAMING_SNAKE_CASE (all caps with underscores)
  if (/^[A-Z][A-Z0-9_]*$/.test(str)) {
    // Preserve constants as-is, just lowercase
    return str.toLowerCase();
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

  // Int types (Move 2.0 has signed integers)
  if (name === 'int' || name === 'int256') return { kind: 'primitive', name: 'i256' };
  if (name === 'int8') return { kind: 'primitive', name: 'i8' };
  if (name === 'int16') return { kind: 'primitive', name: 'i16' };
  if (name === 'int32') return { kind: 'primitive', name: 'i32' };
  if (name === 'int64') return { kind: 'primitive', name: 'i64' };
  if (name === 'int128') return { kind: 'primitive', name: 'i128' };
  if (name.startsWith('int')) return { kind: 'primitive', name: 'i256' };

  // Bytes types -> vector<u8>
  if (name.startsWith('bytes')) {
    return { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } };
  }

  return { kind: 'primitive', name: 'u256' }; // Default
}
