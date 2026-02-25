/**
 * Expression Transformer
 * Transforms Solidity expressions and statements to Move
 */

import type { MoveStatement, MoveExpression, MoveType } from '../types/move-ast.js';
import type { IRStatement, IRExpression, TranspileContext } from '../types/ir.js';
import { MoveTypes } from '../types/move-ast.js';
import { createIRType } from '../mapper/type-mapper.js';
import {
  getTypeWidth,
  isBoolType,
  isSignedType,
  inferBinaryResultType,
  getExprInferredType,
  setExprInferredType,
  lookupVariableType,
  suffixToMoveType,
  harmonizeComparisonTypes,
} from './type-inference.js';

/**
 * Get the configured signer parameter name from context.
 * Returns 'account' (default) or 'signer' depending on the signerParamName flag.
 */
function signerName(context: TranspileContext): string {
  return context.signerParamName || 'account';
}

/**
 * Push a warning or error depending on strict mode.
 * In strict mode, unsupported patterns become transpilation errors.
 */
function warnOrError(context: TranspileContext, message: string): void {
  if (context.strictMode) {
    context.errors.push({ message, severity: 'error' });
  } else {
    context.warnings.push({ message, severity: 'warning' });
  }
}

/** Get the table module prefix based on context.mappingType */
function tableModule(context: TranspileContext): string {
  return context.mappingType === 'smart-table' ? 'smart_table' : 'table';
}

/** Get the full use-declaration path for the table module based on context.mappingType */
function tableModulePath(context: TranspileContext): string {
  return context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
}

/**
 * Mapping from error constant names to their appropriate std::error category function.
 * Used when errorCodeType === 'aptos-error-module' to wrap raw abort codes
 * in the canonical Aptos error encoding: error::category(reason).
 */
const ERROR_CATEGORY_MAP: Record<string, string> = {
  'E_UNAUTHORIZED': 'error::permission_denied',
  'E_INVALID_ARGUMENT': 'error::invalid_argument',
  'E_INSUFFICIENT_BALANCE': 'error::invalid_state',
  'E_REENTRANCY': 'error::invalid_state',
  'E_PAUSED': 'error::invalid_state',
  'E_NOT_PAUSED': 'error::invalid_state',
  'E_ALREADY_EXISTS': 'error::already_exists',
  'E_NOT_FOUND': 'error::not_found',
  'E_EXPIRED': 'error::invalid_state',
  'E_LOCKED': 'error::invalid_state',
  'E_INVALID_ADDRESS': 'error::invalid_argument',
  'E_INVALID_AMOUNT': 'error::invalid_argument',
  'E_TRANSFER_FAILED': 'error::aborted',
  'E_INSUFFICIENT_ALLOWANCE': 'error::invalid_state',
  'E_OVERFLOW': 'error::out_of_range',
  'E_UNDERFLOW': 'error::out_of_range',
  'E_DIVISION_BY_ZERO': 'error::out_of_range',
  'E_REVERT': 'error::aborted',
  'E_REQUIRE_FAILED': 'error::aborted',
  'E_ASSERT_FAILED': 'error::aborted',
};

/**
 * Wrap an error code identifier in an error::category() call when
 * errorCodeType === 'aptos-error-module'. Returns the raw identifier otherwise.
 *
 * @param errorName - The error constant name (e.g., 'E_UNAUTHORIZED')
 * @param context   - The transpile context (reads errorCodeType, writes usedModules)
 */
export function wrapErrorCode(errorName: string, context: TranspileContext): MoveExpression {
  // Ensure the error code is registered so a constant is generated
  if (!context.errorCodes) context.errorCodes = new Map();
  if (!context.errorCodes.has(errorName)) {
    context.errorCodes.set(errorName, {
      message: errorName.replace(/^E_/, '').replace(/_/g, ' ').toLowerCase(),
      code: context.errorCodes.size + 1,
    });
  }

  if (context.errorCodeType !== 'aptos-error-module') {
    return { kind: 'identifier', name: errorName };
  }
  context.usedModules.add('std::error');
  const category = ERROR_CATEGORY_MAP[errorName] || 'error::aborted';
  return {
    kind: 'call',
    function: category,
    args: [{ kind: 'identifier', name: errorName }],
  };
}

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
        name: vars.map((v: any, i: number) => v?.name ? v.name : `_unused${i}`),
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
      // Solidity unchecked blocks disable overflow/underflow checks.
      // Move always aborts on arithmetic overflow — there is no native wrapping mode.
      // When overflowBehavior is 'wrapping', we annotate the block with a comment
      // and emit a warning so the developer knows manual wrapping may be needed.
      return transformUncheckedBlock(stmt, context);

    default:
      warnOrError(context, `Unsupported statement type: ${(stmt as any).kind}`);
      return undefined;
  }
}

/**
 * Transform a Solidity unchecked block to Move statements.
 *
 * Move always aborts on arithmetic overflow — there is no native wrapping mode.
 * - overflowBehavior 'abort' (default): silently flatten the block (Move already checks).
 * - overflowBehavior 'wrapping': annotate the block with a comment so the developer
 *   knows the original Solidity code intended wrapping arithmetic, and emit a warning
 *   that manual wrapping patterns may be required for correctness.
 */
function transformUncheckedBlock(
  stmt: { statements: any[] },
  context: TranspileContext
): MoveStatement {
  const innerStatements = stmt.statements
    .map(s => transformStatement(s, context))
    .filter((s): s is MoveStatement => s !== undefined);

  if (context.overflowBehavior === 'wrapping') {
    // Emit a one-time warning per module (tracked via usedModules to avoid repeats)
    const warningKey = '__overflow_wrapping_warning';
    if (!(context as any)[warningKey]) {
      (context as any)[warningKey] = true;
      context.warnings.push({
        message: 'Wrapping arithmetic (Solidity unchecked block) is not natively supported in Move. ' +
                 'Move will abort on overflow. Consider using modular arithmetic patterns for correctness.',
        severity: 'warning',
      });
    }

    // Mark the wrapping-intent region with an inline comment.
    // Attach the comment to the first inner statement if it supports comments
    // (expression or abort kinds). Otherwise, prepend a no-op comment marker.
    const wrappingComment = 'Wrapping arithmetic (Solidity unchecked) — Move aborts on overflow; review for correctness';
    if (innerStatements.length > 0 && (innerStatements[0].kind === 'expression' || innerStatements[0].kind === 'abort')) {
      (innerStatements[0] as any).comment = wrappingComment;
    } else if (innerStatements.length > 0) {
      // Prepend a no-op expression statement carrying the comment
      innerStatements.unshift({
        kind: 'expression',
        expression: { kind: 'literal', type: 'bool', value: true },
        comment: wrappingComment,
      });
    }

    return {
      kind: 'block',
      statements: innerStatements,
    };
  }

  // Default ('abort'): Move already aborts on overflow, matching Solidity checked behavior.
  // Silently flatten the unchecked block — no special handling needed.
  return {
    kind: 'block',
    statements: innerStatements,
  };
}

/**
 * Transform variable declaration
 */
function transformVariableDeclaration(
  stmt: any,
  context: TranspileContext
): MoveStatement {
  const names = Array.isArray(stmt.name) ? stmt.name : [stmt.name];
  const pattern = names.length === 1 ? toSnakeCase(names[0]) : names.map((n: any) => {
    // Replace null/empty/numeric tuple elements with _ (Solidity ignored return values)
    if (n === null || n === undefined || n === '' || typeof n === 'number' || /^\d+$/.test(String(n))) {
      return '_';
    }
    return toSnakeCase(n);
  });

  // Track local variable types for type-aware transformations (e.g., bool-to-int fixes)
  if (stmt.type && names.length === 1) {
    context.localVariables.set(toSnakeCase(names[0]), stmt.type);
  }

  // Track table copy origins for write-back detection.
  // When a local is assigned from a mapping dereference (e.g., let pool = pools[id]),
  // record the mapping name and key so we can emit table::upsert after mutations.
  if (stmt.initialValue?.kind === 'index_access' && names.length === 1) {
    const baseName = stmt.initialValue.base?.kind === 'identifier' ? stmt.initialValue.base.name : null;
    const stateVar = baseName ? context.stateVariables.get(baseName) : null;
    if (stateVar?.isMapping && !isNestedMappingValue(stateVar)) {
      // Flat mapping: pools[id] → table::upsert(&mut state.pools, id, local)
      if (!(context as any)._tableCopyOrigins) (context as any)._tableCopyOrigins = new Map();
      (context as any)._tableCopyOrigins.set(toSnakeCase(names[0]), {
        mappingName: baseName,
        key: transformExpression(stmt.initialValue.index, context),
        mutated: false,
      });
    }

    // Nested mapping: positions[poolId][msg.sender]
    // AST: index_access { base: index_access { base: identifier("positions"), index: poolId }, index: msg.sender }
    if (!baseName && stmt.initialValue.base?.kind === 'index_access') {
      const outerAccess = stmt.initialValue.base;
      const outerBaseName = outerAccess.base?.kind === 'identifier' ? outerAccess.base.name : null;
      const outerStateVar = outerBaseName ? context.stateVariables.get(outerBaseName) : null;
      if (outerStateVar?.isMapping && isNestedMappingValue(outerStateVar)) {
        if (!(context as any)._tableCopyOrigins) (context as any)._tableCopyOrigins = new Map();
        (context as any)._tableCopyOrigins.set(toSnakeCase(names[0]), {
          mappingName: outerBaseName,
          outerKey: transformExpression(outerAccess.index, context),
          key: transformExpression(stmt.initialValue.index, context),
          nested: true,
          mutated: false,
        });
      }
    }
  }

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
  // Mark table copy origins as mutated when their fields are assigned.
  // e.g., pool.reserve0 += amount → marks 'pool' as mutated for write-back.
  if (stmt.target?.kind === 'member_access' && stmt.target.object?.kind === 'identifier') {
    const localName = toSnakeCase(stmt.target.object.name);
    const origins = (context as any)._tableCopyOrigins as Map<string, any> | undefined;
    const origin = origins?.get(localName);
    if (origin) origin.mutated = true;
  }

  // Check if the target is an index access (mapping/array) - use mutable borrow
  let target: any;
  if (stmt.target?.kind === 'index_access') {
    target = transformIndexAccessMutable(stmt.target, context);
  } else if (stmt.target?.kind === 'member_access') {
    // If the member_access contains a mapping index_access deeper in the tree
    // (e.g., pools[id].reserveA), use mutable borrow path
    if (targetContainsMappingIndexAccess(stmt.target, context)) {
      target = transformMemberAccessMutable(stmt.target, context);
    } else {
      target = transformExpression(stmt.target, context);
    }
  } else {
    target = transformExpression(stmt.target, context);
  }

  let value = transformExpression(stmt.value, context);

  // Handle event-trackable variables: emit events instead of state writes
  if (context.resourcePlan && context.optimizationLevel !== 'low' &&
      (stmt.operator === '+=' || stmt.operator === '-=')) {
    const evTargetName = extractTargetVarName(stmt.target);
    if (evTargetName && context.resourcePlan.eventTrackables?.has(evTargetName)) {
      const config = context.resourcePlan.eventTrackables.get(evTargetName)!;
      return {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'event::emit',
          module: 'aptos_framework::event',
          args: [{
            kind: 'struct',
            name: config.eventName,
            fields: [{ name: 'amount', value }],
          }],
        },
      };
    }
  }

  // Handle aggregator transforms for medium/high optimization.
  // Compound assignments (+=, -=) on aggregatable variables become
  // aggregator_v2::add() / aggregator_v2::sub() calls.
  if (context.resourcePlan && context.optimizationLevel !== 'low' &&
      (stmt.operator === '+=' || stmt.operator === '-=')) {
    const targetVarName = extractTargetVarName(stmt.target);
    if (targetVarName) {
      const analysis = findVariableAnalysis(context, targetVarName);
      if (analysis && analysis.category === 'aggregatable') {
        // Transform: state.total_supply += amount  →  aggregator_v2::add(&mut counters.total_supply, amount)
        const groupName = context.resourcePlan.varToGroup.get(targetVarName);
        const localObj = groupName ? groupNameToLocalVar(groupName) : 'state';
        const fieldName = toSnakeCase(targetVarName);
        const fieldRef: MoveExpression = {
          kind: 'field_access',
          object: { kind: 'identifier', name: localObj },
          field: fieldName,
        };
        const fnName = stmt.operator === '+=' ? 'add' : 'sub';
        // Aggregator<u128> requires u128 values; cast if original type is wider (u256)
        const moveType = analysis.variable.type?.move;
        const needsCast = moveType && moveType.kind === 'primitive' &&
          (moveType.name === 'u256' || moveType.name === 'u64');
        const castValue: MoveExpression = needsCast
          ? { kind: 'cast', value, targetType: { kind: 'primitive', name: 'u128' } }
          : value;
        return {
          kind: 'expression',
          expression: {
            kind: 'call',
            module: 'aggregator_v2',
            function: fnName,
            args: [
              { kind: 'borrow', mutable: true, value: fieldRef },
              castValue,
            ],
          },
        };
      }
    }
  }

  // Handle compound assignment
  let assignStmt: MoveStatement;
  if (stmt.operator && stmt.operator !== '=') {
    // For shift compound assignments, right operand must be u8 in Move
    if (stmt.operator === '<<=' || stmt.operator === '>>=') {
      value = castToU8ForShift(value);
    }
    assignStmt = {
      kind: 'assign',
      target,
      operator: stmt.operator as any,
      value,
    };
  } else {
    assignStmt = {
      kind: 'assign',
      target,
      value,
    };
  }

  // Drain pre-statements injected by nested mapping access patterns
  // (e.g., if (!table::contains(...)) { table::add(..., table::new()) })
  const preStmts = (context as any)._preStatements as MoveStatement[] | undefined;
  if (preStmts && preStmts.length > 0) {
    (context as any)._preStatements = [];
    return {
      kind: 'block',
      statements: [...preStmts, assignStmt],
    } as any;
  }

  return assignStmt;
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
    // Use harmonizeComparison to add casts for cross-type comparisons (e.g., u128 != u256)
    const right2 = transformExpression(condition.right, context);
    const newCondition = harmonizeComparison(condition.operator, target, right2, context);

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

    const left2 = transformExpression(condition.left, context);
    const newCondition = harmonizeComparison(condition.operator, left2, target, context);

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
 * Transform emit statement.
 * Respects the eventPattern context flag:
 * - 'native' (default): event::emit(EventStruct { ... })
 * - 'event-handle': event::emit_event(&mut borrow_global_mut<State>(@addr).event_events, EventStruct { ... })
 * - 'none': skip the statement entirely (returns undefined)
 */
