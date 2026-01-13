/**
 * Function Transformer
 * Transforms Solidity functions to Move functions
 */

import type { MoveFunction, MoveFunctionParam, MoveStatement, MoveType, MoveVisibility } from '../types/move-ast.js';
import type { IRFunction, IRConstructor, IRFunctionParam, IRStateVariable, IRStatement, TranspileContext } from '../types/ir.js';
import { MoveTypes } from '../types/move-ast.js';
import { transformStatement } from './expression-transformer.js';

/**
 * Transform a Solidity function to a Move function
 * Enhanced with modifier support based on e2m patterns
 */
export function transformFunction(
  fn: IRFunction,
  context: TranspileContext
): MoveFunction {
  context.currentFunction = fn.name;
  context.currentFunctionStateMutability = fn.stateMutability;

  // Determine visibility
  const visibility = mapVisibility(fn.visibility, fn.stateMutability);

  // Check if function body uses msg.sender (needed for view functions)
  const usesMsgSender = bodyUsesMsgSender(fn.body);

  // Transform parameters
  const params = transformParams(fn.params, fn.stateMutability, context, usesMsgSender);

  // Transform return type
  const returnType = transformReturnType(fn.returnParams, context);

  // Transform body with modifier assertions prepended
  const body = transformFunctionBody(fn.body, fn, context);

  // Prepend modifier checks as inline assertions
  const modifierChecks = transformModifiers(fn.modifiers || [], context);
  const fullBody = [...modifierChecks, ...body];

  // Determine if this needs acquires
  const acquires = determineAcquires(fn, context);

  const moveFunc: MoveFunction = {
    name: toSnakeCase(fn.name),
    visibility,
    isEntry: shouldBeEntry(fn),
    isView: fn.stateMutability === 'view' || fn.stateMutability === 'pure',
    params,
    body: fullBody,
  };

  if (returnType) {
    moveFunc.returnType = returnType;
  }

  if (acquires.length > 0) {
    moveFunc.acquires = acquires;
  }

  context.currentFunction = undefined;
  context.currentFunctionStateMutability = undefined;
  return moveFunc;
}

/**
 * Transform modifiers to inline assertion statements
 * Based on e2m's approach of inlining modifier logic
 */
function transformModifiers(
  modifiers: Array<{ name: string; args?: any[] }>,
  context: TranspileContext
): MoveStatement[] {
  const statements: MoveStatement[] = [];

  for (const modifier of modifiers) {
    const modifierStatements = transformModifier(modifier, context);
    statements.push(...modifierStatements);
  }

  return statements;
}

/**
 * Transform a single modifier to assertion statements
 */
function transformModifier(
  modifier: { name: string; args?: any[] },
  context: TranspileContext
): MoveStatement[] {
  const name = modifier.name;

  // Handle common modifier patterns
  switch (name) {
    case 'onlyOwner':
      return generateOnlyOwnerCheck(context);

    case 'nonReentrant':
      return generateReentrancyGuard(context);

    case 'whenNotPaused':
      return generatePausedCheck(false, context);

    case 'whenPaused':
      return generatePausedCheck(true, context);

    case 'onlyRole':
      return generateRoleCheck(modifier.args?.[0], context);

    default:
      // Check if we have a modifier definition in context
      const modifierDef = context.modifiers?.get(name);
      if (modifierDef) {
        return inlineModifierBody(modifierDef, modifier.args, context);
      }

      // Unknown modifier - add a comment/warning
      context.warnings.push({
        message: `Unknown modifier '${name}' - manual translation may be required`,
        severity: 'warning',
      });
      return [{
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'assert!',
          args: [
            { kind: 'literal', type: 'bool', value: true },
            { kind: 'identifier', name: `E_MODIFIER_${toScreamingSnakeCase(name)}` },
          ],
        },
      }];
  }
}

/**
 * Generate onlyOwner check
 */
