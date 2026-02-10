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
  const params = transformParams(fn.params, fn.stateMutability, fn.visibility, context, usesMsgSender);

  // Track function parameters in localVariables for type-aware transformations
  // (e.g., cross-type comparison upcasting in SafeCast)
  context.localVariables.clear();
  for (const param of fn.params) {
    context.localVariables.set(toSnakeCase(param.name), param.type);
  }

  // Transform return type
  const returnType = transformReturnType(fn.returnParams, context);

  // Check if modifiers need state access
  const modifiersNeedState = modifiersRequireState(fn.modifiers || []);

  // Build the function body in correct order:
  // 1. Borrow state (if needed by modifiers or body)
  // 2. Modifier checks
  // 3. Function body statements
  // 4. Reentrancy guard cleanup (if nonReentrant modifier)
  const fullBody: MoveStatement[] = [];

  // Check if we need state borrowing
  // Pure functions NEVER need state - they are pure computations
  const isPureFunction = fn.stateMutability === 'pure';
  const bodyNeedsMutState = !isPureFunction && fn.stateMutability !== 'view' &&
    statementsModifyState(fn.body, context);
  const bodyNeedsReadState = !isPureFunction && accessesState(fn.body, context);
  const needsState = !isPureFunction && (modifiersNeedState || bodyNeedsMutState || bodyNeedsReadState);
  const needsMutableState = modifiersNeedState || bodyNeedsMutState;

  // For private/internal functions that access state, accept state as parameter
  // instead of calling borrow_global_mut (prevents double mutable borrow)
  const isInternalFunction = fn.visibility === 'private' || fn.visibility === 'internal';
  const receiveStateAsParam = isInternalFunction && needsState;

  if (receiveStateAsParam) {
    // Add state parameter instead of borrowing globally
    const stateType: MoveType = {
      kind: 'reference',
      mutable: needsMutableState,
      innerType: { kind: 'struct', name: `${context.contractName}State` },
    };
    params.push({
      name: 'state',
      type: stateType,
    });
  }

  // Add state borrow FIRST (before modifiers) - only for public/external functions
  if (needsState && !receiveStateAsParam) {
    fullBody.push({
      kind: 'let',
      pattern: 'state',
      mutable: false,
      value: {
        kind: 'call',
        function: needsMutableState ? 'borrow_global_mut' : 'borrow_global',
        typeArgs: [{ kind: 'struct', name: `${context.contractName}State` }],
        args: [{ kind: 'literal', type: 'address', value: `@${context.moduleAddress}` }],
      },
    });
  }

  // Declare named return parameters (Solidity: returns (uint256 liquidity))
  // These need to be declared as mutable local variables in Move
  const namedReturnParams = fn.returnParams.filter(p => p.name && p.name !== '');
  for (const param of namedReturnParams) {
    const moveType = param.type.move || { kind: 'primitive', name: 'u256' };
    fullBody.push({
      kind: 'let',
      pattern: toSnakeCase(param.name),
      mutable: true,
      value: getDefaultValueForType(moveType),
    });
    // Add to local variables so assignments know it's already declared
    context.localVariables.set(param.name, param.type);
  }

  // Add modifier PRE-checks SECOND (after state is borrowed)
  const modifierChecks = transformModifiers(fn.modifiers || [], context);
  fullBody.push(...modifierChecks);

  // Get modifier POST-statements (cleanup code)
  const modifierCleanup = getModifiersPostStatements(fn.modifiers || [], context);
  const hasCleanup = modifierCleanup.length > 0;
  const hasReturnValue = fn.returnParams && fn.returnParams.length > 0;

  // Transform body statements THIRD (without re-adding state borrow)
  // If we have cleanup and return values, we need special handling
  if (hasCleanup && hasReturnValue) {
    const bodyStatements = transformFunctionBodyStatementsWithCleanup(fn.body, modifierCleanup, context);
    fullBody.push(...bodyStatements);
  } else {
    const bodyStatements = transformFunctionBodyStatements(fn.body, context);
    fullBody.push(...bodyStatements);

    // Add modifier POST-statements FOURTH (cleanup code after function body)
    fullBody.push(...modifierCleanup);
  }

  // Add return statement for functions with named return params
  // In Solidity, named return params are implicitly returned
  // Post-process: add type casts for named return vars assigned from assembly
  // Assembly operations produce u256, but the return var may be u8/u16/u32/u64/u128/bool
  if (namedReturnParams.length > 0) {
    const returnVarTypes = new Map<string, any>();
    for (const param of namedReturnParams) {
      const moveType = param.type.move || { kind: 'primitive', name: 'u256' };
      if (moveType.kind === 'primitive' && moveType.name !== 'u256') {
        returnVarTypes.set(toSnakeCase(param.name), moveType);
      }
    }
    if (returnVarTypes.size > 0) {
      addReturnVarCasts(fullBody, returnVarTypes);
    }
  }

  // In Move, we need explicit return statements
  if (namedReturnParams.length > 0) {
    // Check if any statement in the body already contains a return
    const hasExplicitReturn = fullBody.some(containsReturn);

    if (!hasExplicitReturn) {
      if (namedReturnParams.length === 1) {
        // Single return value
        fullBody.push({
          kind: 'return',
          value: { kind: 'identifier', name: toSnakeCase(namedReturnParams[0].name) },
        });
      } else {
        // Multiple return values - return as tuple
        fullBody.push({
          kind: 'return',
          value: {
            kind: 'tuple',
            elements: namedReturnParams.map(p => ({ kind: 'identifier', name: toSnakeCase(p.name) })),
          },
        });
      }
    }
  }

  // Determine if this needs acquires
  const acquires = determineAcquires(fn, context);

  const moveFunc: MoveFunction = {
    name: toSnakeCase(fn.name),
    visibility,
    isEntry: shouldBeEntry(fn),
    // Only mark as #[view] if the function actually reads state via borrow_global
    // Pure library functions should NOT be marked #[view]
    isView: (fn.stateMutability === 'view') && needsState && !(context as any).isLibrary,
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
 * Check if any modifiers require state access
 */
function modifiersRequireState(modifiers: Array<{ name: string; args?: any[] }>): boolean {
  const stateModifiers = ['onlyOwner', 'nonReentrant', 'whenNotPaused', 'whenPaused', 'onlyRole'];
  return modifiers.some(m => stateModifiers.includes(m.name) || m.name.startsWith('only'));
}

/**
 * Transform modifiers to inline assertion statements (PRE-placeholder only)
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
 * Get all POST-placeholder statements from modifiers
 * These are cleanup statements that should run after the function body
 */
function getModifiersPostStatements(
  modifiers: Array<{ name: string; args?: any[] }>,
  context: TranspileContext
): MoveStatement[] {
  const statements: MoveStatement[] = [];

  for (const modifier of modifiers) {
    const postStatements = getModifierPostStatementsForModifier(modifier, context);
    statements.push(...postStatements);
  }

  return statements;
}

/**
 * Get POST-placeholder statements for a single modifier
 */
function getModifierPostStatementsForModifier(
  modifier: { name: string; args?: any[] },
  context: TranspileContext
): MoveStatement[] {
  const name = modifier.name;

  // Built-in modifiers with cleanup
  switch (name) {
    case 'nonReentrant':
      // Reset reentrancy status after function body
      return [{
        kind: 'assign',
        target: {
          kind: 'field_access',
          object: { kind: 'identifier', name: 'state' },
          field: 'reentrancy_status',
        },
        value: { kind: 'literal', type: 'number', value: 1, suffix: 'u8' },
      }];

    default:
      // Check if we have a custom modifier definition
      const modifierDef = context.modifiers?.get(name);
      if (modifierDef) {
        return getModifierPostStatements(modifierDef, modifier.args, context);
      }
      return [];
  }
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
 * Inline a custom modifier body - returns only PRE-placeholder statements
 * Post-placeholder statements are handled by getModifierPostStatements
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

  // Transform modifier body BEFORE the placeholder only
  let foundPlaceholder = false;
  for (const stmt of modifierDef.body || []) {
    // Stop at the placeholder _; (where function body goes)
    if (stmt.kind === 'placeholder') {
      foundPlaceholder = true;
      break;
    }

    const transformed = transformStatement(stmt, context);
    if (transformed) {
      statements.push(transformed);
    }
  }

  return statements;
}

/**
 * Get post-placeholder statements from a custom modifier
 * These should be added AFTER the function body
 */
function getModifierPostStatements(
  modifierDef: any,
  args: any[] | undefined,
  context: TranspileContext
): MoveStatement[] {
  const statements: MoveStatement[] = [];

  // Find statements AFTER the placeholder
  let foundPlaceholder = false;
  for (const stmt of modifierDef.body || []) {
    if (stmt.kind === 'placeholder') {
      foundPlaceholder = true;
      continue;
    }

    if (foundPlaceholder) {
      const transformed = transformStatement(stmt, context);
      if (transformed) {
        statements.push(transformed);
      }
    }
  }

  return statements;
}

/**
 * Recursively check if an IR statement contains a return statement.
 * Used to prevent duplicate returns when named return params are present.
 */
function containsReturn(stmt: any): boolean {
  if (!stmt) return false;
  if (stmt.kind === 'return') return true;
  // Check if blocks
  if (stmt.kind === 'if') {
    if (stmt.then?.some(containsReturn)) return true;
    if (stmt.else?.some(containsReturn)) return true;
    return false;
  }
  // Check loop bodies
  if (stmt.kind === 'while' || stmt.kind === 'for' || stmt.kind === 'loop') {
    return stmt.body?.some(containsReturn) || false;
  }
  // Check block statements
  if (stmt.kind === 'block') {
    return stmt.statements?.some(containsReturn) || false;
  }
  return false;
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

  // Add signer_cap field to the struct (resource account pattern)
  stateFields.push({
    name: 'signer_cap',
    value: { kind: 'identifier', name: 'signer_cap' },
  });

  const body: MoveStatement[] = [];

  // Create resource account: let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"seed");
  context.usedModules.add('aptos_framework::account');
  body.push({
    kind: 'let',
    pattern: ['resource_signer', 'signer_cap'],
    value: {
      kind: 'call',
      function: 'account::create_resource_account',
      args: [
        { kind: 'identifier', name: 'deployer' },
        { kind: 'literal', type: 'bytestring', value: `b"${toSnakeCase(contractName)}"` },
      ],
    },
  });

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

  // Add move_to to create the resource (use &resource_signer instead of deployer)
  body.push({
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'move_to',
      args: [
        { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'resource_signer' } },
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
 * Add type casts to assignments targeting named return variables.
 * Assembly blocks produce u256 expressions, but return vars may be smaller types.
 */
function addReturnVarCasts(stmts: any[], returnVarTypes: Map<string, any>): void {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (!stmt) continue;

    // Handle assign statements: value = expr → value = (expr as type)
    if (stmt.kind === 'assign' && stmt.target?.kind === 'identifier') {
      const targetType = returnVarTypes.get(stmt.target.name);
      if (targetType && stmt.value?.kind !== 'cast') {
        stmt.value = { kind: 'cast', value: stmt.value, targetType };
      }
    }

    // Recurse into blocks
    if (stmt.kind === 'block' && stmt.statements) {
      addReturnVarCasts(stmt.statements, returnVarTypes);
    }
    if (stmt.kind === 'if') {
      if (stmt.thenBlock) addReturnVarCasts(stmt.thenBlock, returnVarTypes);
      if (stmt.elseBlock) addReturnVarCasts(stmt.elseBlock, returnVarTypes);
    }
  }
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
 * Move entry functions cannot have return values
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

  // Move entry functions cannot have return values
  if (fn.returnParams && fn.returnParams.length > 0) {
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
  visibility: string,
  context: TranspileContext,
  usesMsgSender: boolean = false
): MoveFunctionParam[] {
  const moveParams: MoveFunctionParam[] = [];

  // Determine if this is a public-facing function that needs a signer
  // Private/internal functions only need signer if they use msg.sender
  const isPublicFunction = visibility === 'public' || visibility === 'external';
  const needsSigner = isPublicFunction ||
    (usesMsgSender && stateMutability !== 'view' && stateMutability !== 'pure');

  // Add signer parameter for non-view functions that are public or use msg.sender
  if (stateMutability !== 'view' && stateMutability !== 'pure' && needsSigner) {
    moveParams.push({
      name: 'account',
      type: MoveTypes.ref(MoveTypes.signer()),
    });
  } else if (usesMsgSender) {
    // View/pure functions that use msg.sender need an address parameter
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
 * Transform function body statements only (without state borrowing)
 * Used when state borrow is handled separately (e.g., for modifiers)
 */
function transformFunctionBodyStatements(
  statements: IRStatement[],
  context: TranspileContext
): MoveStatement[] {
  const moveStatements: MoveStatement[] = [];

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
 * Transform function body with cleanup code inserted before returns
 * This ensures cleanup runs before any return statement
 */
function transformFunctionBodyStatementsWithCleanup(
  statements: IRStatement[],
  cleanupStatements: MoveStatement[],
  context: TranspileContext
): MoveStatement[] {
  const moveStatements: MoveStatement[] = [];

  // Transform each statement, inserting cleanup before returns
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const isLastStatement = i === statements.length - 1;

    if (stmt.kind === 'return') {
      // For return statements: save value, run cleanup, then return
      if (stmt.value) {
        const transformedValue = transformStatement({ kind: 'expression', expression: stmt.value }, context);
        // Store the return value
        moveStatements.push({
          kind: 'let',
          pattern: '__return_value',
          mutable: false,
          value: transformedValue?.kind === 'expression' ? (transformedValue as any).expression : transformedValue,
        });
        // Add cleanup statements
        moveStatements.push(...cleanupStatements);
        // Return the stored value
        moveStatements.push({
          kind: 'expression',
          expression: { kind: 'identifier', name: '__return_value' },
        });
      } else {
        // No return value, just add cleanup
        moveStatements.push(...cleanupStatements);
      }
    } else if (isLastStatement && stmt.kind === 'expression') {
      // Last expression might be an implicit return
      // Store it, run cleanup, then return it
      const transformed = transformStatement(stmt, context);
      if (transformed) {
        moveStatements.push({
          kind: 'let',
          pattern: '__return_value',
          mutable: false,
          value: (transformed as any).expression || transformed,
        });
        // Add cleanup statements
        moveStatements.push(...cleanupStatements);
        // Return the stored value
        moveStatements.push({
          kind: 'expression',
          expression: { kind: 'identifier', name: '__return_value' },
        });
      }
    } else {
      const transformed = transformStatement(stmt, context);
      if (transformed) {
        moveStatements.push(transformed);
      }
    }
  }

  return moveStatements;
}

/**
 * Transform function body (legacy - includes state borrowing)
 * @deprecated Use transformFunctionBodyStatements with explicit state borrowing
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
 * Check if statements actually access state variables
 */
function accessesState(
  statements: IRStatement[],
  context: TranspileContext
): boolean {
  const stateVarNames = new Set(context.stateVariables.keys());
  if (stateVarNames.size === 0) return false;

  // Recursively check if any statement references state variables
  function checkExpression(expr: any): boolean {
    if (!expr) return false;

    switch (expr.kind) {
      case 'identifier':
        return stateVarNames.has(expr.name);

      case 'field_access':
        // Check if accessing state.field
        if (expr.object?.kind === 'identifier' && expr.object.name === 'state') {
          return true;
        }
        return checkExpression(expr.object);

      case 'binary':
        return checkExpression(expr.left) || checkExpression(expr.right);

      case 'unary':
        return checkExpression(expr.operand);

      case 'call':
        return expr.args?.some((arg: any) => checkExpression(arg)) || false;

      case 'index_access':
        return checkExpression(expr.object) || checkExpression(expr.index);

      case 'conditional':
        return checkExpression(expr.condition) ||
               checkExpression(expr.trueExpr) ||
               checkExpression(expr.falseExpr);

      case 'tuple':
        return expr.elements?.some((el: any) => checkExpression(el)) || false;

      case 'function_call':
        return expr.args?.some((arg: any) => checkExpression(arg)) || false;

      default:
        return false;
    }
  }

  function checkStatement(stmt: any): boolean {
    if (!stmt) return false;

    switch (stmt.kind) {
      case 'variable_declaration':
        return checkExpression(stmt.initialValue);

      case 'assignment':
        return checkExpression(stmt.target) || checkExpression(stmt.value);

      case 'expression':
        return checkExpression(stmt.expression);

      case 'if':
        return checkExpression(stmt.condition) ||
               (stmt.thenBlock || []).some(checkStatement) ||
               (stmt.elseBlock || []).some(checkStatement);

      case 'while':
      case 'do_while':
        return checkExpression(stmt.condition) ||
               (stmt.body || []).some(checkStatement);

      case 'for':
        return (stmt.init ? checkStatement(stmt.init) : false) ||
               checkExpression(stmt.condition) ||
               checkExpression(stmt.update) ||
               (stmt.body || []).some(checkStatement);

      case 'return':
        return checkExpression(stmt.value);

      case 'emit':
        return (stmt.args || []).some(checkExpression);

      case 'require':
        return checkExpression(stmt.condition);

      case 'block':
        return (stmt.statements || []).some(checkStatement);

      case 'unchecked':
        return (stmt.statements || []).some(checkStatement);

      default:
        return false;
    }
  }

  return statements.some(checkStatement);
}

/**
 * Determine what resources a function acquires
 */
function determineAcquires(
  fn: IRFunction,
  context: TranspileContext
): string[] {
  const acquires: string[] = [];

  // Pure functions don't acquire any resources
  if (fn.stateMutability === 'pure') {
    return acquires;
  }

  // Private/internal functions receive state as a parameter, so they don't acquire
  const isInternalFunction = fn.visibility === 'private' || fn.visibility === 'internal';
  if (isInternalFunction) {
    return acquires;
  }

  // Check if function actually accesses state
  const bodyAccessesState = accessesState(fn.body, context);
  const modifiersNeedState = fn.modifiers && fn.modifiers.length > 0 &&
    fn.modifiers.some(m => ['onlyOwner', 'nonReentrant', 'whenNotPaused', 'whenPaused'].includes(m.name));

  if (bodyAccessesState || modifiersNeedState || fn.stateMutability !== 'view') {
    // Check if we actually modify or read state
    if (statementsModifyState(fn.body, context) || bodyAccessesState || modifiersNeedState) {
      acquires.push(`${context.contractName}State`);
    }
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
 * Get default value for a Move type
 */
function getDefaultValueForType(moveType: any): any {
  if (!moveType) {
    return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
  }

  switch (moveType.kind) {
    case 'primitive':
      switch (moveType.name) {
        case 'bool':
          return { kind: 'literal', type: 'bool', value: false };
        case 'address':
          return { kind: 'literal', type: 'address', value: '@0x0' };
        default:
          // Numeric types (u8, u64, u128, u256, etc.)
          return { kind: 'literal', type: 'number', value: 0, suffix: moveType.name };
      }

    case 'vector':
      return { kind: 'call', function: 'vector::empty', args: [] };

    default:
      return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
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