function transformEmit(stmt: any, context: TranspileContext): MoveStatement | undefined {
  // 'none': strip event emissions entirely
  if (context.eventPattern === 'none') {
    return undefined;
  }

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

  const structExpr: MoveExpression = {
    kind: 'struct',
    name: stmt.event,
    fields,
  };

  // 'event-handle': emit via EventHandle stored in state struct
  if (context.eventPattern === 'event-handle') {
    context.usedModules.add('aptos_framework::account');
    const stateName = `${context.contractName}State`;
    const handleFieldName = `${toSnakeCase(stmt.event)}_events`;
    context.acquiredResources.add(stateName);

    // event::emit_event(&mut borrow_global_mut<State>(@module_addr).handle_events, EventStruct { ... })
    return {
      kind: 'expression',
      expression: {
        kind: 'call',
        function: 'event::emit_event',
        args: [
          {
            kind: 'borrow',
            mutable: true,
            value: {
              kind: 'field_access',
              object: {
                kind: 'call',
                function: `borrow_global_mut<${stateName}>`,
                args: [{ kind: 'identifier', name: `@${context.moduleAddress}` }],
              },
              field: handleFieldName,
            },
          },
          structExpr,
        ],
      },
    };
  }

  // 'native' (default): event::emit(EventStruct { ... })
  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'event::emit',
      args: [structExpr],
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
        wrapErrorCode('E_INVALID_ARGUMENT', context),
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
    code: wrapErrorCode(errorName, context),
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
      const result: MoveStatement = {
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
      // In abort-verbose mode, include original error message as comment
      if (context.errorStyle === 'abort-verbose' && expr.args[1]?.kind === 'literal' && expr.args[1]?.type === 'string') {
        result.comment = `require: "${expr.args[1].value}"`;
      }
      return result;
    }

    if (funcName === 'assert') {
      return {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'assert!',
          args: [
            transformExpression(expr.args[0], context),
            wrapErrorCode('E_ASSERT_FAILED', context),
          ],
        },
      };
    }

    // Handle revert() and revert(message)
    if (funcName === 'revert') {
      if (expr.args && expr.args.length > 0) {
        const errorCode = extractErrorCode(expr.args[0], context);
        const result: MoveStatement = {
          kind: 'abort',
          code: errorCode,
        };
        if (context.errorStyle === 'abort-verbose' && expr.args[0]?.kind === 'literal' && expr.args[0]?.type === 'string') {
          result.comment = `revert: "${expr.args[0].value}"`;
        }
        return result;
      }
      return {
        kind: 'abort',
        code: wrapErrorCode('E_REVERT', context),
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
    return wrapErrorCode('E_REQUIRE_FAILED', context);
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
        return wrapErrorCode(errorCode, context);
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
    return wrapErrorCode(constantName, context);
  }

  // If it's a custom error, convert to error code
  if (errorArg.kind === 'function_call') {
    const errorName = errorArg.function?.name || 'CustomError';
    const constantName = 'E_' + toScreamingSnakeCase(errorName);
    return wrapErrorCode(constantName, context);
  }

  return wrapErrorCode('E_REQUIRE_FAILED', context);
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

    case 'new': {
      // Standalone new expression (e.g., `new Type()`)
      // Array allocations are handled in transformFunctionCall when wrapped in FunctionCall
      const moveType = solidityTypeToMoveTypeName((expr as any).typeName || 'u256');
      context.usedModules.add('std::vector');
      return {
        kind: 'call',
        function: `vector::empty<${moveType}>`,
        args: [],
      };
    }

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
      const numResult: MoveExpression = {
        kind: 'literal',
        type: 'number',
        value,
        suffix,
      };
      if (suffix) setExprInferredType(numResult, suffixToMoveType(suffix));
      return numResult;

    case 'bool':
      const boolResult: MoveExpression = {
        kind: 'literal',
        type: 'bool',
        value: expr.value,
        inferredType: { kind: 'primitive', name: 'bool' },
      };
      return boolResult;

    case 'string':
      // In bytes mode, strings become raw byte vectors
      if (context.stringType === 'bytes') {
        return {
          kind: 'literal',
          type: 'bytestring',
          value: `b"${expr.value}"`,
          inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } },
        };
      }
      // Default: string::String with utf8 encoding
      context.usedModules.add('std::string');
      return {
        kind: 'call',
        function: 'string::utf8',
        args: [{
          kind: 'literal',
          type: 'bytestring',
          value: `b"${expr.value}"`,
        }],
        inferredType: { kind: 'struct', name: 'String', module: 'string' },
      };

    case 'hex':
      return {
        kind: 'literal',
        type: 'bytestring',
        value: `x"${String(expr.value).replace('0x', '')}"`,
        inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } },
      };

    case 'address':
      return {
        kind: 'literal',
        type: 'address',
        value: `@${expr.value}`,
        inferredType: { kind: 'primitive', name: 'address' },
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
      inferredType: { kind: 'primitive', name: 'address' },
    };
  }

  // Check if it's a constant - constants are accessed directly by their SCREAMING_SNAKE_CASE name
  if (context.constants?.has(expr.name)) {
    const constDef = context.constants.get(expr.name);
    const constType = constDef?.moveType || constDef?.type?.move;
    let result: MoveExpression = {
      kind: 'identifier',
      name: toScreamingSnakeCase(expr.name),
      inferredType: constType,
    };
    // String constants stored as vector<u8> — wrap with string::utf8() at usage
    if (constDef?.isStringConstant) {
      context.usedModules.add('std::string');
      result = {
        kind: 'call',
        function: 'string::utf8',
        args: [result],
        inferredType: { kind: 'struct', name: 'String', module: 'string' },
      };
    }
    return result;
  }

  // Check if it's a state variable (but not a constant)
  const stateVar = context.stateVariables.get(expr.name);
  if (stateVar && stateVar.mutability !== 'constant') {
    // Determine which local variable holds this state (multi-resource routing)
    let objectName = 'state';
    if (context.resourcePlan && context.optimizationLevel !== 'low') {
      const groupName = context.resourcePlan.varToGroup.get(expr.name);
      if (groupName) {
        objectName = groupNameToLocalVar(groupName);
      }
    }

    const fieldAccess: any = {
      kind: 'field_access',
      object: { kind: 'identifier', name: objectName },
      field: name,
    };
    // Set inferredType from state variable type for arithmetic harmonization
    if (stateVar.type?.move) {
      fieldAccess.inferredType = stateVar.type.move;
    }

    // For event-trackable variables: return 0 (value tracked off-chain via events)
    if (context.resourcePlan && context.optimizationLevel !== 'low' &&
        context.resourcePlan.eventTrackables?.has(expr.name)) {
      const config = context.resourcePlan.eventTrackables.get(expr.name)!;
      const zeroExpr: MoveExpression = { kind: 'literal', type: 'number', value: 0 };
      if (stateVar.type?.move) setExprInferredType(zeroExpr, stateVar.type.move);
      return zeroExpr;
    }

    // For aggregatable variables at medium+, wrap read in aggregator_v2::read() or snapshot pattern
    if (context.resourcePlan && context.optimizationLevel !== 'low') {
      const analysis = findVariableAnalysis(context, expr.name);
      if (analysis && analysis.category === 'aggregatable') {
        const borrowRef: MoveExpression = { kind: 'borrow', mutable: false, value: fieldAccess };

        // Use snapshot pattern when function both reads and writes aggregatable vars
        // (avoids sequential dependency with concurrent writes per AIP-47)
        const useSnapshot = context.currentFunction &&
          context.resourcePlan.snapshotEligibleFunctions?.has(context.currentFunction);

        let readExpr: MoveExpression;
        if (useSnapshot) {
          // aggregator_v2::read_snapshot(&aggregator_v2::snapshot(&group.field))
          const snapshotCall: MoveExpression = {
            kind: 'call',
            module: 'aggregator_v2',
            function: 'snapshot',
            args: [borrowRef],
          };
          readExpr = {
            kind: 'call',
            module: 'aggregator_v2',
            function: 'read_snapshot',
            args: [{ kind: 'borrow', mutable: false, value: snapshotCall }],
          };
        } else {
          readExpr = {
            kind: 'call',
            module: 'aggregator_v2',
            function: 'read',
            args: [borrowRef],
          };
        }

        // Aggregator<u128> returns u128; cast back to original type if needed (e.g., u256)
        const moveType = analysis.variable.type?.move;
        if (moveType && moveType.kind === 'primitive' &&
            (moveType.name === 'u256' || moveType.name === 'u64')) {
          readExpr = { kind: 'cast', value: readExpr, targetType: moveType };
        }
        if (stateVar.type?.move) setExprInferredType(readExpr, stateVar.type.move);
        return readExpr;
      }
    }

    if (stateVar.type?.move) setExprInferredType(fieldAccess, stateVar.type.move);
    return fieldAccess;
  }

  // Look up type from local variables
  const varType = lookupVariableType(name, context);
  return {
    kind: 'identifier',
    name,
    inferredType: varType,
  };
}