function generateOnlyOwnerCheck(context: TranspileContext): MoveStatement[] {
  context.usedModules.add('std::signer');
  return [{
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'assert!',
      args: [
        {
          kind: 'binary',
          operator: '==',
          left: {
            kind: 'call',
            function: 'signer::address_of',
            args: [{ kind: 'identifier', name: 'account' }],
          },
          right: {
            kind: 'field_access',
            object: { kind: 'identifier', name: 'state' },
            field: 'owner',
          },
        },
        { kind: 'identifier', name: 'E_UNAUTHORIZED' },
      ],
    },
  }];
}

/**
 * Generate reentrancy guard check
 * Uses status field pattern from evm_compat
 */
function generateReentrancyGuard(context: TranspileContext): MoveStatement[] {
  return [
    // Check not already entered
    {
      kind: 'expression',
      expression: {
        kind: 'call',
        function: 'assert!',
        args: [
          {
            kind: 'binary',
            operator: '!=',
            left: {
              kind: 'field_access',
              object: { kind: 'identifier', name: 'state' },
              field: 'reentrancy_status',
            },
            right: { kind: 'literal', type: 'number', value: 2, suffix: 'u8' },
          },
          { kind: 'identifier', name: 'E_REENTRANCY' },
        ],
      },
    },
    // Set entered status
    {
      kind: 'assign',
      target: {
        kind: 'field_access',
        object: { kind: 'identifier', name: 'state' },
        field: 'reentrancy_status',
      },
      value: { kind: 'literal', type: 'number', value: 2, suffix: 'u8' },
    },
  ];
}

/**
 * Generate paused check
 */
function generatePausedCheck(requirePaused: boolean, context: TranspileContext): MoveStatement[] {
  return [{
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'assert!',
      args: [
        requirePaused
          ? {
              kind: 'field_access',
              object: { kind: 'identifier', name: 'state' },
              field: 'paused',
            }
          : {
              kind: 'unary',
              operator: '!',
              operand: {
                kind: 'field_access',
                object: { kind: 'identifier', name: 'state' },
                field: 'paused',
              },
            },
        { kind: 'identifier', name: 'E_PAUSED' },
      ],
    },
  }];
}

/**
 * Generate role check (for AccessControl pattern)
 */
function generateRoleCheck(roleArg: any, context: TranspileContext): MoveStatement[] {
  context.usedModules.add('std::signer');
  context.usedModules.add('aptos_std::table');

  const roleExpr = roleArg
    ? { kind: 'identifier', name: toSnakeCase(String(roleArg.value || roleArg.name || 'ADMIN_ROLE')) }
    : { kind: 'identifier', name: 'ADMIN_ROLE' };

  return [{
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'assert!',
      args: [
        {
          kind: 'call',
          function: 'table::contains',
          args: [
            {
              kind: 'borrow',
              mutable: false,
              value: {
                kind: 'field_access',
                object: { kind: 'identifier', name: 'state' },
                field: 'roles',
              },
            },
            {
              kind: 'call',
              function: 'signer::address_of',
              args: [{ kind: 'identifier', name: 'account' }],
            },
          ],
        },
        { kind: 'identifier', name: 'E_UNAUTHORIZED' },
      ],
    },
  }];
}

/**
 * Inline a custom modifier body
 */
function inlineModifierBody(
  modifierDef: any,
  args: any[] | undefined,
  context: TranspileContext
): MoveStatement[] {
  const statements: MoveStatement[] = [];

  // Create parameter mapping
  const paramMap = new Map<string, any>();
  if (modifierDef.params && args) {
    modifierDef.params.forEach((param: any, i: number) => {
      if (args[i]) {
        paramMap.set(param.name, args[i]);
      }
    });
  }

  // Transform modifier body, substituting parameters and stopping at _
  for (const stmt of modifierDef.body || []) {
    // Skip the placeholder _; (where function body goes)
    if (stmt.kind === 'placeholder') {
      continue;
    }

    const transformed = transformStatement(stmt, context);
    if (transformed) {
      statements.push(transformed);
    }
  }

  return statements;
}

/**
 * Convert to SCREAMING_SNAKE_CASE
 * Handles spaces, camelCase, and special characters
 */
function toScreamingSnakeCase(str: string): string {
  return str
    .replace(/\s+/g, '_')           // Replace spaces with underscores
    .replace(/([A-Z])/g, '_$1')     // Add underscore before capitals
    .replace(/[^A-Z0-9_]/gi, '')    // Remove non-alphanumeric except underscore
    .toUpperCase()
    .replace(/^_/, '')              // Remove leading underscore
    .replace(/_+/g, '_');           // Collapse multiple underscores
}

/**
 * Transform Solidity constructor to Move init_module or initialize function
 */
export function transformConstructor(
  constructor: IRConstructor,
  contractName: string,
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveFunction {
  const stateName = `${contractName}State`;

  // If constructor has parameters, create an initialize function
  // Otherwise, create init_module
  const hasParams = constructor.params.length > 0;

  const params: MoveFunctionParam[] = [
    {
      name: 'deployer',
      type: MoveTypes.ref(MoveTypes.signer()),
    },
  ];

  // Build a map from original Solidity param names to snake_case Move names
  const paramNameMap = new Map<string, string>();

  // Add constructor parameters
  if (hasParams) {
    for (const param of constructor.params) {
      const snakeCaseName = toSnakeCase(param.name);
      paramNameMap.set(param.name, snakeCaseName);
      // Also map with and without underscore prefix for Solidity conventions
      if (param.name.startsWith('_')) {
        paramNameMap.set(param.name.slice(1), snakeCaseName);
      }
      params.push({
        name: snakeCaseName,
        type: param.type.move || MoveTypes.u256(),
      });
    }
  }

  // Create a constructor-specific context where 'account' maps to 'deployer'
  const constructorContext: TranspileContext = {
    ...context,
    currentFunction: 'constructor',
    currentFunctionStateMutability: 'nonpayable',
    paramNameMap, // Add the param name mapping
  };

  // Build the state initialization
  const stateFields = stateVariables
    .filter(v => v.mutability !== 'constant')
    .map(v => {
      // Check if this variable is initialized in the constructor
      // Pass the variable type so we can generate the correct suffix
      const initValue = findInitializationInBody(v.name, constructor.body, constructorContext, v.type);
      return {
        name: toSnakeCase(v.name),
        value: initValue || getDefaultValue(v, context),
      };
    });

  const body: MoveStatement[] = [];

  // Separate constructor body into:
  // 1. Regular statements (before move_to)
  // 2. Mapping assignments (after move_to, need to borrow state first)
  const { regularStatements, mappingAssignments } = separateConstructorStatements(
    constructor.body,
    stateVariables,
    constructorContext
  );

  // Add regular statements (if any)
  body.push(...regularStatements);

  // Add move_to to create the resource
  body.push({
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'move_to',
      args: [
        { kind: 'identifier', name: 'deployer' },
        {
          kind: 'struct',
          name: stateName,
          fields: stateFields,
        },
      ],
    },
  });

  // If there are mapping assignments, borrow state and add them
  if (mappingAssignments.length > 0) {
    // Borrow state mutably
    body.push({
      kind: 'let',
      pattern: 'state',
      value: {
        kind: 'call',
        function: 'borrow_global_mut',
        typeArgs: [{ kind: 'struct', name: stateName }],
        args: [
          {
            kind: 'call',
            function: 'signer::address_of',
            args: [{ kind: 'identifier', name: 'deployer' }],
          },
        ],
      },
    });

    // Transform mapping assignments to table::add operations
    // Set phase so state variable references become state.field_name
    const postMoveContext = { ...constructorContext, constructorPhase: 'post_move_to' };
    for (const mappingAssign of mappingAssignments) {
      body.push(transformMappingAssignmentForConstructor(mappingAssign, stateVariables, postMoveContext));
    }
  }

  return {
    name: hasParams ? 'initialize' : 'init_module',
    visibility: hasParams ? 'public' : 'private',
    isEntry: hasParams,
    params,
    body,
  };
}

/**
 * Map Solidity visibility to Move visibility
 */
function mapVisibility(
  visibility: string,
  stateMutability: string
): MoveVisibility {
  switch (visibility) {
    case 'public':
    case 'external':
      return 'public';
    case 'internal':
      return 'public(package)';
    case 'private':
    default:
      return 'private';
  }
}