/**
 * Transform binary operation
 * Based on e2m's BinaryOp::calc patterns from reverse engineering
 */
function transformBinary(expr: any, context: TranspileContext): MoveExpression {
  // Try aggregator is_at_least() optimization for comparisons (medium+)
  // Must check BEFORE transforming operands to detect raw aggregatable identifiers
  if (context.resourcePlan && context.optimizationLevel !== 'low') {
    const isAtLeastResult = tryTransformAggregatorComparison(expr, context);
    if (isAtLeastResult) return isAtLeastResult;
  }

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
    const result: MoveExpression = {
      kind: 'call',
      function: 'math128::pow',
      args: [left, right],
      inferredType: getExprInferredType(left), // pow returns same type as base
    };
    return result;
  }

  // Move doesn't support bitwise ops on signed integers (i8-i256).
  // For bitwise ops with signed operands: cast to unsigned, perform op, cast back.
  const isBitwiseOp = ['&', '|', '^', '<<', '>>', '<<=', '>>='].includes(expr.operator);
  if (isBitwiseOp) {
    const leftType = getExprInferredType(left);
    const rightType = getExprInferredType(right);
    const leftSigned = isSignedType(leftType);

    if (leftSigned && leftType?.kind === 'primitive') {
      // Convert signed type name to unsigned (i256 → u256, i128 → u128, etc.)
      const unsignedName = leftType.name.replace('i', 'u') as any;
      const unsignedType = { kind: 'primitive' as const, name: unsignedName };

      // Cast left to unsigned
      const unsignedLeft: MoveExpression = { kind: 'cast', value: left, targetType: unsignedType, inferredType: unsignedType };

      // For shift ops, right operand is u8
      if (expr.operator === '<<' || expr.operator === '>>' || expr.operator === '<<=' || expr.operator === '>>=') {
        const castRight = castToU8ForShift(right);
        const bitwiseResult: MoveExpression = {
          kind: 'binary', operator: op as any,
          left: unsignedLeft, right: castRight,
          inferredType: unsignedType,
        };
        // Cast result back to signed
        return { kind: 'cast', value: bitwiseResult, targetType: leftType, inferredType: leftType };
      }

      // For &, |, ^ — cast both operands to unsigned
      let unsignedRight: MoveExpression = right;
      if (isSignedType(rightType) && rightType?.kind === 'primitive') {
        unsignedRight = { kind: 'cast', value: right, targetType: unsignedType, inferredType: unsignedType };
      }
      const bitwiseResult: MoveExpression = {
        kind: 'binary', operator: op as any,
        left: unsignedLeft, right: unsignedRight,
        inferredType: unsignedType,
      };
      // Cast result back to signed
      return { kind: 'cast', value: bitwiseResult, targetType: leftType, inferredType: leftType };
    }
  }

  // Shift operators: right operand must be u8 in Move
  // Also handles compound shift assignments (>>=, <<=) when they appear as binary expressions
  if (expr.operator === '<<' || expr.operator === '>>' || expr.operator === '<<=' || expr.operator === '>>=') {
    const castRight = castToU8ForShift(right);
    const result: MoveExpression = {
      kind: 'binary',
      operator: op as any,
      left,
      right: castRight,
      inferredType: getExprInferredType(left), // shift result is type of left operand
    };
    return result;
  }

  // Fix bool-to-int comparisons from Yul: iszero(bool_var) → (bool_var == 0u256)
  // In Move, comparing bool with u256 is a type error. Detect and fix:
  // (bool_var == 0) → !bool_var, (bool_var != 0) → bool_var
  if ((op === '==' || op === '!=') && isZeroLiteral(right)) {
    const leftType = getExprInferredType(left);
    if (isBoolType(leftType) || (left.kind === 'identifier' && isBoolVariable(left.name, context))) {
      if (op === '==') return { kind: 'unary', operator: '!', operand: left, inferredType: { kind: 'primitive', name: 'bool' } };
      return left; // != 0 on a bool is just the bool itself
    }
  }

  // optionalValues='option-type': transform zero-address comparisons to Option checks.
  // addr == address(0) → option::is_none(&addr)
  // addr != address(0) → option::is_some(&addr)
  if (context.optionalValues === 'option-type' && (op === '==' || op === '!=')) {
    const isLeftZeroAddr = isZeroAddress(left);
    const isRightZeroAddr = isZeroAddress(right);
    if (isLeftZeroAddr || isRightZeroAddr) {
      const addrExpr = isLeftZeroAddr ? right : left;
      const checkFn = op === '==' ? 'option::is_none' : 'option::is_some';
      context.usedModules.add('std::option');
      return {
        kind: 'call',
        function: checkFn,
        args: [{ kind: 'borrow', mutable: false, value: addrExpr }],
        inferredType: { kind: 'primitive', name: 'bool' },
      };
    }
  }

  // Type harmonization for comparisons: Move requires both operands to have the same type.
  // Upcast the narrower operand to the wider type.
  // e.g., (y:u128 != x:u256) → ((y as u256) != x)
  if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
    // Try new inferredType-based harmonization first, then fall back to context-based
    const leftType = getExprInferredType(left);
    const rightType = getExprInferredType(right);
    if (leftType && rightType) {
      const harmonized = harmonizeComparisonTypes(left, right);
      const result: MoveExpression = {
        kind: 'binary',
        operator: op as any,
        left: harmonized.left,
        right: harmonized.right,
        inferredType: { kind: 'primitive', name: 'bool' },
      };
      return result;
    }
    // Fall back to old context-based harmonization
    return harmonizeComparison(op, left, right, context);
  }

  // Arithmetic/bitwise type harmonization: Move requires both operands to have the same type.
  // Upcast the narrower operand to the wider type (mirrors comparison harmonization above).
  if (['+', '-', '*', '/', '%', '&', '|', '^'].includes(op)) {
    const leftType = getExprInferredType(left);
    const rightType = getExprInferredType(right);
    if (leftType && rightType) {
      const harmonized = harmonizeComparisonTypes(left, right);
      const resultType = inferBinaryResultType(op, getExprInferredType(harmonized.left), getExprInferredType(harmonized.right));
      return {
        kind: 'binary',
        operator: op as any,
        left: harmonized.left,
        right: harmonized.right,
        inferredType: resultType,
      };
    }
  }

  // Infer type for remaining operations (shift, or when types can't be harmonized)
  const resultType = inferBinaryResultType(op, getExprInferredType(left), getExprInferredType(right));
  return {
    kind: 'binary',
    operator: op as any,
    left,
    right,
    inferredType: resultType,
  };
}

function isZeroLiteral(expr: any): boolean {
  return expr?.kind === 'literal' && expr?.type === 'number' && (expr?.value === 0 || expr?.value === '0');
}

/**
 * Check if an expression represents a zero/null address.
 * Detects both sentinel form (@0x0 literal) and option-type form (option::none<address>() call).
 * Used by the optionalValues='option-type' transformation.
 */
function isZeroAddress(expr: MoveExpression): boolean {
  // Sentinel form: @0x0 address literal
  if (expr.kind === 'literal' && (expr as any).type === 'address') {
    const val = String((expr as any).value);
    return val === '@0x0' || val === '@0x0000000000000000000000000000000000000000';
  }
  // Option-type form: option::none<address>() call (already transformed by transformTypeConversion)
  if (expr.kind === 'call' && (expr as any).function === 'option::none') {
    return true;
  }
  return false;
}

function isBoolVariable(name: string, context: TranspileContext): boolean {
  // Check localVariables
  const varType = context.localVariables?.get(name);
  if (varType && (varType.solidity === 'bool' || (varType.move?.kind === 'primitive' && varType.move.name === 'bool'))) return true;
  // Check stateVariables
  const stateVar = context.stateVariables?.get(name);
  if (stateVar?.type?.solidity === 'bool' || stateVar?.type?.move?.kind === 'primitive' && (stateVar?.type?.move as any)?.name === 'bool') return true;
  return false;
}

/**
 * Get the integer bit width of an expression, using context for type inference.
 * Returns positive for unsigned (8, 16, 32, 64, 128, 256),
 * negative for signed (-8, -16, ..., -256), or undefined if unknown.
 */
const INT_WIDTHS: Record<string, number> = {
  'u8': 8, 'u16': 16, 'u32': 32, 'u64': 64, 'u128': 128, 'u256': 256,
  'i8': -8, 'i16': -16, 'i32': -32, 'i64': -64, 'i128': -128, 'i256': -256,
};

function getIntegerWidth(expr: any, context: TranspileContext): number | undefined {
  // First check inferredType (from the new type inference system)
  const inferred = getExprInferredType(expr);
  if (inferred) {
    const w = getTypeWidth(inferred);
    if (w !== undefined) return w;
  }
  // Identifier: look up in localVariables
  if (expr.kind === 'identifier') {
    const varType = context.localVariables?.get(expr.name);
    if (varType?.move?.kind === 'primitive' && varType.move.name) return INT_WIDTHS[varType.move.name];
  }
  // Cast expression: use the target type
  if (expr.kind === 'cast' && expr.targetType?.name) {
    return INT_WIDTHS[expr.targetType.name];
  }
  // Function call: check signature registry
  if (expr.kind === 'call' && expr.function && context.functionSignatures) {
    const sig = context.functionSignatures.get(expr.function);
    if (sig?.returnType && !Array.isArray(sig.returnType)) {
      const w = getTypeWidth(sig.returnType);
      if (w !== undefined) return w;
    }
  }
  return undefined;
}

/**
 * Harmonize types for comparison expressions.
 * If operands are different-width integers, upcast the narrower one.
 * Returns a binary expression with the correct types.
 */
function harmonizeComparison(op: string, left: any, right: any, context: TranspileContext): any {
  const boolType = { kind: 'primitive', name: 'bool' };
  const leftWidth = getIntegerWidth(left, context);
  const rightWidth = getIntegerWidth(right, context);
  if (leftWidth !== undefined && rightWidth !== undefined && leftWidth !== rightWidth) {
    const leftSigned = leftWidth < 0;
    const rightSigned = rightWidth < 0;
    const absLeft = Math.abs(leftWidth);
    const absRight = Math.abs(rightWidth);
    if (leftSigned === rightSigned && absLeft !== absRight) {
      const widerType: any = { kind: 'primitive', name: `${leftSigned ? 'i' : 'u'}${Math.max(absLeft, absRight)}` };
      if (absLeft < absRight) {
        return { kind: 'binary', operator: op, left: { kind: 'cast', value: left, targetType: widerType, inferredType: widerType }, right, inferredType: boolType };
      } else {
        return { kind: 'binary', operator: op, left, right: { kind: 'cast', value: right, targetType: widerType, inferredType: widerType }, inferredType: boolType };
      }
    }
  }
  return { kind: 'binary', operator: op, left, right, inferredType: boolType };
}

/**
 * Transform delete expression to table::remove or default reset
 */
function transformDeleteExpression(operand: any, context: TranspileContext): MoveExpression {
  // delete mapping[key] → table::remove(&mut state.mapping, key)
  if (operand.kind === 'index_access') {
    const baseName = operand.base?.kind === 'identifier' ? operand.base.name : null;
    const stateVar = baseName ? context.stateVariables.get(baseName) : null;
    if (stateVar?.isMapping) {
      const base = transformExpression(operand.base, context);
      const index = transformExpression(operand.index, context);
      context.usedModules.add(tableModulePath(context));
      return {
        kind: 'call',
        function: `${tableModule(context)}::remove`,
        args: [
          { kind: 'borrow', mutable: true, value: base },
          index,
        ],
      };
    }
    // Nested mapping: delete mapping[k1][k2]
    if (operand.base?.kind === 'index_access') {
      const outerMut = transformIndexAccessMutable(operand.base, context);
      const innerIndex = transformExpression(operand.index, context);
      context.usedModules.add(tableModulePath(context));
      return {
        kind: 'call',
        function: `${tableModule(context)}::remove`,
        args: [
          { kind: 'borrow', mutable: true, value: outerMut },
          innerIndex,
        ],
      };
    }
  }
  // Fallback: warn and emit a no-op
  warnOrError(context, 'delete on non-mapping target replaced with no-op');
  return { kind: 'literal', type: 'bool', value: true };
}

/**
 * Transform unary operation
 */
function transformUnary(expr: any, context: TranspileContext): MoveExpression {
  // Handle delete operator — must be before transforming operand
  if (expr.operator === 'delete') {
    return transformDeleteExpression(expr.operand, context);
  }

  const operand = transformExpression(expr.operand, context);

  const operandType = getExprInferredType(operand);

  // Handle increment/decrement
  if (expr.operator === '++') {
    return {
      kind: 'binary',
      operator: '+',
      left: operand,
      right: { kind: 'literal', type: 'number', value: 1 },
      inferredType: operandType,
    };
  }

  if (expr.operator === '--') {
    return {
      kind: 'binary',
      operator: '-',
      left: operand,
      right: { kind: 'literal', type: 'number', value: 1 },
      inferredType: operandType,
    };
  }

  // `!` always returns bool, `-` returns same as operand
  const unaryType = expr.operator === '!' ? { kind: 'primitive' as const, name: 'bool' as const } : operandType;
  return {
    kind: 'unary',
    operator: expr.operator as any,
    operand,
    inferredType: unaryType,
  };
}

/**
 * Transform function call
 * Enhanced with EVM built-in function support based on e2m patterns
 */
function transformFunctionCall(expr: any, context: TranspileContext): MoveExpression {
  const args = (expr.args || []).map((a: any) => transformExpression(a, context));

  // Handle `new Type[](length)` → vector::empty<MoveType>()
  // Solidity array allocations: Move vectors are dynamic, no pre-allocation needed
  if (expr.function?.kind === 'new') {
    const typeName: string = expr.function.typeName || 'unknown';
    const moveElementType = solidityTypeToMoveTypeName(typeName);
    context.usedModules.add('std::vector');
    return {
      kind: 'call',
      function: `vector::empty<${moveElementType}>`,
      args: [],
      inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: moveElementType as any } },
    };
  }

  // Handle special functions
  if (expr.function?.kind === 'identifier') {
    const name = expr.function.name;

    // keccak256 -> aptos_hash::keccak256, wrapped with bytes_to_u256 for u256 result
    // In Solidity, keccak256 returns bytes32 (mapped to u256).
    // In Move, aptos_hash::keccak256 returns vector<u8>.
    // Wrap with evm_compat::bytes_to_u256 for big-endian u256 conversion (matches EVM semantics).
    if (name === 'keccak256') {
      context.usedModules.add('aptos_std::aptos_hash');
      context.usedModules.add('transpiler::evm_compat');
      const hashCall: MoveExpression = {
        kind: 'call',
        function: 'aptos_hash::keccak256',
        args,
        inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } },
      };
      return {
        kind: 'call',
        function: 'evm_compat::bytes_to_u256',
        args: [hashCall],
        inferredType: { kind: 'primitive', name: 'u256' },
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
      warnOrError(context, 'gasleft() has no equivalent in Move, using max u64');
      return {
        kind: 'literal',
        type: 'number',
        value: '18446744073709551615',
        suffix: 'u64',
      };
    }

    // blockhash(blockNumber) - not supported
    if (name === 'blockhash') {
      warnOrError(context, 'blockhash() has no equivalent in Move');
      return {
        kind: 'call',
        function: 'vector::empty',
        args: [],
      };
    }

    // ecrecover - not directly available
    if (name === 'ecrecover') {
      warnOrError(context, 'ecrecover() needs custom cryptographic implementation');
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

    // Handle abi.* calls (encode, encodePacked, encodeWithSelector, decode)
    // In Move, ABI encoding doesn't exist. Use bcs::to_bytes for serialization.
    if (expr.function.object?.kind === 'identifier' && expr.function.object.name === 'abi') {
      context.usedModules.add('aptos_std::bcs');

      if (method === 'encodeWithSelector') {
        // abi.encodeWithSelector(Interface.method.selector, arg1, arg2, ...)
        // Skip the selector (first arg), serialize remaining data args
        const dataArgs = args.slice(1);
        if (dataArgs.length === 1) {
          return {
            kind: 'call',
            function: 'bcs::to_bytes',
            args: [{ kind: 'borrow', mutable: false, value: dataArgs[0] }],
          };
        }
        // Multiple data args — serialize and concatenate
        if (dataArgs.length >= 2) {
          context.usedModules.add('std::vector');
          context.usedModules.add('aptos_std::bcs');
          const statements: any[] = [];
          statements.push({
            kind: 'let', pattern: '__bytes', mutable: true,
            value: { kind: 'call', function: 'bcs::to_bytes', args: [{ kind: 'borrow', mutable: false, value: dataArgs[0] }] },
          });
          for (let i = 1; i < dataArgs.length; i++) {
            statements.push({
              kind: 'expression',
              expression: {
                kind: 'call', function: 'vector::append',
                args: [
                  { kind: 'borrow', mutable: true, value: { kind: 'identifier', name: '__bytes' } },
                  { kind: 'call', function: 'bcs::to_bytes', args: [{ kind: 'borrow', mutable: false, value: dataArgs[i] }] },
                ],
              },
            });
          }
          return {
            kind: 'block_expr', statements,
            value: { kind: 'identifier', name: '__bytes' },
            inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } },
          };
        }
        // Zero data args fallback
        context.usedModules.add('std::vector');
        return {
          kind: 'call',
          function: 'vector::empty',
          typeArgs: [{ kind: 'primitive', name: 'u8' }],
          args: [],
        };
      }

      if (method === 'encode' || method === 'encodePacked') {
        if (args.length === 1) {
          return {
            kind: 'call',
            function: 'bcs::to_bytes',
            args: [{ kind: 'borrow', mutable: false, value: args[0] }],
            inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } },
          };
        }
        if (args.length >= 2) {
          // Multi-arg: serialize each and concatenate via block expression
          context.usedModules.add('std::vector');
          context.usedModules.add('aptos_std::bcs');
          const statements: any[] = [];
          // let __bytes = bcs::to_bytes(&arg0);
          statements.push({
            kind: 'let',
            pattern: '__bytes',
            mutable: true,
            value: {
              kind: 'call',
              function: 'bcs::to_bytes',
              args: [{ kind: 'borrow', mutable: false, value: args[0] }],
            },
          });
          // vector::append(&mut __bytes, bcs::to_bytes(&argN)) for remaining
          for (let i = 1; i < args.length; i++) {
            statements.push({
              kind: 'expression',
              expression: {
                kind: 'call',
                function: 'vector::append',
                args: [
                  { kind: 'borrow', mutable: true, value: { kind: 'identifier', name: '__bytes' } },
                  { kind: 'call', function: 'bcs::to_bytes', args: [{ kind: 'borrow', mutable: false, value: args[i] }] },
                ],
              },
            });
          }
          return {
            kind: 'block_expr',
            statements,
            value: { kind: 'identifier', name: '__bytes' },
            inferredType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } },
          };
        }
        // Zero args fallback
        context.usedModules.add('std::vector');
        return {
          kind: 'call',
          function: 'vector::empty',
          typeArgs: [{ kind: 'primitive', name: 'u8' }],
          args: [],
        };
      }

      if (method === 'decode') {
        // abi.decode(data, (Type)) → bcs::from_bytes(data)
        if (args.length >= 1) {
          return {
            kind: 'call',
            function: 'bcs::from_bytes',
            args: [args[0]],
          };
        }
      }

      // Fallback for any other abi.* method
      return {
        kind: 'call',
        function: 'bcs::to_bytes',
        args,
      };
    }

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
        const qualifiedName = `${moduleName}::${toSnakeCase(method)}`;
        const callExpr: MoveExpression = {
          kind: 'call',
          function: qualifiedName,
          args,
        };
        // Look up return type from signature registry
        if (context.functionSignatures) {
          const sig = context.functionSignatures.get(qualifiedName);
          if (sig?.returnType) {
            const retType = Array.isArray(sig.returnType) ? sig.returnType[0] : sig.returnType;
            setExprInferredType(callExpr, retType);
          }
        }
        return callExpr;
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
        inferredType: { kind: 'primitive', name: 'u64' },
      };
    }

    // Collection methods for OpenZeppelin EnumerableSet/EnumerableMap types
    // Determine if obj is a table (mapping) or vector (set/array) based on type info
    if (['contains', 'add', 'remove', 'get', 'set', 'at', 'keys', 'values'].includes(method)) {
      const objIsTable = isTableType(obj, context);

      if (method === 'contains') {
        if (objIsTable) {
          context.usedModules.add(tableModulePath(context));
          return {
            kind: 'call',
            function: `${tableModule(context)}::contains`,
            args: [{ kind: 'borrow', mutable: false, value: obj }, ...args],
          };
        } else {
          context.usedModules.add('std::vector');
          return {
            kind: 'call',
            function: 'vector::contains',
            args: [{ kind: 'borrow', mutable: false, value: obj }, { kind: 'borrow', mutable: false, value: args[0] }],
          };
        }
      }

      if (method === 'add') {
        if (objIsTable) {
          context.usedModules.add(tableModulePath(context));
          return {
            kind: 'call',
            function: `${tableModule(context)}::add`,
            args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
          };
        } else {
          context.usedModules.add('std::vector');
          return {
            kind: 'call',
            function: 'vector::push_back',
            args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
          };
        }
      }

      if (method === 'remove') {
        if (objIsTable) {
          context.usedModules.add(tableModulePath(context));
          return {
            kind: 'call',
            function: `${tableModule(context)}::remove`,
            args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
          };
        } else {
          context.usedModules.add('std::vector');
          return {
            kind: 'call',
            function: 'vector::remove_value',
            args: [{ kind: 'borrow', mutable: true, value: obj }, { kind: 'borrow', mutable: false, value: args[0] }],
          };
        }
      }

      if (method === 'get') {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'dereference',
          value: {
            kind: 'call',
            function: `${tableModule(context)}::borrow`,
            args: [{ kind: 'borrow', mutable: false, value: obj }, ...args],
          },
        };
      }

      if (method === 'set') {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'call',
          function: `${tableModule(context)}::upsert`,
          args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
        };
      }

      if (method === 'at') {
        if (objIsTable) {
          context.usedModules.add(tableModulePath(context));
          // EnumerableMap.at(index) returns (key, value) tuple — approximate with table access
          return {
            kind: 'dereference',
            value: {
              kind: 'call',
              function: `${tableModule(context)}::borrow`,
              args: [{ kind: 'borrow', mutable: false, value: obj }, ...args],
            },
          };
        } else {
          context.usedModules.add('std::vector');
          return {
            kind: 'dereference',
            value: {
              kind: 'call',
              function: 'vector::borrow',
              args: [{ kind: 'borrow', mutable: false, value: obj }, castToU64IfNeeded(args[0])],
            },
          };
        }
      }

      if (method === 'keys' || method === 'values') {
        // EnumerableMap.keys()/values() — no direct Move equivalent
        // Return the collection itself as an approximation
        return obj;
      }
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
          { kind: 'identifier', name: signerName(context) },
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
          { kind: 'identifier', name: signerName(context) },
          obj,
          args[0] || { kind: 'literal', type: 'number', value: 0 },
        ],
      };
    }

    if (method === 'call') {
      warnOrError(context, 'Low-level call() not supported - use direct module calls');
      return {
        kind: 'tuple',
        elements: [
          { kind: 'literal', type: 'bool', value: true },
          { kind: 'call', function: 'vector::empty', args: [] },
        ],
      };
    }

    if (method === 'delegatecall') {
      warnOrError(context, 'UNSUPPORTED: delegatecall cannot be transpiled to Move - Move has no execution context switching. Consider using the capability pattern instead.');
      return {
        kind: 'tuple',
        elements: [
          { kind: 'literal', type: 'bool', value: false },
          { kind: 'call', function: 'vector::empty', args: [] },
        ],
      };
    }

    if (method === 'staticcall') {
      warnOrError(context, 'staticcall not directly supported - all Move view functions are static');
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

  if (funcName && funcName !== 'unknown') {
    const originalName = expr.function?.name;
    if (originalName) {
      const internalInfo = getInternalFunctionCallInfo(originalName, context);
      if (internalInfo) {
        // Internal helper needs signer/address propagated as the first argument.
        if (internalInfo.signerParamKind !== 'none') {
          const signerArg = buildSignerArgForInternalCall(internalInfo.signerParamKind, context);
          if (signerArg) args.unshift(signerArg);
        }
        // Internal helper accesses state via trailing `state` parameter.
        if (internalInfo.accessesState) {
          args.push({ kind: 'identifier', name: 'state' });
        }
      }
    }
  }

  // In strict mode, surface unresolved direct identifier calls at transpile time.
  if (expr.function?.kind === 'identifier' && funcName && !isKnownCallable(funcName, context)) {
    warnOrError(context, `Unresolved function call: ${funcName}`);
  }

  // Look up return type from function signature registry
  // If function name couldn't be resolved, generate a compilable stub
  let resolvedFuncName = funcName;
  if (!resolvedFuncName) {
    // Try to extract a meaningful name from the transformed expression
    if (funcExpr?.kind === 'call') {
      resolvedFuncName = typeof funcExpr.function === 'string' ? funcExpr.function : undefined;
    } else if (funcExpr?.kind === 'field_access') {
      resolvedFuncName = (funcExpr as any).field;
    }
    // Final fallback: produce a no-op that's clearly marked as unresolvable
    if (!resolvedFuncName) {
      resolvedFuncName = 'evm_compat::stub';
      warnOrError(context, 'Unresolvable function call replaced with evm_compat::stub');
    }
  }
  const callResult: MoveExpression = {
    kind: 'call',
    function: resolvedFuncName,
    args,
  };
  if (funcName && context.functionSignatures) {
    const sig = context.functionSignatures.get(funcName);
    if (sig?.returnType) {
      const retType = Array.isArray(sig.returnType) ? sig.returnType[0] : sig.returnType;
      setExprInferredType(callResult, retType);
    }
  }
  return callResult;
}