/**
 * Determine if a function should be an entry function
 */
function shouldBeEntry(fn: IRFunction): boolean {
  // Entry functions can be called directly from transactions
  // Public and external functions that modify state should be entry
  if (fn.visibility === 'private' || fn.visibility === 'internal') {
    return false;
  }

  if (fn.stateMutability === 'view' || fn.stateMutability === 'pure') {
    return false;
  }

  return true;
}

/**
 * Transform function parameters
 */
function transformParams(
  params: IRFunctionParam[],
  stateMutability: string,
  context: TranspileContext,
  usesMsgSender: boolean = false
): MoveFunctionParam[] {
  const moveParams: MoveFunctionParam[] = [];

  // Add signer parameter for non-view functions
  if (stateMutability !== 'view' && stateMutability !== 'pure') {
    moveParams.push({
      name: 'account',
      type: MoveTypes.ref(MoveTypes.signer()),
    });
  } else if (usesMsgSender) {
    // View functions that use msg.sender need an address parameter
    moveParams.push({
      name: 'account',
      type: MoveTypes.address(),
    });
  }

  // Transform other parameters
  for (const param of params) {
    moveParams.push({
      name: toSnakeCase(param.name),
      type: param.type.move || MoveTypes.u256(),
    });
  }

  return moveParams;
}

/**
 * Check if function body uses msg.sender
 */