/**
 * Transform member access
 * Handles enum variant access (EnumName.Variant -> EnumName::Variant)
 */
function transformMemberAccess(expr: any, context: TranspileContext): MoveExpression {
  // Check if this is an enum variant access
  if (expr.object?.kind === 'identifier' && context.enums?.has(expr.object.name)) {
    if (context.enumStyle === 'u8-constants') {
      // u8-constants mode: EnumName.Variant -> ENUM_NAME_VARIANT constant
      const constName = `${toScreamingSnakeCase(expr.object.name)}_${toScreamingSnakeCase(expr.member)}`;
      return {
        kind: 'identifier',
        name: constName,
      };
    }
    // native-enum mode (default): EnumName.Variant -> EnumName::Variant
    return {
      kind: 'identifier',
      name: `${expr.object.name}::${expr.member}`,
    };
  }

  // Handle cross-module constant references like constants.BASIS_POINT_MAX or encoded.MASK_UINT16
  // In Solidity, libraries can reference constants from other libraries via LibName.CONSTANT
  // In Move, constants are module-private, so we copy them into the current module
  // Also match _UNDERSCORE_PREFIXED constants (Solidity internal constants)
  if (expr.object?.kind === 'identifier' && /^_?[A-Z][A-Z0-9_]*$/.test(expr.member)) {
    const libName = expr.object.name;
    // Strip leading underscores from Solidity internal constant names
    const constName = expr.member.replace(/^_+/, '');
    // Track this as an imported constant so the contract transformer can copy it
    if (!(context as any).importedConstants) {
      (context as any).importedConstants = new Map<string, { source: string; name: string }>();
    }
    (context as any).importedConstants.set(constName, { source: libName, name: expr.member });
    // Emit as just the constant name (will be defined in this module)
    return { kind: 'identifier', name: constName };
  }

  // Handle .selector property (EVM function selector - no Move equivalent)
  // Interface.method.selector → 0u32 placeholder (selectors don't exist in Move)
  if (expr.member === 'selector') {
    return { kind: 'literal', type: 'number', value: '0', suffix: 'u32' };
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

  // When accessing a field on a table borrow result (e.g., pools[poolId].initialized),
  // Move doesn't support chaining .field on function call results.
  // Dereference the borrow to get a local copy, then access the field.
  // The index_access transformer wraps borrow calls in dereference: dereference(call(...))
  // We need to detect both: direct call or dereference(call).
  const innerCall = obj.kind === 'dereference' ? obj.value : obj;
  const isBorrowCall = innerCall?.kind === 'call' &&
    typeof innerCall.function === 'string' &&
    (innerCall.function.includes('::borrow_with_default') || innerCall.function.includes('::borrow'));
  // If it's already a dereference(borrow(...)), use the dereference as-is (produces *borrow(...))
  // If it's a direct borrow call, wrap in dereference
  const effectiveObj = isBorrowCall
    ? (obj.kind === 'dereference' ? obj : { kind: 'dereference' as const, value: obj })
    : obj;

  const result: any = {
    kind: 'field_access',
    object: effectiveObj,
    field: toSnakeCase(expr.member),
  };

  // Try to infer the field type from struct definitions
  // This enables type harmonization for arithmetic on struct fields (e.g., pool.fee_override_bps)
  const objName = expr.object?.kind === 'identifier' ? expr.object.name : null;
  if (objName && context.structs) {
    // Look up the local variable type to find the struct name
    const localType = context.localVariables?.get(toSnakeCase(objName));
    const structName = localType?.structName || (localType?.move as any)?.name;
    if (structName) {
      const structDef = context.structs.get(structName);
      if (structDef) {
        const fieldDef = structDef.fields.find((f: any) => f.name === expr.member);
        if (fieldDef?.type?.move) {
          result.inferredType = fieldDef.type.move;
        }
      }
    }
  }

  return result;
}

/**
 * Transform index access (mapping/array access)
 * Based on e2m's StorageOp::handle patterns for SLOAD/SSTORE
 */
function transformIndexAccess(expr: any, context: TranspileContext): MoveExpression {
  const base = transformExpression(expr.base, context);
  const index = transformExpression(expr.index, context);

  // Per-user resource reads (high optimization): mapping[addr] → per-user resource field
  if (expr.base?.kind === 'identifier' && context.optimizationLevel === 'high') {
    const perUser = findPerUserField(context, expr.base.name);
    if (perUser) {
      context.usedModules.add('std::signer');
      // Generate: if (exists<UserState>(addr)) { borrow_global<UserState>(addr).field } else { default }
      const addrExpr = index; // The index is the address
      const existsCall: MoveExpression = {
        kind: 'call',
        function: `exists<${perUser.structName}>`,
        args: [addrExpr],
      };
      const borrowField: MoveExpression = {
        kind: 'field_access',
        object: {
          kind: 'call',
          function: 'borrow_global',
          typeArgs: [{ kind: 'struct', name: perUser.structName }],
          args: [addrExpr],
        },
        field: perUser.fieldName,
      };
      const defaultExpr: MoveExpression = { kind: 'literal', type: 'number', value: 0 };
      return {
        kind: 'if_expr',
        condition: existsCall,
        thenExpr: borrowField,
        elseExpr: defaultExpr,
      };
    }
  }

  // Check if base is a state variable mapping
  if (expr.base?.kind === 'identifier') {
    const stateVar = context.stateVariables.get(expr.base.name);
    if (stateVar?.isMapping) {
      context.usedModules.add(tableModulePath(context));

      // Nested mapping: value type is Table (no 'drop' ability).
      // Can't use borrow_with_default; use table::borrow (caller handles missing key).
      if (isNestedMappingValue(stateVar)) {
        return {
          kind: 'call',
          function: `${tableModule(context)}::borrow`,
          args: [
            { kind: 'borrow', mutable: false, value: base },
            index,
          ],
        };
      }

      // Use table::borrow_with_default for safe access
      // Solidity mappings return 0/false/address(0) for missing keys
      const defaultValue = getDefaultForMappingValue(stateVar, context);
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: `${tableModule(context)}::borrow_with_default`,
          args: [
            { kind: 'borrow', mutable: false, value: base },
            index,
            { kind: 'borrow', mutable: false, value: defaultValue },
          ],
        },
      };
    }
  }

  // Check if base is a local variable with mapping type (e.g., assigned from a nested mapping access)
  if (expr.base?.kind === 'identifier') {
    const localType = context.localVariables.get(toSnakeCase(expr.base.name));
    if (localType?.isMapping) {
      context.usedModules.add(tableModulePath(context));
      const defaultValue = getDefaultForMappingValue(localType, context);
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: `${tableModule(context)}::borrow_with_default`,
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
    context.usedModules.add(tableModulePath(context));

    // Nested table access - outerAccess is already a &Table from table::borrow,
    // so pass it directly without wrapping in another & borrow
    const innerTableArg = (outerAccess as any).kind === 'call' &&
      ((outerAccess as any).function || '').includes('::borrow')
      ? outerAccess  // Already returns &Table — don't wrap
      : { kind: 'borrow' as const, mutable: false, value: outerAccess };

    // Resolve the inner table's VALUE type to decide: borrow vs borrow_with_default
    // For mapping(K1 => mapping(K2 => V)), the inner table is Table<K2, V>.
    // If V is another mapping, use borrow (no drop); otherwise use borrow_with_default.
    const rootBase = expr.base?.base;
    const rootStateVar = rootBase?.kind === 'identifier' ? context.stateVariables.get(rootBase.name) : null;
    const innerMappingType = rootStateVar?.mappingValueType; // mapping(K2 => V)
    const leafValueType = innerMappingType?.valueType; // V
    const leafIsMapping = leafValueType?.isMapping;

    if (leafIsMapping) {
      // Leaf is yet another table — can't use borrow_with_default (no drop)
      return {
        kind: 'call',
        function: `${tableModule(context)}::borrow`,
        args: [innerTableArg, index],
      };
    }

    // Leaf value has drop: use borrow_with_default for safe access, with dereference to copy
    const defaultValue = leafValueType
      ? getDefaultForMappingValue({ mappingValueType: leafValueType, valueType: leafValueType, type: leafValueType }, context)
      : { kind: 'literal', type: 'number', value: 0, suffix: 'u256' } as MoveExpression;

    return {
      kind: 'dereference',
      value: {
        kind: 'call',
        function: `${tableModule(context)}::borrow_with_default`,
        args: [
          innerTableArg,
          index,
          { kind: 'borrow' as const, mutable: false, value: defaultValue },
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
 * Check if an expression refers to a Table type (mapping) vs a vector (array/set).
 * Used to distinguish between table:: and vector:: operations for collection methods.
 */
function isTableType(expr: MoveExpression, context: TranspileContext): boolean {
  if (expr.kind === 'identifier') {
    const name = (expr as any).name;
    // Check state variables
    const stateVar = context.stateVariables.get(name);
    if (stateVar?.isMapping) return true;
    // Check local variables
    const localType = context.localVariables.get(name);
    if (localType?.isMapping) return true;
  }
  // Check if it's a field_access on state (e.g., state.presets)
  if (expr.kind === 'field_access' || (expr as any).kind === 'member_access') {
    const fieldExpr = expr as any;
    if (fieldExpr.object?.kind === 'identifier' && fieldExpr.object.name === 'state') {
      const fieldName = fieldExpr.member || fieldExpr.field;
      // Look up the state variable by its field name (snake_case)
      for (const [name, stateVar] of context.stateVariables) {
        if (toSnakeCase(name) === fieldName && stateVar.isMapping) return true;
      }
    }
  }
  return false;
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
  // Support both state variables (mappingValueType) and IRType (valueType)
  const irValueType = stateVar.mappingValueType || stateVar.valueType;
  const valueType = irValueType?.move;
  if (!valueType) {
    return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
  }

  return getDefaultForMoveType(valueType, irValueType, context);
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
      if (moveType.name === 'address') {
        // optionalValues='option-type': default address → option::none<address>()
        if (context.optionalValues === 'option-type') {
          context.usedModules.add('std::option');
          return {
            kind: 'call',
            function: 'option::none',
            typeArgs: [{ kind: 'primitive', name: 'address' }],
            args: [],
            inferredType: { kind: 'struct', name: 'Option', module: 'option', typeArgs: [{ kind: 'primitive', name: 'address' }] },
          };
        }
        return { kind: 'literal', type: 'address', value: '@0x0' };
      }
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
 * Check if a state variable's mapping value type is itself a mapping (Table).
 * For nested mappings like mapping(K => mapping(K2 => V)), the outer mapping's
 * value type is Table<K2, V>, which doesn't have 'drop' and can't be used with
 * borrow_with_default / borrow_mut_with_default.
 */
function isNestedMappingValue(stateVar: any): boolean {
  const valueType = stateVar.mappingValueType || stateVar.valueType;
  if (!valueType) return false;
  return valueType.isMapping === true;
}

/**
 * Check if an assignment target expression tree contains a mapping index_access.
 * Used to decide whether to use mutable borrow paths for member_access targets
 * like `pools[id].reserveA += amount`.
 */
function targetContainsMappingIndexAccess(expr: any, context: TranspileContext): boolean {
  if (!expr) return false;
  if (expr.kind === 'index_access') {
    if (expr.base?.kind === 'identifier') {
      const stateVar = context.stateVariables.get(expr.base.name);
      if (stateVar?.isMapping) return true;
      const localName = toSnakeCase(expr.base.name);
      const localInfo = context.localVariables.get(localName);
      if (localInfo?.isMapping) return true;
    }
    return targetContainsMappingIndexAccess(expr.base, context);
  }
  if (expr.kind === 'member_access') {
    return targetContainsMappingIndexAccess(expr.object, context);
  }
  return false;
}

/**
 * Transform member_access expression for mutable assignment targets.
 * When the inner object contains a mapping index_access, uses borrow_mut
 * instead of the default immutable borrow.
 * Example: `pools[id].reserveA` → `table::borrow_mut_with_default(...).reserveA`
 */
function transformMemberAccessMutable(expr: any, context: TranspileContext): MoveExpression {
  let obj: MoveExpression;
  if (expr.object?.kind === 'index_access') {
    // Use mutable borrow path for the inner index_access
    obj = transformIndexAccessMutable(expr.object, context);
  } else if (expr.object?.kind === 'member_access') {
    // Recursively handle nested member_access chains
    obj = transformMemberAccessMutable(expr.object, context);
  } else {
    obj = transformExpression(expr.object, context);
  }

  return {
    kind: 'field_access',
    object: obj,
    field: toSnakeCase(expr.member),
  };
}

/**
 * Transform index access for mutation (assignment target)
 * Returns a mutable borrow suitable for assignment
 */
export function transformIndexAccessMutable(expr: any, context: TranspileContext): MoveExpression {
  const base = transformExpression(expr.base, context);
  const index = transformExpression(expr.index, context);

  // Per-user resource writes (high optimization): mapping[msg.sender] → per-user resource field
  if (expr.base?.kind === 'identifier' && context.optimizationLevel === 'high') {
    const perUser = findPerUserField(context, expr.base.name);
    if (perUser) {
      context.usedModules.add('std::signer');
      // ensure_user_state(account) already called at function start
      // Generate: borrow_global_mut<UserState>(signer::address_of(account)).field
      const addrExpr = index; // The index is the address (typically signer::address_of(account))
      return {
        kind: 'field_access',
        object: {
          kind: 'call',
          function: 'borrow_global_mut',
          typeArgs: [{ kind: 'struct', name: perUser.structName }],
          args: [addrExpr],
        },
        field: perUser.fieldName,
      };
    }
  }

  // Check if base is a state variable mapping
  if (expr.base?.kind === 'identifier') {
    const stateVar = context.stateVariables.get(expr.base.name);
    if (stateVar?.isMapping) {
      context.usedModules.add(tableModulePath(context));

      // Nested mapping: value type is Table (no 'drop' ability).
      // Can't use borrow_mut_with_default; use contains + add(table::new()) + borrow_mut.
      if (isNestedMappingValue(stateVar)) {
        const containsCheck: MoveExpression = {
          kind: 'unary',
          operator: '!',
          operand: {
            kind: 'call',
            function: `${tableModule(context)}::contains`,
            args: [
              { kind: 'borrow', mutable: false, value: base },
              index,
            ],
          },
        };
        const addStmt: MoveStatement = {
          kind: 'expression',
          expression: {
            kind: 'call',
            function: `${tableModule(context)}::add`,
            args: [
              { kind: 'borrow', mutable: true, value: base },
              index,
              { kind: 'call', function: `${tableModule(context)}::new`, args: [] },
            ],
          },
        };
        if (!(context as any)._preStatements) (context as any)._preStatements = [];
        (context as any)._preStatements.push({
          kind: 'if',
          condition: containsCheck,
          thenBlock: [addStmt],
        });

        return {
          kind: 'dereference',
          value: {
            kind: 'call',
            function: `${tableModule(context)}::borrow_mut`,
            args: [
              { kind: 'borrow', mutable: true, value: base },
              index,
            ],
          },
        };
      }

      // Use table::borrow_mut_with_default: add default if key doesn't exist, then borrow_mut
      // This mirrors Solidity's behavior where writing to mapping[key] auto-initializes
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: `${tableModule(context)}::borrow_mut_with_default`,
          args: [
            { kind: 'borrow', mutable: true, value: base },
            index,
            getDefaultForMappingValue(stateVar, context),
          ],
        },
      };
    }
  }

  // Check if base is a local variable with mapping type
  if (expr.base?.kind === 'identifier') {
    const localType = context.localVariables.get(toSnakeCase(expr.base.name));
    if (localType?.isMapping) {
      context.usedModules.add(tableModulePath(context));
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: `${tableModule(context)}::borrow_mut_with_default`,
          args: [
            { kind: 'borrow', mutable: true, value: base },
            index,
            getDefaultForMappingValue(localType, context),
          ],
        },
      };
    }
  }

  // Handle nested index access for mutation
  if (expr.base?.kind === 'index_access') {
    const outerAccess = transformIndexAccessMutable(expr.base, context);
    context.usedModules.add(tableModulePath(context));
    return {
      kind: 'dereference',
      value: {
        kind: 'call',
        function: `${tableModule(context)}::borrow_mut`,
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
  const elements = (expr.elements || []).map((e: any) => {
    if (e === null) {
      // Generate a placeholder for ignored tuple elements: _0, _1, _2, etc.
      return { kind: 'identifier', name: `_${placeholderIdx++}` };
    }
      placeholderIdx++;
      return transformExpression(e, context);
    });

  // For single-element tuples (from Solidity parenthesized expressions),
  // propagate the inner element's inferredType to the tuple
  const inferredType = elements.length === 1 ? getExprInferredType(elements[0]) : undefined;
  const result: MoveExpression = { kind: 'tuple', elements };
  if (inferredType) setExprInferredType(result, inferredType);
  return result;
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
      setExprInferredType(value, { kind: 'primitive', name: 'address' });
      return value;
    }
    // Check if converting a literal number to address
    if (value.kind === 'literal' && value.type === 'number') {
      const numValue = value.value;
      if (numValue === 0 || numValue === '0') {
        // optionalValues='option-type': address(0) → option::none<address>()
        if (context.optionalValues === 'option-type') {
          context.usedModules.add('std::option');
          return {
            kind: 'call',
            function: 'option::none',
            typeArgs: [{ kind: 'primitive', name: 'address' }],
            args: [],
            inferredType: { kind: 'struct', name: 'Option', module: 'option', typeArgs: [{ kind: 'primitive', name: 'address' }] },
          };
        }
        return { kind: 'literal', type: 'address', value: '@0x0', inferredType: { kind: 'primitive', name: 'address' } };
      }
      // For other numeric literals, convert to hex address
      const hexValue = typeof numValue === 'number'
        ? numValue.toString(16)
        : numValue.toString();
      return { kind: 'literal', type: 'address', value: `@0x${hexValue}`, inferredType: { kind: 'primitive', name: 'address' } };
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
      // No suffix — let Move infer from context (source is u256, so mask inferred as u256)
      return {
        kind: 'binary',
        operator: '&',
        left: value,
        right: { kind: 'literal', type: 'number', value: mask },
      };
    }
  }

  // For non-standard int widths, also use bitmask approach
  if (targetTypeName && targetTypeName.startsWith('int') && !targetTypeName.startsWith('interface')) {
    const bits = parseInt(targetTypeName.slice(3)) || 256;
    const standardBits = [8, 16, 32, 64, 128, 256];
    if (!standardBits.includes(bits)) {
      const mask = ((1n << BigInt(bits)) - 1n).toString();
      // No suffix — let Move infer from context
      return {
        kind: 'binary',
        operator: '&',
        left: value,
        right: { kind: 'literal', type: 'number', value: mask },
      };
    }
  }

  // Regular numeric type casts use Move's cast syntax
  if (targetType) {
    return {
      kind: 'cast',
      value,
      targetType,
      inferredType: targetType,
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
      // For view/pure functions, the signer param is already an address parameter
      // For other functions, the signer param is a &signer that needs address_of
      const isViewOrPure = context.currentFunctionStateMutability === 'view' ||
                           context.currentFunctionStateMutability === 'pure';
      if (isViewOrPure) {
        return { kind: 'identifier', name: signerName(context) };
      } else {
        context.usedModules.add('std::signer');
        return {
          kind: 'call',
          function: 'signer::address_of',
          args: [{ kind: 'identifier', name: signerName(context) }],
        };
      }

    case 'value':
      warnOrError(context, 'msg.value has no direct equivalent in Move');
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };

    default:
      warnOrError(context, `msg.${expr.property} is not supported`);
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
      warnOrError(context, `block.${expr.property} is not supported`);
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

  // Handle non-standard Solidity integer widths (uint24, uint40, uint152, etc.)
  // Move only supports u8/u16/u32/u64/u128/u256 — compute the correct max for the
  // Solidity width. Emit WITHOUT suffix so Move infers type from context (avoids
  // cross-type comparison issues like u32 literal vs u256 variable).
  if (member === 'max' || member === 'min') {
    let bits: number | undefined;
    let signed = false;
    if (typeName.startsWith('uint')) {
      bits = parseInt(typeName.slice(4));
    } else if (typeName.startsWith('int')) {
      bits = parseInt(typeName.slice(3));
      signed = true;
    }

    if (bits && !isNaN(bits) && bits > 0 && bits <= 256) {
      if (member === 'max') {
        let value: string;
        if (signed) {
          value = (BigInt(2) ** BigInt(bits - 1) - BigInt(1)).toString();
        } else {
          value = (BigInt(2) ** BigInt(bits) - BigInt(1)).toString();
        }
        return {
          kind: 'literal',
          type: 'number',
          value,
        };
      } else {
        return {
          kind: 'literal',
          type: 'number',
          value: '0',
        };
      }
    }
  }

  warnOrError(context, `type(${expr.typeName}).${member} not supported`);
  return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
}

/**
 * Transform tx.origin, tx.gasprice
 */
function transformTxAccess(expr: any, context: TranspileContext): MoveExpression {
  warnOrError(context, `tx.${expr.property} is not supported in Move`);
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
function transpileAssemblyBlock(operations: any[], context?: TranspileContext): IRStatement[] {
  const statements: IRStatement[] = [];

  for (const op of operations) {
    const stmt = transpileAssemblyOperation(op, context);
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
function transpileAssemblyOperation(op: any, context?: TranspileContext): IRStatement | IRStatement[] | null {
  if (!op) return null;

  switch (op.type) {
    case 'AssemblyAssignment': {
      // name := expression
      const nameNode = op.names?.[0];
      if (!nameNode) return null;
      const value = transpileYulExpression(op.expression, context);
      if (!value) return null;

      // Handle AssemblyMemberAccess targets (e.g., $.slot := value)
      // In EVM, $.slot sets storage location — no Move equivalent. Skip these.
      let target: IRExpression;
      if (nameNode.type === 'AssemblyMemberAccess') {
        const memberName = typeof nameNode.memberName === 'string'
          ? nameNode.memberName
          : nameNode.memberName?.name || 'unknown';
        if (memberName === 'slot' || memberName === 'offset') {
          // EVM storage slot/offset assignment — skip entirely
          return null;
        }
        const objExpr = transpileYulExpression(nameNode.expression, context);
        target = { kind: 'member_access', object: objExpr || { kind: 'identifier', name: 'unknown' }, member: memberName };
      } else {
        const name = typeof nameNode === 'string' ? nameNode : (nameNode.name || 'unknown');
        target = { kind: 'identifier', name: toSnakeCase(name) };
      }

      return { kind: 'assignment', operator: '=' as const, target, value };
    }

    case 'AssemblyLocalDefinition': {
      // let name := expression
      const name = op.names?.[0]?.name || op.names?.[0];
      const value = op.expression ? transpileYulExpression(op.expression, context) : { kind: 'literal' as const, type: 'number' as const, value: 0, suffix: 'u256' };
      if (!name) return null;
      return {
        kind: 'variable_declaration',
        name: toSnakeCase(typeof name === 'string' ? name : name),
        initialValue: value ?? undefined,
      };
    }

    case 'AssemblyIf': {
      // if condition { body }
      const condition = transpileYulExpression(op.condition, context);
      if (!condition) return null;
      const body = op.body?.operations ? transpileAssemblyBlock(op.body.operations, context) : [];
      // In Yul, `if` checks for non-zero. If condition is already boolean
      // (comparison, unary !, logical &&/||), use it directly; otherwise wrap with != 0
      const moveCondition: IRExpression = isBooleanExpression(condition) ? condition
        : { kind: 'binary' as const, operator: '!=', left: condition, right: { kind: 'literal' as const, type: 'number' as const, value: 0, suffix: 'u256' } };
      return {
        kind: 'if',
        condition: moveCondition,
        thenBlock: body,
      };
    }

    case 'AssemblyFor': {
      // for { init } condition { post } { body }
      const initStmts = op.pre?.operations ? transpileAssemblyBlock(op.pre.operations, context) : [];
      const condition = transpileYulExpression(op.condition, context);
      const postStmts = op.post?.operations ? transpileAssemblyBlock(op.post.operations, context) : [];
      const body = op.body?.operations ? transpileAssemblyBlock(op.body.operations, context) : [];
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
      const expr = transpileYulExpression(op, context);
      if (!expr) return null;
      return { kind: 'expression', expression: expr };
    }

    case 'AssemblyBlock': {
      // Nested block
      return op.operations ? transpileAssemblyBlock(op.operations, context) : null;
    }

    default:
      return null;
  }
}

/**
 * Transpile a Yul expression to Move IR expression.
 * Maps Yul builtins to Move operators/functions.
 */
function transpileYulExpression(expr: any, context?: TranspileContext): IRExpression | null {
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
        const a = transpileYulExpression(args[0], context);
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
              return { kind: 'unary', operator: '!', operand: a, prefix: true };
            }
            // Check if identifier refers to a bool variable in the Solidity scope
            if (a.kind === 'identifier' && context?.localVariables) {
              const varType = context.localVariables.get(a.name) || context.localVariables.get(toSnakeCase(a.name));
              if (varType && (varType.solidity === 'bool' || (varType.move?.kind === 'primitive' && varType.move.name === 'bool'))) {
                return { kind: 'unary', operator: '!', operand: a, prefix: true };
              }
            }
            return { kind: 'binary', operator: '==', left: a, right: { kind: 'literal', type: 'number', value: 0, suffix: 'u256' } };
          }
          case 'mload':
            // Memory load - no direct Move equivalent, pass through as identifier
            return a;
          case 'calldataload':
          case 'extcodesize':
          case 'codesize':
          case 'selfbalance':
            // EVM-specific opcodes with no Move equivalent → literal 0
            return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
          default:
            // Unknown unary - emit as function call
            return { kind: 'function_call', function: { kind: 'identifier', name: toSnakeCase(name) }, args: [a] };
        }
      }

      // Two-argument builtins
      if (args.length === 2) {
        const a = transpileYulExpression(args[0], context);
        const b = transpileYulExpression(args[1], context);
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
        const a = transpileYulExpression(args[0], context);
        const b = transpileYulExpression(args[1], context);
        const c = transpileYulExpression(args[2], context);
        if (!a || !b || !c) return null;

        switch (name) {
          case 'addmod':
            // (a + b) % c
            return { kind: 'binary', operator: '%', left: { kind: 'binary', operator: '+', left: a, right: b }, right: c };
          case 'mulmod':
            // (a * b) % c
            return { kind: 'binary', operator: '%', left: { kind: 'binary', operator: '*', left: a, right: b }, right: c };
          case 'returndatacopy':
          case 'calldatacopy':
          case 'codecopy':
            // EVM memory operations — no Move equivalent, skip
            return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
          default:
            return { kind: 'function_call', function: { kind: 'identifier', name: toSnakeCase(name) }, args: [a, b, c] };
        }
      }

      // Handle EVM call opcodes with many args
      // call(gas, addr, value, inOff, inLen, outOff, outLen) → bool (success)
      // staticcall(gas, addr, inOff, inLen, outOff, outLen) → bool (success)
      if (name === 'call' || name === 'staticcall' || name === 'delegatecall') {
        // These are low-level EVM calls — no Move equivalent
        // Return true as success value (stub)
        return { kind: 'literal', type: 'bool', value: true };
      }

      // Multi-argument fallback
      const transpiled = args.map((a: any) => transpileYulExpression(a, context)).filter(Boolean);
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

    case 'Identifier': {
      // Handle $ variable (EVM storage reference) — not valid in Move
      let idName = expr.name;
      if (idName === '$') idName = '_storage_ref';
      else if (idName.includes('$')) idName = idName.replace(/\$/g, '_');
      return { kind: 'identifier', name: toSnakeCase(idName) };
    }

    case 'AssemblyMemberAccess': {
      const obj = transpileYulExpression(expr.expression, context);
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
/**
 * Extract the original Solidity variable name from an assignment target IR expression.
 * Used for aggregator detection in the assignment transformer.
 */
function extractTargetVarName(target: any): string | null {
  if (!target) return null;
  if (target.kind === 'identifier') return target.name;
  if (target.kind === 'index_access') return extractTargetVarName(target.base);
  if (target.kind === 'member_access') return extractTargetVarName(target.object);
  return null;
}

/**
 * Convert a resource group name to a local variable name.
 * E.g., 'VaultAdminConfig' → 'admin_config', 'VaultCounters' → 'counters'
 */
function groupNameToLocalVar(groupName: string): string {
  const suffixes = ['AdminConfig', 'Counters', 'UserData', 'State'];
  for (const suffix of suffixes) {
    if (groupName.endsWith(suffix)) {
      return toSnakeCase(suffix);
    }
  }
  return toSnakeCase(groupName);
}

/**
 * Try to transform a binary comparison on an aggregatable variable to
 * aggregator_v2::is_at_least(). This avoids materializing the full value
 * and eliminates sequential dependencies per AIP-47.
 *
 * Supported patterns:
 *   aggVar > 0    → is_at_least(&agg, 1)
 *   aggVar >= N   → is_at_least(&agg, N)
 *   aggVar > N    → is_at_least(&agg, N + 1)  (literal N only)
 *   aggVar != 0   → is_at_least(&agg, 1)
 *   0 < aggVar    → is_at_least(&agg, 1)  (reversed operands)
 *
 * Returns null if the pattern doesn't match.
 */
function tryTransformAggregatorComparison(
  expr: any,
  context: TranspileContext
): MoveExpression | null {
  const op = expr.operator;
  if (!['>', '>=', '!=', '<'].includes(op)) return null;

  // Determine which operand is the aggregatable variable and which is the threshold
  let aggSide: 'left' | 'right' | null = null;
  let aggVarName: string | null = null;
  let thresholdExpr: any = null;
  let effectiveOp = op;

  // Check left operand
  if (expr.left?.kind === 'identifier') {
    const analysis = findVariableAnalysis(context, expr.left.name);
    if (analysis && analysis.category === 'aggregatable') {
      aggSide = 'left';
      aggVarName = expr.left.name;
      thresholdExpr = expr.right;
    }
  }
  // Check right operand (reversed: 0 < aggVar)
  if (!aggSide && expr.right?.kind === 'identifier') {
    const analysis = findVariableAnalysis(context, expr.right.name);
    if (analysis && analysis.category === 'aggregatable') {
      aggSide = 'right';
      aggVarName = expr.right.name;
      thresholdExpr = expr.left;
      // Flip operator: 0 < aggVar → aggVar > 0, N <= aggVar → aggVar >= N
      if (op === '<') effectiveOp = '>';
      else if (op === '<=') effectiveOp = '>=';
      else if (op === '>') effectiveOp = '<';
      else if (op === '>=') effectiveOp = '<=';
    }
  }

  if (!aggSide || !aggVarName) return null;

  // Only handle > , >= , != (from agg's perspective). < and <= need exact value.
  if (effectiveOp !== '>' && effectiveOp !== '>=' && effectiveOp !== '!=') return null;

  // Determine the threshold value for is_at_least
  const isZero = thresholdExpr?.kind === 'literal' && thresholdExpr?.type === 'number' &&
    (thresholdExpr.value === 0 || thresholdExpr.value === '0');

  // != only optimizable when compared to 0
  if (effectiveOp === '!=' && !isZero) return null;

  // Build the field access for the aggregator
  const analysis = findVariableAnalysis(context, aggVarName)!;
  const groupName = context.resourcePlan!.varToGroup.get(aggVarName);
  const objectName = groupName ? groupNameToLocalVar(groupName) : 'state';
  const fieldAccess: MoveExpression = {
    kind: 'field_access',
    object: { kind: 'identifier', name: objectName },
    field: toSnakeCase(aggVarName),
  };
  const borrowRef: MoveExpression = { kind: 'borrow', mutable: false, value: fieldAccess };

  let thresholdMoveExpr: MoveExpression;

  if (effectiveOp === '!=' || (effectiveOp === '>' && isZero)) {
    // aggVar > 0 or aggVar != 0 → is_at_least(&agg, 1)
    thresholdMoveExpr = { kind: 'literal', type: 'number', value: 1, suffix: 'u128' };
  } else if (effectiveOp === '>=') {
    // aggVar >= N → is_at_least(&agg, N)
    thresholdMoveExpr = transformExpression(thresholdExpr, context);
    // Cast to u128 if needed
    const moveType = analysis.variable.type?.move;
    if (moveType && moveType.kind === 'primitive' &&
        (moveType.name === 'u256' || moveType.name === 'u64')) {
      thresholdMoveExpr = { kind: 'cast', value: thresholdMoveExpr, targetType: { kind: 'primitive', name: 'u128' } };
    }
  } else if (effectiveOp === '>') {
    // aggVar > N → is_at_least(&agg, N + 1) — only for literal N
    if (thresholdExpr?.kind !== 'literal' || thresholdExpr?.type !== 'number') return null;
    const nVal = typeof thresholdExpr.value === 'string' ? parseInt(thresholdExpr.value) : thresholdExpr.value;
    thresholdMoveExpr = { kind: 'literal', type: 'number', value: nVal + 1, suffix: 'u128' };
  } else {
    return null;
  }

  return {
    kind: 'call',
    module: 'aggregator_v2',
    function: 'is_at_least',
    args: [borrowRef, thresholdMoveExpr],
    inferredType: { kind: 'primitive', name: 'bool' },
  };
}

/**
 * Find a variable's StateVariableAnalysis from the resource plan.
 * Returns the analysis if found, null otherwise.
 */
function findVariableAnalysis(
  context: TranspileContext,
  varName: string
): { category: string; variable: { name: string; type?: any } } | null {
  if (!context.resourcePlan) return null;
  for (const group of context.resourcePlan.groups) {
    for (const va of group.variables) {
      if (va.variable.name === varName) {
        return { category: va.category, variable: va.variable };
      }
    }
  }
  return null;
}

/**
 * Map Solidity type name to Move type name for generic parameters.
 * Handles elementary types (uint256→u256, address, bool, bytes→u8)
 * and passes through struct/custom names unchanged.
 */
function solidityTypeToMoveTypeName(typeName: string): string {
  if (typeName === 'uint' || typeName === 'uint256') return 'u256';
  if (typeName === 'uint8') return 'u8';
  if (typeName === 'uint16') return 'u16';
  if (typeName === 'uint32') return 'u32';
  if (typeName === 'uint64') return 'u64';
  if (typeName === 'uint128') return 'u128';
  if (typeName.startsWith('uint')) {
    const bits = parseInt(typeName.slice(4));
    if (bits <= 8) return 'u8';
    if (bits <= 16) return 'u16';
    if (bits <= 32) return 'u32';
    if (bits <= 64) return 'u64';
    if (bits <= 128) return 'u128';
    return 'u256';
  }
  if (typeName === 'int' || typeName === 'int256') return 'i256';
  if (typeName.startsWith('int')) {
    const bits = parseInt(typeName.slice(3));
    if (bits <= 8) return 'i8';
    if (bits <= 16) return 'i16';
    if (bits <= 32) return 'i32';
    if (bits <= 64) return 'i64';
    if (bits <= 128) return 'i128';
    return 'i256';
  }
  if (typeName === 'bool') return 'bool';
  if (typeName === 'address') return 'address';
  if (typeName === 'bytes' || typeName === 'string') return 'u8';
  if (typeName.startsWith('bytes') && typeName.length <= 7) return 'u8'; // bytes1..bytes32
  // Pass through struct/custom type names unchanged
  return typeName;
}

/** Find per-user resource field config for a variable, if applicable. */
function findPerUserField(
  context: TranspileContext,
  varName: string
): { structName: string; fieldName: string; type: any } | null {
  const pur = context.resourcePlan?.perUserResources;
  if (!pur) return null;
  const field = pur.fields.find(f => f.varName === varName);
  if (!field) return null;
  return { structName: pur.structName, fieldName: field.fieldName, type: field.type };
}

function toSnakeCase(str: string): string {
  if (!str) return '';

  // Handle $ variable (EVM storage reference) — not valid in Move
  if (str === '$') return '_storage_ref';
  if (str.includes('$')) str = str.replace(/\$/g, '_');

  // Check if it's already SCREAMING_SNAKE_CASE (all caps with underscores)
  // Move constants use SCREAMING_SNAKE — preserve as-is
  if (/^_?[A-Z][A-Z0-9_]*$/.test(str)) {
    return str;
  }

  // Convert camelCase/PascalCase to snake_case
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')     // lowercase/digit → uppercase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // consecutive uppercase → Titlecase boundary
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
  if (/^_?[A-Z][A-Z0-9_]*$/.test(str)) {
    return str;
  }
  return str
    .replace(/\s+/g, '_')                       // Replace spaces with underscores
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')     // lowercase/digit → uppercase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // consecutive uppercase → Titlecase boundary
    .replace(/[^A-Z0-9_]/gi, '')                 // Remove non-alphanumeric except underscore
    .toUpperCase()
    .replace(/^_/, '')                           // Remove leading underscore
    .replace(/_+/g, '_');                        // Collapse multiple underscores
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
          { kind: 'identifier', name: signerName(context) },
          args[0], // to
          args[1], // amount
        ],
      };

    case 'transferFrom':
      warnOrError(context, 'ERC20.transferFrom requires FA transfer_with_ref or alternative pattern');
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
      warnOrError(context, 'ERC20.approve not directly supported - use capability pattern');
      return { kind: 'literal', type: 'bool', value: true };

    case 'balanceOf':
      return {
        kind: 'call',
        function: 'coin::balance',
        typeArgs: [{ kind: 'generic', name: 'CoinType' }],
        args: [args[0]], // owner
      };

    case 'allowance':
      warnOrError(context, 'ERC20.allowance not directly supported in Aptos coin');
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
          { kind: 'identifier', name: signerName(context) },
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
      warnOrError(context, 'ERC721.balanceOf requires custom implementation in Aptos');
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u64' };

    case 'approve':
      warnOrError(context, 'ERC721.approve - use object::generate_linear_transfer_ref');
      return { kind: 'literal', type: 'bool', value: true };

    case 'setApprovalForAll':
      warnOrError(context, 'ERC721.setApprovalForAll not directly supported');
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
    warnOrError(context, 'address.isContract() not available in Move, using false');
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

  // OpenZeppelin EnumerableSet/EnumerableMap operations
  // These library types aren't in allContracts so they need explicit mapping
  if (['contains', 'add', 'remove', 'get', 'set', 'at', 'keys', 'values', 'length'].includes(method)) {
    const objIsTable = isTableType(obj, context);

    if (method === 'contains') {
      if (objIsTable) {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'call',
          function: `${tableModule(context)}::contains`,
          args: [{ kind: 'borrow', mutable: false, value: obj }, ...args],
        };
      } else {
        context.usedModules.add('std::vector');
        return {
          kind: 'call',
          function: 'vector::contains',
          args: [{ kind: 'borrow', mutable: false, value: obj }, { kind: 'borrow', mutable: false, value: args[0] }],
        };
      }
    }

    if (method === 'add') {
      if (objIsTable) {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'call',
          function: `${tableModule(context)}::add`,
          args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
        };
      } else {
        context.usedModules.add('std::vector');
        return {
          kind: 'call',
          function: 'vector::push_back',
          args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
        };
      }
    }

    if (method === 'remove') {
      if (objIsTable) {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'call',
          function: `${tableModule(context)}::remove`,
          args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
        };
      } else {
        context.usedModules.add('std::vector');
        return {
          kind: 'call',
          function: 'vector::remove_value',
          args: [{ kind: 'borrow', mutable: true, value: obj }, { kind: 'borrow', mutable: false, value: args[0] }],
        };
      }
    }

    if (method === 'get') {
      context.usedModules.add(tableModulePath(context));
      return {
        kind: 'dereference',
        value: {
          kind: 'call',
          function: `${tableModule(context)}::borrow`,
          args: [{ kind: 'borrow', mutable: false, value: obj }, ...args],
        },
      };
    }

    if (method === 'set') {
      context.usedModules.add(tableModulePath(context));
      return {
        kind: 'call',
        function: `${tableModule(context)}::upsert`,
        args: [{ kind: 'borrow', mutable: true, value: obj }, ...args],
      };
    }

    if (method === 'at') {
      if (objIsTable) {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'dereference',
          value: {
            kind: 'call',
            function: `${tableModule(context)}::borrow`,
            args: [{ kind: 'borrow', mutable: false, value: obj }, ...args],
          },
        };
      } else {
        context.usedModules.add('std::vector');
        return {
          kind: 'dereference',
          value: {
            kind: 'call',
            function: 'vector::borrow',
            args: [{ kind: 'borrow', mutable: false, value: obj }, castToU64IfNeeded(args[0])],
          },
        };
      }
    }

    if (method === 'length') {
      if (objIsTable) {
        context.usedModules.add(tableModulePath(context));
        return {
          kind: 'call',
          function: `${tableModule(context)}::length`,
          args: [{ kind: 'borrow', mutable: false, value: obj }],
          inferredType: { kind: 'primitive', name: 'u64' },
        };
      } else {
        context.usedModules.add('std::vector');
        return {
          kind: 'call',
          function: 'vector::length',
          args: [{ kind: 'borrow', mutable: false, value: obj }],
          inferredType: { kind: 'primitive', name: 'u64' },
        };
      }
    }

    if (method === 'keys' || method === 'values') {
      return obj;
    }
  }

  // If we can't inline it, treat as a direct function call with obj as first arg
  // This handles custom library functions: obj.customMethod(args) → library::method(obj, args)
  const methodSnake = toSnakeCase(method);
  const libraryModule = context.libraryFunctions?.get(methodSnake);

  return {
    kind: 'call',
    function: libraryModule ? `${libraryModule}::${methodSnake}` : methodSnake,
    args: [obj, ...args],
  };
}

/**
 * Get internal-call metadata from function registry.
 */
function getInternalFunctionCallInfo(
  name: string,
  context: TranspileContext
): { accessesState: boolean; signerParamKind: 'none' | 'signer-ref' | 'address' } | null {
  if ((context as any).isLibrary) return null;
  const registry = (context as any).functionRegistry as Map<string, {
    visibility: string;
    accessesState: boolean;
    signerParamKind: 'none' | 'signer-ref' | 'address';
  }> | undefined;
  if (!registry) return null;

  const normalized = toSnakeCase(name);
  const info = registry.get(name) || registry.get(normalized);
  if (!info) return null;
  if (info.visibility !== 'private' && info.visibility !== 'internal') return null;

  return {
    accessesState: info.accessesState,
    signerParamKind: info.signerParamKind || 'none',
  };
}

/**
 * Determine if a direct function identifier is known/resolvable at transpile time.
 */
function isKnownCallable(name: string, context: TranspileContext): boolean {
  if (name.includes('::')) return true;
  if (context.functionSignatures?.has(name)) return true;
  // Builtins and compiler intrinsics that may not appear in functionSignatures.
  const known = new Set([
    'assert!',
    'abort',
    'move_to',
    'move_from',
    'borrow_global',
    'borrow_global_mut',
    'exists',
    'range',
    'vector::empty',
  ]);
  return known.has(name);
}

/**
 * Build the argument used to satisfy propagated signer/address parameters
 * on internal helper calls.
 */
function buildSignerArgForInternalCall(
  expected: 'signer-ref' | 'address',
  context: TranspileContext
): MoveExpression | null {
  const currentKind = (context as any).currentFunctionSignerKind as ('none' | 'signer-ref' | 'address' | undefined) || 'none';

  if (expected === 'signer-ref') {
    if (currentKind === 'signer-ref') {
      return { kind: 'identifier', name: signerName(context) };
    }
    warnOrError(context, 'Internal call requires signer context but caller has no signer parameter');
    return { kind: 'identifier', name: signerName(context) };
  }

  if (expected === 'address') {
    if (currentKind === 'address') {
      return { kind: 'identifier', name: signerName(context) };
    }
    if (currentKind === 'signer-ref') {
      context.usedModules.add('std::signer');
      return {
        kind: 'call',
        function: 'signer::address_of',
        args: [{ kind: 'identifier', name: signerName(context) }],
      };
    }
    warnOrError(context, 'Internal call requires address context but caller has no signer/address parameter');
    return { kind: 'literal', type: 'address', value: '@0x0' };
  }

  return null;
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