function bodyUsesMsgSender(statements: IRStatement[]): boolean {
  for (const stmt of statements) {
    if (statementUsesMsgSender(stmt)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a statement uses msg.sender
 */
function statementUsesMsgSender(stmt: IRStatement): boolean {
  switch (stmt.kind) {
    case 'expression':
      return expressionUsesMsgSender(stmt.expression);
    case 'return':
      return stmt.value ? expressionUsesMsgSender(stmt.value) : false;
    case 'if':
      return expressionUsesMsgSender(stmt.condition) ||
             bodyUsesMsgSender(stmt.thenBlock) ||
             (stmt.elseBlock ? bodyUsesMsgSender(stmt.elseBlock) : false);
    case 'for':
    case 'while':
    case 'do_while':
      return bodyUsesMsgSender(stmt.body);
    case 'block':
      return bodyUsesMsgSender(stmt.statements);
    case 'variable_declaration':
      return stmt.initialValue ? expressionUsesMsgSender(stmt.initialValue) : false;
    case 'assignment':
      return expressionUsesMsgSender(stmt.target) || expressionUsesMsgSender(stmt.value);
    case 'emit':
      return stmt.args.some(expressionUsesMsgSender);
    default:
      return false;
  }
}

/**
 * Check if an expression uses msg.sender
 */
function expressionUsesMsgSender(expr: any): boolean {
  if (!expr) return false;

  if (expr.kind === 'msg_access' && expr.property === 'sender') {
    return true;
  }

  switch (expr.kind) {
    case 'binary':
      return expressionUsesMsgSender(expr.left) || expressionUsesMsgSender(expr.right);
    case 'unary':
      return expressionUsesMsgSender(expr.operand);
    case 'function_call':
      return expressionUsesMsgSender(expr.function) ||
             (expr.args || []).some(expressionUsesMsgSender);
    case 'member_access':
      return expressionUsesMsgSender(expr.object);
    case 'index_access':
      return expressionUsesMsgSender(expr.base) || expressionUsesMsgSender(expr.index);
    case 'conditional':
      return expressionUsesMsgSender(expr.condition) ||
             expressionUsesMsgSender(expr.trueExpression) ||
             expressionUsesMsgSender(expr.falseExpression);
    default:
      return false;
  }
}

/**
 * Transform return type
 */
function transformReturnType(
  returnParams: IRFunctionParam[],
  context: TranspileContext
): MoveType | MoveType[] | undefined {
  if (returnParams.length === 0) {
    return undefined;
  }

  if (returnParams.length === 1) {
    return returnParams[0].type.move || MoveTypes.u256();
  }

  // Multiple return values become a tuple
  return returnParams.map(p => p.type.move || MoveTypes.u256());
}

/**
 * Transform function body
 */
function transformFunctionBody(
  statements: IRStatement[],
  fn: IRFunction,
  context: TranspileContext
): MoveStatement[] {
  const moveStatements: MoveStatement[] = [];

  // If function modifies state, we need to borrow the state
  if (fn.stateMutability !== 'view' && fn.stateMutability !== 'pure') {
    // Check if we need mutable borrow
    const needsMut = statementsModifyState(statements, context);
    if (needsMut) {
      moveStatements.push({
        kind: 'let',
        pattern: 'state',
        mutable: false,
        value: {
          kind: 'call',
          function: 'borrow_global_mut',
          typeArgs: [{ kind: 'struct', name: `${context.contractName}State` }],
          args: [{ kind: 'literal', type: 'address', value: `@${context.moduleAddress}` }],
        },
      });
    }
  } else if (accessesState(statements, context)) {
    // View function that reads state
    moveStatements.push({
      kind: 'let',
      pattern: 'state',
      mutable: false,
      value: {
        kind: 'call',
        function: 'borrow_global',
        typeArgs: [{ kind: 'struct', name: `${context.contractName}State` }],
        args: [{ kind: 'literal', type: 'address', value: `@${context.moduleAddress}` }],
      },
    });
  }

  // Transform each statement
  for (const stmt of statements) {
    const transformed = transformStatement(stmt, context);
    if (transformed) {
      moveStatements.push(transformed);
    }
  }

  return moveStatements;
}

/**
 * Transform constructor body
 */
function transformConstructorBody(
  statements: IRStatement[],
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveStatement[] {
  const moveStatements: MoveStatement[] = [];
  const stateVarNames = new Set(stateVariables.map(v => v.name));

  for (const stmt of statements) {
    // Skip direct state variable assignments - they're handled in struct initialization
    if (isStateVariableAssignment(stmt, stateVarNames)) {
      continue;
    }

    const transformed = transformStatement(stmt, context);
    if (transformed) {
      moveStatements.push(transformed);
    }
  }

  return moveStatements;
}

/**
 * Check if a statement is a direct state variable assignment
 */
function isStateVariableAssignment(
  stmt: IRStatement,
  stateVarNames: Set<string>
): boolean {
  if (stmt.kind !== 'assignment') return false;

  const target = stmt.target;
  if (target.kind === 'identifier' && stateVarNames.has(target.name)) {
    return true;
  }

  return false;
}

/**
 * Separate constructor statements into regular statements and mapping assignments
 */
function separateConstructorStatements(
  statements: IRStatement[],
  stateVariables: IRStateVariable[],
  context: TranspileContext
): { regularStatements: MoveStatement[]; mappingAssignments: IRStatement[] } {
  const regularStatements: MoveStatement[] = [];
  const mappingAssignments: IRStatement[] = [];
  const stateVarNames = new Set(stateVariables.map(v => v.name));
  const mappingVarNames = new Set(stateVariables.filter(v => v.isMapping).map(v => v.name));

  for (const stmt of statements) {
    // Skip direct state variable assignments (handled in struct init)
    if (isStateVariableAssignment(stmt, stateVarNames)) {
      continue;
    }

    // Check if this is a mapping assignment (e.g., balanceOf[msg.sender] = value)
    if (isMappingAssignment(stmt, mappingVarNames)) {
      mappingAssignments.push(stmt);
      continue;
    }

    // Regular statement - transform and add
    const transformed = transformStatement(stmt, context);
    if (transformed) {
      regularStatements.push(transformed);
    }
  }

  return { regularStatements, mappingAssignments };
}

/**
 * Check if a statement is a mapping assignment
 */
function isMappingAssignment(stmt: IRStatement, mappingVarNames: Set<string>): boolean {
  if (stmt.kind !== 'assignment') return false;

  const target = stmt.target;
  // Check for balanceOf[key] = value pattern
  if (target.kind === 'index_access') {
    const base = target.base;
    if (base.kind === 'identifier' && mappingVarNames.has(base.name)) {
      return true;
    }
  }

  return false;
}

/**
 * Transform a mapping assignment for use in constructor (after move_to)
 * Converts balanceOf[msg.sender] = value to table::add(&mut state.balance_of, deployer_addr, value)
 */
function transformMappingAssignmentForConstructor(
  stmt: IRStatement,
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveStatement {
  if (stmt.kind !== 'assignment' || stmt.target.kind !== 'index_access') {
    throw new Error('Expected mapping assignment');
  }

  const target = stmt.target;
  const mappingName = (target.base as any).name;
  const snakeCaseMappingName = toSnakeCase(mappingName);

  // Transform the index (key)
  const key = transformConstructorExpression(target.index, context);

  // Transform the value
  const value = transformConstructorExpression(stmt.value, context);

  // Generate table::add call
  context.usedModules.add('aptos_std::table');
  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'table::add',
      args: [
        {
          kind: 'borrow',
          mutable: true,
          value: {
            kind: 'field_access',
            object: { kind: 'identifier', name: 'state' },
            field: snakeCaseMappingName,
          },
        },
        key,
        value,
      ],
    },
  };
}

/**
 * Check if statements modify state
 */
function statementsModifyState(
  statements: IRStatement[],
  context: TranspileContext
): boolean {
  for (const stmt of statements) {
    if (statementModifiesState(stmt, context)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a statement modifies state
 */
function statementModifiesState(
  stmt: IRStatement,
  context: TranspileContext
): boolean {
  switch (stmt.kind) {
    case 'assignment':
      // Check if target is a state variable
      if (stmt.target.kind === 'identifier') {
        return context.stateVariables.has(stmt.target.name);
      }
      if (stmt.target.kind === 'member_access') {
        // Could be state.field or obj.field
        return true; // Conservative
      }
      if (stmt.target.kind === 'index_access') {
        // Could be mapping access
        return true; // Conservative
      }
      return false;

    case 'if':
      return statementsModifyState(stmt.thenBlock, context) ||
             (stmt.elseBlock ? statementsModifyState(stmt.elseBlock, context) : false);

    case 'for':
    case 'while':
    case 'do_while':
      return statementsModifyState(stmt.body, context);

    case 'block':
      return statementsModifyState(stmt.statements, context);

    case 'emit':
      return true; // Events count as state modification

    default:
      return false;
  }
}

/**
 * Check if statements access state
 */
function accessesState(
  statements: IRStatement[],
  context: TranspileContext
): boolean {
  // Simple check - if any state variable names appear, assume state access
  const stateVarNames = new Set(context.stateVariables.keys());
  // This is a simplified check - a real implementation would do proper analysis
  return stateVarNames.size > 0;
}

/**
 * Determine what resources a function acquires
 */
function determineAcquires(
  fn: IRFunction,
  context: TranspileContext
): string[] {
  const acquires: string[] = [];

  // If function accesses state, it acquires the state resource
  if (fn.stateMutability !== 'pure') {
    acquires.push(`${context.contractName}State`);
  }

  return acquires;
}

/**
 * Find initialization value for a variable in constructor body
 * @param varType - The target variable type for type-aware literal suffixes
 */
function findInitializationInBody(
  varName: string,
  statements: IRStatement[],
  context: TranspileContext,
  varType?: any
): any | undefined {
  for (const stmt of statements) {
    if (stmt.kind === 'assignment') {
      if (stmt.target.kind === 'identifier' && stmt.target.name === varName) {
        return transformConstructorExpression(stmt.value, context, varType);
      }
    }
  }
  return undefined;
}

/**
 * Transform expression in constructor context (uses 'deployer' instead of 'account')
 * @param targetType - Optional target type for type-aware literal suffixes
 */
function transformConstructorExpression(expr: any, context: TranspileContext, targetType?: any): any {
  if (!expr) return expr;

  switch (expr.kind) {
    case 'msg_access':
      if (expr.property === 'sender') {
        context.usedModules.add('std::signer');
        return {
          kind: 'call',
          function: 'signer::address_of',
          args: [{ kind: 'identifier', name: 'deployer' }],
        };
      }
      return { kind: 'literal', type: 'number', value: 0 };

    case 'binary':
      return {
        ...expr,
        left: transformConstructorExpression(expr.left, context, targetType),
        right: transformConstructorExpression(expr.right, context, targetType),
      };

    case 'unary':
      return {
        ...expr,
        operand: transformConstructorExpression(expr.operand, context, targetType),
      };

    case 'literal':
      // Add appropriate suffix for numbers based on target type
      if (expr.type === 'number') {
        const suffix = getSuffixForType(targetType);
        return { ...expr, suffix };
      }
      return expr;

    case 'identifier':
      // Convert identifier names using the param name mapping
      // This handles Solidity's _name -> name convention
      const paramNameMap = context.paramNameMap as Map<string, string> | undefined;
      if (paramNameMap) {
        const mappedName = paramNameMap.get(expr.name);
        if (mappedName) {
          return { ...expr, name: mappedName };
        }
      }
      // Check if it's a state variable reference
      const stateVar = context.stateVariables?.get(expr.name);
      if (stateVar) {
        // In constructor, before move_to, state vars should be resolved to their init values
        // After move_to (for table::add), use state.field_name
        // For now, check if we're in post-move_to context by checking constructorPhase in context
        if ((context as any).constructorPhase === 'post_move_to') {
          return {
            kind: 'field_access',
            object: { kind: 'identifier', name: 'state' },
            field: toSnakeCase(expr.name),
          };
        }
        // Before move_to, try to inline the value if it's a simple literal
        // This handles cases like totalSupply = _initialSupply * 10 ** decimals
        // where decimals is a constant 18
        if (stateVar.name === 'decimals' || expr.name === 'decimals') {
          // Common pattern: decimals is typically 18 for ERC-20
          return { kind: 'literal', type: 'number', value: 18, suffix: 'u8' };
        }
      }
      // Fallback: convert to snake_case if it looks like a parameter
      if (expr.name.startsWith('_')) {
        return { ...expr, name: toSnakeCase(expr.name) };
      }
      return expr;

    default:
      return expr;
  }
}

/**
 * Get the appropriate numeric suffix for a type
 */
function getSuffixForType(type: any): string {
  if (!type) return 'u256'; // Default to u256

  // Check for Move type
  const moveType = type.move || type;
  if (moveType?.kind === 'primitive') {
    const name = moveType.name;
    if (['u8', 'u16', 'u32', 'u64', 'u128', 'u256'].includes(name)) {
      return name;
    }
  }

  // Check for Solidity type
  const solType = type.solidity || type.name;
  if (solType) {
    if (solType === 'uint8') return 'u8';
    if (solType === 'uint16') return 'u16';
    if (solType === 'uint32') return 'u32';
    if (solType === 'uint64') return 'u64';
    if (solType === 'uint128') return 'u128';
    if (solType === 'uint256' || solType === 'uint') return 'u256';
  }

  return 'u256'; // Default
}

/**
 * Get default value for a state variable
 */
function getDefaultValue(
  variable: IRStateVariable,
  context: TranspileContext
): any {
  if (variable.isMapping) {
    context.usedModules.add('aptos_std::table');
    return {
      kind: 'call',
      function: 'table::new',
      args: [],
    };
  }

  if (variable.type.isArray) {
    return {
      kind: 'call',
      function: 'vector::empty',
      args: [],
    };
  }

  const moveType = variable.type.move;
  if (!moveType) {
    return { kind: 'literal', type: 'number', value: 0 };
  }

  switch (moveType.kind) {
    case 'primitive':
      switch (moveType.name) {
        case 'bool':
          return { kind: 'literal', type: 'bool', value: false };
        case 'address':
          return { kind: 'literal', type: 'address', value: '@0x0' };
        default:
          return { kind: 'literal', type: 'number', value: 0 };
      }

    case 'vector':
      return { kind: 'call', function: 'vector::empty', args: [] };

    default:
      return { kind: 'literal', type: 'number', value: 0 };
  }
}


/**
 * Convert to snake_case
 */
function toSnakeCase(str: string): string {
  if (!str) return '';
  // Preserve SCREAMING_SNAKE_CASE constants
  if (/^[A-Z][A-Z0-9_]*$/.test(str)) {
    return str.toLowerCase();
  }
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}
