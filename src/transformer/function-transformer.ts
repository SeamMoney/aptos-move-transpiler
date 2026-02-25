/**
 * Function Transformer
 * Transforms Solidity functions to Move functions
 */

import type { MoveFunction, MoveFunctionParam, MoveStatement, MoveType, MoveVisibility } from '../types/move-ast.js';
import type { IRFunction, IRConstructor, IRFunctionParam, IRStateVariable, IRStatement, TranspileContext } from '../types/ir.js';
import { MoveTypes } from '../types/move-ast.js';
import { transformStatement, wrapErrorCode } from './expression-transformer.js';

/**
 * Get the configured signer parameter name from context.
 * Returns 'account' (default) or 'signer' depending on the signerParamName flag.
 */
function signerName(context: TranspileContext): string {
  return context.signerParamName || 'account';
}

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
  const visibility = mapVisibility(fn.visibility, fn.stateMutability, context.internalVisibility);

  // Check if function body uses msg.sender (needed for view functions)
  const usesMsgSender = bodyUsesMsgSender(fn.body);
  const signerRequirementFromCalls = bodyCallsSignerDependentInternalFunction(fn.body, context);

  // Transform parameters
  const params = transformParams(
    fn.params,
    fn.stateMutability,
    fn.visibility,
    context,
    usesMsgSender,
    signerRequirementFromCalls
  );
  const functionSignerKind = inferFunctionSignerKind(params, context);
  (context as any).currentFunctionSignerKind = functionSignerKind;

  // Track function parameters in localVariables for type-aware transformations
  // (e.g., cross-type comparison upcasting in SafeCast)
  context.localVariables.clear();
  for (const param of fn.params) {
    context.localVariables.set(toSnakeCase(param.name), param.type);
  }

  // Transform return type
  const returnType = transformReturnType(fn.returnParams, context);

  // Check if modifiers need state access
  const modifiersNeedState = modifiersRequireState(fn.modifiers || [], context);

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
  const profileLookupName = ((fn as any).originalName as string | undefined) || fn.name;

  // Multi-resource borrowing for medium/high optimization
  const useMultiResource = context.resourcePlan && context.optimizationLevel !== 'low';

  if (useMultiResource) {
    const plan = context.resourcePlan!;
    const fnProfile = plan.functionProfiles.get(profileLookupName) || plan.functionProfiles.get(fn.name);

    if (fnProfile && (fnProfile.readsResources.size > 0 || fnProfile.writesResources.size > 0) && !isPureFunction) {
      const allNeeded = new Set([...fnProfile.readsResources, ...fnProfile.writesResources]);

      if (receiveStateAsParam) {
        // Internal function: accept each needed resource group as a parameter
        for (const groupName of allNeeded) {
          const isMut = fnProfile.writesResources.has(groupName);
          const localName = groupNameToLocal(groupName);
          params.push({
            name: localName,
            type: {
              kind: 'reference',
              mutable: isMut,
              innerType: { kind: 'struct', name: groupName },
            },
          });
        }
      } else {
        // Public function: borrow each needed resource group
        const borrowAddr = buildStateBorrowAddress(context);
        for (const groupName of allNeeded) {
          const isMut = fnProfile.writesResources.has(groupName);
          const localName = groupNameToLocal(groupName);
          fullBody.push({
            kind: 'let',
            pattern: localName,
            mutable: false,
            value: {
              kind: 'call',
              function: isMut ? 'borrow_global_mut' : 'borrow_global',
              typeArgs: [{ kind: 'struct', name: groupName }],
              args: [borrowAddr],
            },
          });
        }
      }
    }

    // Per-user resources (high optimization): call ensure_user_state at function start
    // for functions that write to per-user mapping variables
    if (plan.perUserResources && !receiveStateAsParam) {
      const perUserVarNames = new Set(plan.perUserResources.fields.map(f => f.varName));
      // Check if this function writes to any per-user variable
      const fnProfile = plan.functionProfiles.get(profileLookupName) || plan.functionProfiles.get(fn.name);
      let writesPerUser = false;
      if (fnProfile) {
        // Check write resources — but per-user vars aren't in groups.
        // Instead, check if the function body writes any per-user variable.
        // Simple heuristic: scan IR body for assignments to per-user variables.
        writesPerUser = functionWritesPerUserVar(fn, perUserVarNames);
      }
      if (writesPerUser) {
        // ensure_user_state(signer) — the signer param name is configurable
        fullBody.push({
          kind: 'expression',
          expression: {
            kind: 'call',
            function: 'ensure_user_state',
            args: [{ kind: 'identifier', name: signerName(context) }],
          },
        });
      }
    }
  } else {
    // Low optimization: single resource struct (current behavior)
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
      const borrowAddress = buildStateBorrowAddress(context);
      fullBody.push({
        kind: 'let',
        pattern: 'state',
        mutable: false,
        value: {
          kind: 'call',
          function: needsMutableState ? 'borrow_global_mut' : 'borrow_global',
          typeArgs: [{ kind: 'struct', name: `${context.contractName}State` }],
          args: [borrowAddress],
        },
      });
    }
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
      value: getDefaultValueForType(moveType, context),
    });
    // Add to local variables so assignments know it's already declared
    // Use snake_case name to match how lookupVariableType queries
    context.localVariables.set(toSnakeCase(param.name), param.type);
  }

  // Add modifier PRE-checks SECOND (after state is borrowed)
  const modifierChecks = transformModifiers(fn.modifiers || [], context);
  fullBody.push(...modifierChecks);

  // Get modifier POST-statements (cleanup code)
  const modifierCleanup = getModifiersPostStatements(fn.modifiers || [], context);
  const bodyStatements = transformFunctionBodyStatements(fn.body, context);

  // Generate table write-back statements for mutated local copies.
  // When Solidity code does `Pool storage pool = pools[id]; pool.reserve0 += x;`,
  // the transpiler creates a local copy. We must write it back via table::upsert.
  const tableCopyOrigins = (context as any)._tableCopyOrigins as Map<string, {
    mappingName: string;
    key: any;
    outerKey?: any;
    nested?: boolean;
    mutated: boolean;
  }> | undefined;
  const writeBackStatements: MoveStatement[] = [];
  if (tableCopyOrigins) {
    for (const [localName, origin] of tableCopyOrigins) {
      if (origin.mutated) {
        const tableModName = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
        context.usedModules.add(context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table');

        if (origin.nested && origin.outerKey) {
          // Nested mapping: positions[poolId][user] = pos
          // → table::upsert(table::borrow_mut(&mut state.positions, poolId), user, pos)
          writeBackStatements.push({
            kind: 'expression',
            expression: {
              kind: 'call',
              function: `${tableModName}::upsert`,
              args: [
                {
                  kind: 'call',
                  function: `${tableModName}::borrow_mut`,
                  args: [
                    {
                      kind: 'borrow',
                      mutable: true,
                      value: {
                        kind: 'field_access',
                        object: { kind: 'identifier', name: 'state' },
                        field: toSnakeCase(origin.mappingName),
                      },
                    },
                    origin.outerKey,
                  ],
                },
                origin.key,
                { kind: 'identifier', name: localName },
              ],
            },
          } as any);
        } else {
          // Flat mapping: pools[id] = pool
          // → table::upsert(&mut state.pools, id, pool)
          writeBackStatements.push({
            kind: 'expression',
            expression: {
              kind: 'call',
              function: `${tableModName}::upsert`,
              args: [
                {
                  kind: 'borrow',
                  mutable: true,
                  value: {
                    kind: 'field_access',
                    object: { kind: 'identifier', name: 'state' },
                    field: toSnakeCase(origin.mappingName),
                  },
                },
                origin.key,
                { kind: 'identifier', name: localName },
              ],
            },
          } as any);
        }
      }
    }
    (context as any)._tableCopyOrigins = undefined;
  }

  // Merge write-backs into modifier cleanup so they run before reentrancy unlock
  // and before every explicit return.
  const allCleanup = [...writeBackStatements, ...modifierCleanup];
  const hasCleanup = allCleanup.length > 0;

  // Ensure cleanup runs before every explicit return and also on fallthrough.
  if (hasCleanup) {
    fullBody.push(...injectCleanupBeforeReturns(bodyStatements, allCleanup));
    fullBody.push(...allCleanup.map(cloneMoveStatement));
  } else {
    fullBody.push(...bodyStatements);
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

  // Prefix unused named return params with `_` to suppress Move warnings
  if (namedReturnParams.length > 0) {
    for (const param of namedReturnParams) {
      const varName = toSnakeCase(param.name);
      // Check if the variable is actually used in the body (beyond its own declaration)
      const isUsed = isVariableReferencedInStatements(varName, fullBody);
      if (!isUsed) {
        // Find the let statement and prefix the pattern with _
        for (const stmt of fullBody) {
          if (stmt.kind === 'let' && stmt.pattern === varName) {
            stmt.pattern = `_${varName}`;
            break;
          }
        }
      }
    }
  }

  // Determine acquires by scanning the generated Move body for borrow_global calls
  const acquires = determineAcquiresFromBody(fullBody, fn, context);

  const moveFunc: MoveFunction = {
    name: toSnakeCase(fn.name),
    visibility,
    isEntry: shouldBeEntry(fn),
    // Only mark as #[view] if the function actually reads state via borrow_global
    // Pure library functions should NOT be marked #[view]
    isView: context.viewFunctionBehavior !== 'skip' && (fn.stateMutability === 'view') && needsState && !(context as any).isLibrary,
    params,
    body: fullBody,
  };

  // Mark private functions with simple bodies as inline when flag is enabled
  // Criteria: private visibility, no state access, ≤5 statements, not entry
  if (context.useInlineFunctions && visibility === 'private' && !needsState && !moveFunc.isEntry && fullBody.length <= 5) {
    moveFunc.isInline = true;
  }

  // Attach source comment if flag is enabled
  if (context.emitSourceComments) {
    moveFunc.sourceComment = `Solidity: ${fn.name}(${(fn.params || []).map((p: any) => p.type?.solidity || '').join(', ')})`;
  }

  if (returnType) {
    moveFunc.returnType = returnType;
  }

  if (acquires.length > 0) {
    moveFunc.acquires = acquires;
  }

  context.currentFunction = undefined;
  context.currentFunctionStateMutability = undefined;
  delete (context as any).currentFunctionSignerKind;
  return moveFunc;
}

/**
 * Check if any modifiers require state access.
 * In capability mode, onlyOwner and onlyRole use exists<> which does not need state borrow.
 */
function modifiersRequireState(
  modifiers: Array<{ name: string; args?: any[] }>,
  context: TranspileContext
): boolean {
  // Modifiers that always require state access (regardless of accessControl mode)
  const alwaysStateModifiers = ['nonReentrant', 'whenNotPaused', 'whenPaused'];
  // Modifiers that only require state in inline-assert mode (not capability mode)
  const accessControlModifiers = ['onlyOwner', 'onlyRole'];

  return modifiers.some(m => {
    if (alwaysStateModifiers.includes(m.name)) return true;
    if (accessControlModifiers.includes(m.name)) {
      // In capability mode, these use exists<> and don't need state
      return context.accessControl !== 'capability';
    }
    // Generic 'only*' modifiers: assume they need state
    if (m.name.startsWith('only')) return true;
    return false;
  });
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
    case 'nonReentrant': {
      // When reentrancyPattern is 'none', skip cleanup
      if (context.reentrancyPattern === 'none') {
        return [];
      }
      // Reset reentrancy status after function body
      const reentrancyObj = resolveStateObject('reentrancy_status', context);
      return [{
        kind: 'assign',
        target: {
          kind: 'field_access',
          object: { kind: 'identifier', name: reentrancyObj },
          field: 'reentrancy_status',
        },
        value: { kind: 'literal', type: 'number', value: 1, suffix: 'u8' },
      }];
    }

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
      // When reentrancyPattern is 'none', skip guard (Move ownership prevents reentrancy)
      if (context.reentrancyPattern === 'none') {
        return [];
      }
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

      // Unknown modifier - add a comment/warning and register error constant
      context.warnings.push({
        message: `Unknown modifier '${name}' - manual translation may be required`,
        severity: 'warning',
      });
      const errorName = `E_MODIFIER_${toScreamingSnakeCase(name)}`;
      if (!context.errorCodes) context.errorCodes = new Map();
      if (!context.errorCodes.has(errorName)) {
        context.errorCodes.set(errorName, { message: `Modifier ${name} check`, code: context.errorCodes.size + 1 });
      }
      return [{
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'assert!',
          args: [
            { kind: 'literal', type: 'bool', value: true },
            { kind: 'identifier', name: errorName },
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

  // Capability pattern: assert!(exists<OwnerCapability>(signer::address_of(account)), E_UNAUTHORIZED)
  if (context.accessControl === 'capability') {
    return [{
      kind: 'expression',
      expression: {
        kind: 'call',
        function: 'assert!',
        args: [
          {
            kind: 'call',
            function: 'exists<OwnerCapability>',
            args: [{
              kind: 'call',
              function: 'signer::address_of',
              args: [{ kind: 'identifier', name: signerName(context) }],
            }],
          },
          wrapErrorCode('E_UNAUTHORIZED', context),
        ],
      },
    }];
  }

  // Default inline-assert pattern: assert!(signer::address_of(account) == state.owner, E_UNAUTHORIZED)
  const ownerObj = resolveStateObject('owner', context);

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
            args: [{ kind: 'identifier', name: signerName(context) }],
          },
          right: {
            kind: 'field_access',
            object: { kind: 'identifier', name: ownerObj },
            field: 'owner',
          },
        },
        wrapErrorCode('E_UNAUTHORIZED', context),
      ],
    },
  }];
}

/**
 * Generate reentrancy guard check
 * Uses status field pattern from evm_compat
 */
function generateReentrancyGuard(context: TranspileContext): MoveStatement[] {
  const reentrancyObj = resolveStateObject('reentrancy_status', context);
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
              object: { kind: 'identifier', name: reentrancyObj },
              field: 'reentrancy_status',
            },
            right: { kind: 'literal', type: 'number', value: 2, suffix: 'u8' },
          },
          wrapErrorCode('E_REENTRANCY', context),
        ],
      },
    },
    // Set entered status
    {
      kind: 'assign',
      target: {
        kind: 'field_access',
        object: { kind: 'identifier', name: reentrancyObj },
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
  const pausedObj = resolveStateObject('paused', context);
  return [{
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'assert!',
      args: [
        requirePaused
          ? {
              kind: 'field_access',
              object: { kind: 'identifier', name: pausedObj },
              field: 'paused',
            }
          : {
              kind: 'unary',
              operator: '!',
              operand: {
                kind: 'field_access',
                object: { kind: 'identifier', name: pausedObj },
                field: 'paused',
              },
            },
        wrapErrorCode('E_PAUSED', context),
      ],
    },
  }];
}

/**
 * Generate role check (for AccessControl pattern)
 */
function generateRoleCheck(roleArg: any, context: TranspileContext): MoveStatement[] {
  context.usedModules.add('std::signer');

  // Derive the role name for capability struct naming
  const roleName = roleArg
    ? String(roleArg.value || roleArg.name || 'ADMIN_ROLE')
    : 'ADMIN_ROLE';

  // Capability pattern: assert!(exists<RoleCapability>(signer::address_of(account)), E_UNAUTHORIZED)
  if (context.accessControl === 'capability') {
    // Convert role name to PascalCase capability struct name
    // e.g., ADMIN_ROLE -> AdminRoleCapability, MINTER_ROLE -> MinterRoleCapability
    const capName = roleNameToCapabilityStruct(roleName);

    return [{
      kind: 'expression',
      expression: {
        kind: 'call',
        function: 'assert!',
        args: [
          {
            kind: 'call',
            function: `exists<${capName}>`,
            args: [{
              kind: 'call',
              function: 'signer::address_of',
              args: [{ kind: 'identifier', name: signerName(context) }],
            }],
          },
          wrapErrorCode('E_UNAUTHORIZED', context),
        ],
      },
    }];
  }

  // Default inline-assert pattern: table::contains check
  const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
  const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
  context.usedModules.add(tblModPath);

  const roleExpr = roleArg
    ? { kind: 'identifier', name: toSnakeCase(roleName) }
    : { kind: 'identifier', name: 'ADMIN_ROLE' };

  return [{
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'assert!',
      args: [
        {
          kind: 'call',
          function: `${tblModPrefix}::contains`,
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
              args: [{ kind: 'identifier', name: signerName(context) }],
            },
          ],
        },
        wrapErrorCode('E_UNAUTHORIZED', context),
      ],
    },
  }];
}

/**
 * Convert a role name (e.g., ADMIN_ROLE, MINTER_ROLE) to a PascalCase capability struct name.
 * ADMIN_ROLE -> AdminRoleCapability
 * MINTER_ROLE -> MinterRoleCapability
 * myRole -> MyRoleCapability
 */
function roleNameToCapabilityStruct(roleName: string): string {
  // Handle SCREAMING_SNAKE_CASE (e.g., ADMIN_ROLE)
  if (/^_?[A-Z][A-Z0-9_]*$/.test(roleName)) {
    const parts = roleName.split('_').filter(Boolean);
    const pascal = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    return `${pascal}Capability`;
  }
  // Handle camelCase or PascalCase
  const pascal = roleName.charAt(0).toUpperCase() + roleName.slice(1);
  return `${pascal}Capability`;
}

/**
 * Substitute modifier parameter names with actual argument expressions in an IR statement.
 * Deep-clones the statement tree, replacing any identifier matching a param name.
 */
function substituteParamsInStatement(stmt: any, paramMap: Map<string, any>): any {
  if (!stmt || typeof stmt !== 'object') return stmt;

  // Deep clone and substitute
  if (Array.isArray(stmt)) {
    return stmt.map(s => substituteParamsInStatement(s, paramMap));
  }

  const result: any = {};
  for (const key of Object.keys(stmt)) {
    const val = stmt[key];
    if (key === 'kind' || key === 'type' || key === 'operator' || key === 'prefix' ||
        key === 'member' || key === 'field' || typeof val === 'boolean' || typeof val === 'number') {
      result[key] = val;
    } else if (key === 'name' && stmt.kind === 'identifier' && paramMap.has(val)) {
      // Substitute: replace this identifier with the argument expression
      const replacement = paramMap.get(val);
      return typeof replacement === 'object' ? { ...replacement } : replacement;
    } else if (Array.isArray(val)) {
      result[key] = val.map((item: any) =>
        typeof item === 'object' && item !== null
          ? substituteParamsInStatement(item, paramMap)
          : item
      );
    } else if (typeof val === 'object' && val !== null) {
      result[key] = substituteParamsInStatement(val, paramMap);
    } else {
      result[key] = val;
    }
  }
  return result;
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

  // Create parameter mapping: modifier formal param name → actual argument expression
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

    // Substitute modifier parameter names with actual argument expressions
    const substituted = paramMap.size > 0 ? substituteParamsInStatement(stmt, paramMap) : stmt;
    const transformed = transformStatement(substituted, context);
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

  // Create parameter mapping for substitution
  const paramMap = new Map<string, any>();
  if (modifierDef.params && args) {
    modifierDef.params.forEach((param: any, i: number) => {
      if (args[i]) {
        paramMap.set(param.name, args[i]);
      }
    });
  }

  // Find statements AFTER the placeholder
  let foundPlaceholder = false;
  for (const stmt of modifierDef.body || []) {
    if (stmt.kind === 'placeholder') {
      foundPlaceholder = true;
      continue;
    }

    if (foundPlaceholder) {
      const substituted = paramMap.size > 0 ? substituteParamsInStatement(stmt, paramMap) : stmt;
      const transformed = transformStatement(substituted, context);
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
/**
 * Check if a variable name is referenced in a list of statements (beyond its declaration).
 * Recursively walks expressions and statements looking for identifier references.
 */
function isVariableReferencedInStatements(varName: string, stmts: any[]): boolean {
  for (const stmt of stmts) {
    if (isVarInStatement(varName, stmt)) return true;
  }
  return false;
}

function isVarInStatement(varName: string, stmt: any): boolean {
  if (!stmt) return false;
  switch (stmt.kind) {
    case 'let':
      // Don't count the declaration itself, only check the value
      return false; // The value is the default, not a reference to the var
    case 'assign':
      if (isVarInExpr(varName, stmt.target)) return true;
      return isVarInExpr(varName, stmt.value);
    case 'if':
      if (isVarInExpr(varName, stmt.condition)) return true;
      if (stmt.thenBlock?.some((s: any) => isVarInStatement(varName, s))) return true;
      if (stmt.elseBlock?.some((s: any) => isVarInStatement(varName, s))) return true;
      return false;
    case 'while':
      if (isVarInExpr(varName, stmt.condition)) return true;
      return stmt.body?.some((s: any) => isVarInStatement(varName, s)) || false;
    case 'loop':
      return stmt.body?.some((s: any) => isVarInStatement(varName, s)) || false;
    case 'for':
      if (isVarInExpr(varName, stmt.iterable)) return true;
      return stmt.body?.some((s: any) => isVarInStatement(varName, s)) || false;
    case 'return':
      return stmt.value ? isVarInExpr(varName, stmt.value) : false;
    case 'abort':
      return isVarInExpr(varName, stmt.code);
    case 'expression':
      return isVarInExpr(varName, stmt.expression);
    case 'block':
      return stmt.statements?.some((s: any) => isVarInStatement(varName, s)) || false;
  }
  return false;
}

function isVarInExpr(varName: string, expr: any): boolean {
  if (!expr) return false;
  switch (expr.kind) {
    case 'identifier':
      return expr.name === varName;
    case 'binary':
      return isVarInExpr(varName, expr.left) || isVarInExpr(varName, expr.right);
    case 'unary':
      return isVarInExpr(varName, expr.operand);
    case 'call':
      return expr.args?.some((a: any) => isVarInExpr(varName, a)) || false;
    case 'method_call':
      return isVarInExpr(varName, expr.receiver) || expr.args?.some((a: any) => isVarInExpr(varName, a)) || false;
    case 'field_access':
      return isVarInExpr(varName, expr.object);
    case 'index':
      return isVarInExpr(varName, expr.object) || isVarInExpr(varName, expr.index);
    case 'struct':
      return expr.fields?.some((f: any) => isVarInExpr(varName, f.value)) || false;
    case 'borrow':
    case 'dereference':
    case 'move':
    case 'copy':
      return isVarInExpr(varName, expr.value);
    case 'cast':
      return isVarInExpr(varName, expr.value);
    case 'if_expr':
      return isVarInExpr(varName, expr.condition) || isVarInExpr(varName, expr.thenExpr) || isVarInExpr(varName, expr.elseExpr);
    case 'tuple':
    case 'vector':
      return expr.elements?.some((e: any) => isVarInExpr(varName, e)) || false;
  }
  return false;
}

function containsReturn(stmt: any): boolean {
  if (!stmt) return false;
  if (stmt.kind === 'return') return true;
  // Check if blocks
  if (stmt.kind === 'if') {
    if (stmt.thenBlock?.some(containsReturn)) return true;
    if (stmt.elseBlock?.some(containsReturn)) return true;
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
    .replace(/\s+/g, '_')                       // Replace spaces with underscores
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')     // lowercase/digit → uppercase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // consecutive uppercase → Titlecase boundary
    .replace(/[^A-Z0-9_]/gi, '')                 // Remove non-alphanumeric except underscore
    .toUpperCase()
    .replace(/^_/, '')                           // Remove leading underscore
    .replace(/_+/g, '_');                        // Collapse multiple underscores
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

  // Known Solidity variable names used for reentrancy guards
  const REENTRANCY_VAR_NAMES = new Set(['_status', 'locked', '_locked', '_not_entered', '_notEntered', 'status', 'reentrancyStatus', '_reentrancyStatus', 'reentrancy_status']);

  // Build the state initialization
  const stateInitializerValues = new Map<string, any>();
  const stateFields = stateVariables
    .filter(v => {
      if (v.mutability === 'constant') return false;
      // Skip native reentrancy fields when injecting our own
      if ((context as any).usesNonReentrant) {
        const snakeName = toSnakeCase(v.name);
        if (REENTRANCY_VAR_NAMES.has(snakeName) || REENTRANCY_VAR_NAMES.has(v.name)) return false;
      }
      return true;
    })
    .map(v => {
      const initContext = { ...constructorContext, stateInitializerValues } as any;
      // Check if this variable is initialized in the constructor
      // Pass the variable type so we can generate the correct suffix
      const initValue = findInitializationInBody(v.name, constructor.body, initContext, v.type);
      const declInit = v.initialValue
        ? transformConstructorExpression(v.initialValue, initContext, v.type)
        : undefined;
      const resolved = initValue ?? declInit ?? getDefaultValue(v, context);
      stateInitializerValues.set(v.name, resolved);
      stateInitializerValues.set(toSnakeCase(v.name), resolved);
      return {
        name: toSnakeCase(v.name),
        value: resolved,
      };
    });

  // Inject reentrancy_status field if needed
  if ((context as any).usesNonReentrant) {
    // Remove any native reentrancy fields that slipped through
    for (let i = stateFields.length - 1; i >= 0; i--) {
      if (REENTRANCY_VAR_NAMES.has(stateFields[i].name)) {
        stateFields.splice(i, 1);
      }
    }
    if (!stateFields.some(f => f.name === 'reentrancy_status')) {
      stateFields.push({
        name: 'reentrancy_status',
        value: { kind: 'literal', type: 'number', value: 1, suffix: 'u8' },
      });
    }
  }

  const constructorPattern = context.constructorPattern || 'resource-account';

  // Add pattern-specific field to the struct
  if (constructorPattern === 'resource-account') {
    stateFields.push({
      name: 'signer_cap',
      value: { kind: 'identifier', name: 'signer_cap' },
    });
  } else if (constructorPattern === 'named-object') {
    stateFields.push({
      name: 'extend_ref',
      value: { kind: 'identifier', name: 'extend_ref' },
    });
  }
  // deployer-direct: no extra field

  const body: MoveStatement[] = [];

  // Generate pattern-specific preamble
  if (constructorPattern === 'resource-account') {
    // Create resource account: let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"seed");
    context.usedModules.add('aptos_framework::account');
    body.push({
      kind: 'let',
      pattern: ['_resource_signer', 'signer_cap'],
      value: {
        kind: 'call',
        function: 'account::create_resource_account',
        args: [
          { kind: 'identifier', name: 'deployer' },
          { kind: 'literal', type: 'bytestring', value: `b"${toSnakeCase(contractName)}"` },
        ],
      },
    });
  } else if (constructorPattern === 'named-object') {
    // let constructor_ref = object::create_named_object(deployer, b"contract_name");
    context.usedModules.add('aptos_framework::object');
    body.push({
      kind: 'let',
      pattern: 'constructor_ref',
      value: {
        kind: 'call',
        function: 'object::create_named_object',
        args: [
          { kind: 'identifier', name: 'deployer' },
          { kind: 'literal', type: 'bytestring', value: `b"${toSnakeCase(contractName)}"` },
        ],
      },
    });
    // let object_signer = object::generate_signer(&constructor_ref);
    body.push({
      kind: 'let',
      pattern: 'object_signer',
      value: {
        kind: 'call',
        function: 'object::generate_signer',
        args: [
          { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'constructor_ref' } },
        ],
      },
    });
    // let extend_ref = object::generate_extend_ref(&constructor_ref);
    body.push({
      kind: 'let',
      pattern: 'extend_ref',
      value: {
        kind: 'call',
        function: 'object::generate_extend_ref',
        args: [
          { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'constructor_ref' } },
        ],
      },
    });
  }
  // deployer-direct: no preamble needed

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

  // Determine the move_to target based on constructor pattern
  const moveToTarget = constructorPattern === 'resource-account'
    ? { kind: 'identifier' as const, name: 'deployer' }
    : constructorPattern === 'named-object'
    ? { kind: 'borrow' as const, mutable: false, value: { kind: 'identifier' as const, name: 'object_signer' } }
    : { kind: 'identifier' as const, name: 'deployer' }; // deployer-direct

  // Add move_to to create the resource
  body.push({
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'move_to',
      args: [
        moveToTarget as any,
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
    // Build the borrow address based on the constructor pattern
    const borrowAddress = buildBorrowAddress(constructorPattern, contractName, context);

    // Borrow state mutably
    body.push({
      kind: 'let',
      pattern: 'state',
      value: {
        kind: 'call',
        function: 'borrow_global_mut',
        typeArgs: [{ kind: 'struct', name: stateName }],
        args: [borrowAddress],
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
 * Build the borrow address expression based on the constructor pattern.
 * - resource-account: signer::address_of(deployer)  (state is on resource account, but after move_to we use deployer's address to borrow)
 * - deployer-direct: signer::address_of(deployer)
 * - named-object: object::create_object_address(@module_address, b"seed")
 */
function buildBorrowAddress(
  pattern: string,
  contractName: string,
  context: TranspileContext
): any {
  if (pattern === 'named-object') {
    context.usedModules.add('aptos_framework::object');
    return {
      kind: 'call',
      function: 'object::create_object_address',
      args: [
        { kind: 'literal', type: 'address', value: `@${context.moduleAddress}` },
        { kind: 'literal', type: 'bytestring', value: `b"${toSnakeCase(contractName)}"` },
      ],
    };
  }
  // resource-account and deployer-direct both use signer::address_of(deployer)
  context.usedModules.add('std::signer');
  return {
    kind: 'call',
    function: 'signer::address_of',
    args: [{ kind: 'identifier', name: 'deployer' }],
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
  stateMutability: string,
  internalVisibility?: 'public-package' | 'public-friend' | 'private'
): MoveVisibility {
  switch (visibility) {
    case 'public':
    case 'external':
      return 'public';
    case 'internal':
      if (internalVisibility === 'public-friend') return 'public(friend)';
      if (internalVisibility === 'private') return 'private';
      return 'public(package)'; // default
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
  usesMsgSender: boolean = false,
  signerRequirementFromCalls: 'none' | 'signer-ref' | 'address' = 'none'
): MoveFunctionParam[] {
  const moveParams: MoveFunctionParam[] = [];

  // Determine if this is a public-facing function that needs a signer
  // Private/internal functions only need signer if they use msg.sender
  const isPublicFunction = visibility === 'public' || visibility === 'external';
  const needsSignerFromCalls = signerRequirementFromCalls === 'signer-ref';
  const needsAddressFromCalls = signerRequirementFromCalls === 'address';
  const needsSigner = isPublicFunction ||
    (usesMsgSender && stateMutability !== 'view' && stateMutability !== 'pure') ||
    needsSignerFromCalls;
  const shouldUseSignerRef =
    signerRequirementFromCalls === 'signer-ref' ||
    (stateMutability !== 'view' && stateMutability !== 'pure' && needsSigner);

  // Add signer parameter for non-view functions that are public or use msg.sender
  if (shouldUseSignerRef) {
    moveParams.push({
      name: signerName(context),
      type: MoveTypes.ref(MoveTypes.signer()),
    });
  } else if (usesMsgSender || needsAddressFromCalls || needsSignerFromCalls) {
    // View/pure functions that use msg.sender need an address parameter
    moveParams.push({
      name: signerName(context),
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
 * Infer whether the transformed function has a signer-like parameter and its kind.
 */
function inferFunctionSignerKind(
  params: MoveFunctionParam[],
  context: TranspileContext
): 'none' | 'signer-ref' | 'address' {
  const name = signerName(context);
  const signerParam = params.find(p => p.name === name);
  if (!signerParam) return 'none';
  if (signerParam.type.kind === 'reference' &&
      signerParam.type.innerType.kind === 'primitive' &&
      signerParam.type.innerType.name === 'signer') {
    return 'signer-ref';
  }
  if (signerParam.type.kind === 'primitive' && signerParam.type.name === 'address') {
    return 'address';
  }
  return 'none';
}

/**
 * Detect whether this function calls internal helpers that require signer/address propagation.
 */
function bodyCallsSignerDependentInternalFunction(
  statements: IRStatement[],
  context: TranspileContext
): 'none' | 'signer-ref' | 'address' {
  const registry = (context as any).functionRegistry as Map<string, {
    visibility: string;
    accessesState: boolean;
    signerParamKind: 'none' | 'signer-ref' | 'address';
  }> | undefined;
  if (!registry) return 'none';

  let needs: 'none' | 'signer-ref' | 'address' = 'none';

  const mergeNeeds = (kind: 'none' | 'signer-ref' | 'address') => {
    if (kind === 'signer-ref') {
      needs = 'signer-ref';
      return;
    }
    if (kind === 'address' && needs === 'none') {
      needs = 'address';
    }
  };

  const scanExpr = (expr: any): void => {
    if (!expr || needs === 'signer-ref') return;
    if (expr.kind === 'function_call' && expr.function?.kind === 'identifier') {
      const fnName = expr.function.name;
      const info = registry.get(fnName);
      if (info && (info.visibility === 'private' || info.visibility === 'internal')) {
        mergeNeeds(info.signerParamKind || 'none');
      }
      for (const arg of expr.args || []) scanExpr(arg);
      scanExpr(expr.function);
      return;
    }
    if (Array.isArray(expr)) {
      for (const item of expr) scanExpr(item);
      return;
    }
    if (typeof expr === 'object') {
      for (const key of Object.keys(expr)) {
        if (key === 'kind') continue;
        const value = (expr as any)[key];
        if (value && typeof value === 'object') scanExpr(value);
      }
    }
  };

  const scanStmt = (stmt: any): void => {
    if (!stmt || needs === 'signer-ref') return;
    if (stmt.kind === 'if') {
      scanExpr(stmt.condition);
      for (const s of stmt.thenBlock || []) scanStmt(s);
      for (const s of stmt.elseBlock || []) scanStmt(s);
      return;
    }
    if (stmt.kind === 'for') {
      if (stmt.init) scanStmt(stmt.init);
      scanExpr(stmt.condition);
      scanExpr(stmt.update);
      for (const s of stmt.body || []) scanStmt(s);
      return;
    }
    if (stmt.kind === 'while' || stmt.kind === 'do_while' || stmt.kind === 'loop') {
      scanExpr(stmt.condition);
      for (const s of stmt.body || []) scanStmt(s);
      return;
    }
    if (stmt.kind === 'block' || stmt.kind === 'unchecked') {
      for (const s of stmt.statements || []) scanStmt(s);
      return;
    }
    if (stmt.kind === 'try') {
      scanExpr(stmt.expression);
      for (const s of stmt.body || []) scanStmt(s);
      for (const c of stmt.catchClauses || []) {
        for (const s of c.body || []) scanStmt(s);
      }
      return;
    }
    if (stmt.kind === 'variable_declaration') scanExpr(stmt.initialValue);
    if (stmt.kind === 'assignment') {
      scanExpr(stmt.target);
      scanExpr(stmt.value);
    }
    if (stmt.kind === 'expression') scanExpr(stmt.expression);
    if (stmt.kind === 'return') scanExpr(stmt.value);
    if (stmt.kind === 'emit') for (const a of stmt.args || []) scanExpr(a);
    if (stmt.kind === 'require') {
      scanExpr(stmt.condition);
      scanExpr(stmt.error);
    }
    if (stmt.kind === 'revert') {
      scanExpr(stmt.error);
      for (const a of stmt.args || []) scanExpr(a);
    }
  };

  for (const stmt of statements) {
    scanStmt(stmt);
  }

  return needs;
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
 * Deep clone a Move statement so cleanup can be inserted across branches safely.
 */
function cloneMoveStatement<T>(stmt: T): T {
  return JSON.parse(JSON.stringify(stmt));
}

/**
 * Recursively insert cleanup statements before every explicit return statement.
 */
function injectCleanupBeforeReturns(
  statements: MoveStatement[],
  cleanupStatements: MoveStatement[]
): MoveStatement[] {
  const out: MoveStatement[] = [];

  for (const stmt of statements) {
    if (stmt.kind === 'return') {
      out.push(...cleanupStatements.map(cloneMoveStatement));
      out.push(stmt);
      continue;
    }

    if (stmt.kind === 'if') {
      out.push({
        ...stmt,
        thenBlock: injectCleanupBeforeReturns(stmt.thenBlock || [], cleanupStatements),
        elseBlock: stmt.elseBlock ? injectCleanupBeforeReturns(stmt.elseBlock, cleanupStatements) : undefined,
      });
      continue;
    }

    if (stmt.kind === 'while') {
      out.push({
        ...stmt,
        body: injectCleanupBeforeReturns(stmt.body || [], cleanupStatements),
      });
      continue;
    }

    if (stmt.kind === 'loop') {
      out.push({
        ...stmt,
        body: injectCleanupBeforeReturns(stmt.body || [], cleanupStatements),
      });
      continue;
    }

    if (stmt.kind === 'for') {
      out.push({
        ...stmt,
        body: injectCleanupBeforeReturns(stmt.body || [], cleanupStatements),
      });
      continue;
    }

    if (stmt.kind === 'block') {
      out.push({
        ...stmt,
        statements: injectCleanupBeforeReturns(stmt.statements || [], cleanupStatements),
      });
      continue;
    }

    out.push(stmt);
  }

  return out;
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
      const borrowAddr = buildStateBorrowAddress(context);
      moveStatements.push({
        kind: 'let',
        pattern: 'state',
        mutable: false,
        value: {
          kind: 'call',
          function: 'borrow_global_mut',
          typeArgs: [{ kind: 'struct', name: `${context.contractName}State` }],
          args: [borrowAddr],
        },
      });
    }
  } else if (accessesState(statements, context)) {
    // View function that reads state
    const borrowAddr = buildStateBorrowAddress(context);
    moveStatements.push({
      kind: 'let',
      pattern: 'state',
      mutable: false,
      value: {
        kind: 'call',
        function: 'borrow_global',
        typeArgs: [{ kind: 'struct', name: `${context.contractName}State` }],
        args: [borrowAddr],
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

  // Generate table::add or smart_table::add call
  const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
  const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
  context.usedModules.add(tblModPath);
  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: `${tblModPrefix}::add`,
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
      case 'member_access':
        // Check if accessing state.field or a state variable's member
        if (expr.object?.kind === 'identifier' && expr.object.name === 'state') {
          return true;
        }
        if (expr.object?.kind === 'identifier' && stateVarNames.has(expr.object.name)) {
          return true;
        }
        return checkExpression(expr.object);

      case 'binary':
        return checkExpression(expr.left) || checkExpression(expr.right);

      case 'unary':
        return checkExpression(expr.operand);

      case 'call':
        return checkExpression(expr.function) ||
               (expr.args?.some((arg: any) => checkExpression(arg)) || false);

      case 'index_access':
        return checkExpression(expr.object) || checkExpression(expr.index) ||
               checkExpression(expr.base);

      case 'conditional':
        return checkExpression(expr.condition) ||
               checkExpression(expr.trueExpr) ||
               checkExpression(expr.falseExpr);

      case 'tuple':
        return expr.elements?.some((el: any) => checkExpression(el)) || false;

      case 'function_call':
        // Check both the function expression (which may reference state vars
        // as method call objects) and the arguments
        return checkExpression(expr.function) ||
               checkExpression(expr.expression) ||
               (expr.args?.some((arg: any) => checkExpression(arg)) || false);

      case 'type_conversion':
        return checkExpression(expr.expression) || checkExpression(expr.value);

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
/**
 * Determine acquires by scanning the generated Move body for borrow_global/borrow_global_mut calls.
 * This is more reliable than scanning IR because it catches all state access patterns
 * including those generated by transformers (modifiers, state borrows, etc.).
 */
function determineAcquiresFromBody(
  body: any[],
  fn: IRFunction,
  context: TranspileContext
): string[] {
  // Internal/private functions receive state as a parameter — they don't need acquires
  const isInternalFunction = fn.visibility === 'private' || fn.visibility === 'internal';
  if (isInternalFunction) return [];

  // Libraries don't have resources
  if ((context as any).isLibrary) return [];

  const resourceNames = new Set<string>();

  // Recursively scan for borrow_global/borrow_global_mut calls
  function scanExpr(expr: any): void {
    if (!expr) return;
    if (expr.kind === 'call' && (expr.function === 'borrow_global' || expr.function === 'borrow_global_mut' || expr.function === 'move_from')) {
      if (expr.typeArgs?.[0]?.name) {
        resourceNames.add(expr.typeArgs[0].name);
      }
    }
    // Also detect exists<T> calls (function name includes type parameter)
    if (expr.kind === 'call' && typeof expr.function === 'string') {
      const existsMatch = expr.function.match(/^exists<(\w+)>$/);
      if (existsMatch) {
        resourceNames.add(existsMatch[1]);
      }
    }
    // Detect calls to ensure_user_state (needs acquires for per-user resource)
    if (expr.kind === 'call' && expr.function === 'ensure_user_state' && context.resourcePlan?.perUserResources) {
      resourceNames.add(context.resourcePlan.perUserResources.structName);
    }
    // Recurse into all expression fields
    if (expr.args) expr.args.forEach(scanExpr);
    if (expr.left) scanExpr(expr.left);
    if (expr.right) scanExpr(expr.right);
    if (expr.operand) scanExpr(expr.operand);
    if (expr.value) scanExpr(expr.value);
    if (expr.condition) scanExpr(expr.condition);
    if (expr.thenExpr) scanExpr(expr.thenExpr);
    if (expr.elseExpr) scanExpr(expr.elseExpr);
    if (expr.object) scanExpr(expr.object);
    if (expr.index) scanExpr(expr.index);
    if (expr.receiver) scanExpr(expr.receiver);
    if (expr.elements) expr.elements.forEach(scanExpr);
    if (expr.fields) expr.fields.forEach((f: any) => scanExpr(f.value));
    if (expr.expression) scanExpr(expr.expression);
    if (expr.code) scanExpr(expr.code);
  }

  function scanStmt(stmt: any): void {
    if (!stmt) return;
    switch (stmt.kind) {
      case 'let': if (stmt.value) scanExpr(stmt.value); break;
      case 'assign': scanExpr(stmt.target); scanExpr(stmt.value); break;
      case 'if': scanExpr(stmt.condition); stmt.thenBlock?.forEach(scanStmt); stmt.elseBlock?.forEach(scanStmt); break;
      case 'while': scanExpr(stmt.condition); stmt.body?.forEach(scanStmt); break;
      case 'loop': stmt.body?.forEach(scanStmt); break;
      case 'for': scanExpr(stmt.iterable); stmt.body?.forEach(scanStmt); break;
      case 'return': if (stmt.value) scanExpr(stmt.value); break;
      case 'abort': scanExpr(stmt.code); break;
      case 'expression': scanExpr(stmt.expression); break;
      case 'block': stmt.statements?.forEach(scanStmt); break;
    }
  }

  body.forEach(scanStmt);
  return Array.from(resourceNames);
}

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
        const stateInitMap = (context as any).stateInitializerValues as Map<string, any> | undefined;
        if (stateInitMap && stateInitMap.has(expr.name)) {
          return stateInitMap.get(expr.name);
        }
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
      }
      // Fallback: convert to snake_case if it looks like a parameter
      if (expr.name.startsWith('_')) {
        return { ...expr, name: toSnakeCase(expr.name) };
      }
      return expr;

    case 'function_call': {
      // Handle struct constructor calls: StructName(arg1, ...) or StructName({field: val, ...})
      if (expr.function?.kind === 'identifier') {
        const structName = expr.function.name;
        const structDef = context.structs?.get(structName);
        if (structDef) {
          const transformedArgs = (expr.args || []).map((a: any) => transformConstructorExpression(a, context));
          // Named arguments: FeeDistribution({lpShare: 7000, ...})
          if (expr.names && expr.names.length > 0) {
            const fields = expr.names.map((name: string, i: number) => ({
              name: toSnakeCase(name),
              value: transformedArgs[i] || { kind: 'literal', type: 'number', value: 0, suffix: 'u256' },
            }));
            return { kind: 'struct', name: structName, fields };
          }
          // Positional arguments
          const fields = structDef.fields.map((field: any, i: number) => ({
            name: toSnakeCase(field.name),
            value: transformedArgs[i] || { kind: 'literal', type: 'number', value: 0, suffix: 'u256' },
          }));
          return { kind: 'struct', name: structName, fields };
        }
      }
      // Other function calls — recurse into args
      return {
        ...expr,
        args: (expr.args || []).map((a: any) => transformConstructorExpression(a, context)),
      };
    }

    case 'member_access':
      return {
        ...expr,
        object: transformConstructorExpression(expr.object, context),
      };

    case 'index_access':
      return {
        ...expr,
        base: transformConstructorExpression(expr.base, context),
        index: transformConstructorExpression(expr.index, context),
      };

    case 'block_access':
      if (expr.property === 'number' || expr.property === 'timestamp') {
        return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
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
    const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
    const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
    context.usedModules.add(tblModPath);
    return {
      kind: 'call',
      function: `${tblModPrefix}::new`,
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
          // optionalValues='option-type': default address → option::none<address>()
          if (context.optionalValues === 'option-type') {
            context.usedModules.add('std::option');
            return { kind: 'call', function: 'option::none', typeArgs: [{ kind: 'primitive', name: 'address' }], args: [] };
          }
          return { kind: 'literal', type: 'address', value: '@0x0' };
        default:
          return { kind: 'literal', type: 'number', value: 0 };
      }

    case 'vector':
      return { kind: 'call', function: 'vector::empty', args: [] };

    case 'struct': {
      // String type
      if (moveType.module?.includes('string')) {
        context.usedModules.add('std::string');
        return { kind: 'call', function: 'string::utf8', args: [{ kind: 'vector', elements: [] }] };
      }
      // Table/SmartTable
      if (moveType.name === 'Table' || moveType.name === 'SmartTable') {
        const mod = moveType.name === 'SmartTable' ? 'smart_table' : 'table';
        context.usedModules.add(mod === 'smart_table' ? 'aptos_std::smart_table' : 'aptos_std::table');
        return { kind: 'call', function: `${mod}::new`, args: [] };
      }
      // Custom structs — recursively build with default fields
      const structDef = context.structs?.get(moveType.name);
      if (structDef && structDef.fields?.length > 0) {
        return {
          kind: 'struct',
          name: moveType.name,
          fields: structDef.fields.map((f: any) => ({
            name: toSnakeCase(f.name),
            value: getDefaultValueForField(f.type, context, 0),
          })),
        };
      }
      return { kind: 'literal', type: 'number', value: 0 };
    }

    default:
      return { kind: 'literal', type: 'number', value: 0 };
  }
}

/**
 * Get default value for a struct field type (recursive, with depth guard)
 */
function getDefaultValueForField(type: any, context: TranspileContext, depth: number): any {
  if (depth > 5) return { kind: 'literal', type: 'number', value: 0 };
  const moveType = type?.move || type;
  if (!moveType) return { kind: 'literal', type: 'number', value: 0 };

  if (moveType.kind === 'primitive') {
    switch (moveType.name) {
      case 'bool': return { kind: 'literal', type: 'bool', value: false };
      case 'address': return { kind: 'literal', type: 'address', value: '@0x0' };
      default: return { kind: 'literal', type: 'number', value: 0 };
    }
  }
  if (moveType.kind === 'vector') {
    return { kind: 'call', function: 'vector::empty', args: [] };
  }
  if (moveType.kind === 'struct') {
    if (moveType.module?.includes('string')) {
      context.usedModules.add('std::string');
      return { kind: 'call', function: 'string::utf8', args: [{ kind: 'vector', elements: [] }] };
    }
    if (moveType.name === 'Table' || moveType.name === 'SmartTable') {
      const mod = moveType.name === 'SmartTable' ? 'smart_table' : 'table';
      return { kind: 'call', function: `${mod}::new`, args: [] };
    }
    const structDef = context.structs?.get(moveType.name);
    if (structDef && structDef.fields?.length > 0) {
      return {
        kind: 'struct',
        name: moveType.name,
        fields: structDef.fields.map((f: any) => ({
          name: toSnakeCase(f.name),
          value: getDefaultValueForField(f.type, context, depth + 1),
        })),
      };
    }
  }
  return { kind: 'literal', type: 'number', value: 0 };
}

/**
 * Get default value for a Move type
 */
function getDefaultValueForType(moveType: any, context?: TranspileContext): any {
  if (!moveType) {
    return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
  }

  switch (moveType.kind) {
    case 'primitive':
      switch (moveType.name) {
        case 'bool':
          return { kind: 'literal', type: 'bool', value: false };
        case 'address':
          // optionalValues='option-type': default address → option::none<address>()
          if (context?.optionalValues === 'option-type') {
            context.usedModules.add('std::option');
            return { kind: 'call', function: 'option::none', typeArgs: [{ kind: 'primitive', name: 'address' }], args: [] };
          }
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
/**
 * Build the address expression used for borrow_global/borrow_global_mut calls.
 * - resource-account: @module_address (state stored at resource account, address is the module address)
 * - deployer-direct: @module_address (state stored at deployer, which is the module publisher address)
 * - named-object: object::create_object_address(@module_address, b"seed") (state on named object)
 */
function buildStateBorrowAddress(context: TranspileContext): any {
  if (context.constructorPattern === 'named-object') {
    context.usedModules.add('aptos_framework::object');
    return {
      kind: 'call',
      function: 'object::create_object_address',
      args: [
        { kind: 'literal', type: 'address', value: `@${context.moduleAddress}` },
        { kind: 'literal', type: 'bytestring', value: `b"${toSnakeCase(context.contractName)}"` },
      ],
    };
  }
  // resource-account and deployer-direct both use @module_address
  return { kind: 'literal', type: 'address', value: `@${context.moduleAddress}` };
}

/**
 * Resolve which local variable holds a given state variable.
 * Returns 'state' for low optimization, or the appropriate group local name
 * (e.g., 'admin_config', 'counters') for medium/high optimization.
 */
function resolveStateObject(varName: string, context: TranspileContext): string {
  if (context.resourcePlan && context.optimizationLevel !== 'low') {
    const groupName = context.resourcePlan.varToGroup.get(varName);
    if (groupName) {
      return groupNameToLocal(groupName);
    }
  }
  return 'state';
}

/**
 * Convert a resource group name (e.g., 'VaultAdminConfig') to a local variable
 * name (e.g., 'admin_config'). Strips the contract name prefix.
 */
function groupNameToLocal(groupName: string): string {
  // Resource groups are named like ContractNameAdminConfig, ContractNameCounters, etc.
  // We want just the suffix part in snake_case.
  // Match common suffixes
  const suffixes = ['AdminConfig', 'Counters', 'UserData', 'State'];
  for (const suffix of suffixes) {
    if (groupName.endsWith(suffix)) {
      return toSnakeCase(suffix);
    }
  }
  // Fallback: full snake_case
  return toSnakeCase(groupName);
}

function toSnakeCase(str: string): string {
  if (!str) return '';
  // Handle $ variable (EVM storage reference) — not valid in Move
  if (str === '$') return '_storage_ref';
  if (str.includes('$')) str = str.replace(/\$/g, '_');
  // Preserve SCREAMING_SNAKE_CASE constants
  if (/^_?[A-Z][A-Z0-9_]*$/.test(str)) {
    return str.toLowerCase();
  }
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')     // lowercase/digit → uppercase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // consecutive uppercase → Titlecase boundary
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Check if a function's IR body writes to any per-user variable.
 * Scans for assignment targets that reference the given variable names.
 */
function functionWritesPerUserVar(fn: IRFunction, perUserVarNames: Set<string>): boolean {
  function scanStmts(stmts: any[]): boolean {
    for (const stmt of stmts) {
      if (stmt.kind === 'assignment') {
        const target = extractBaseIdent(stmt.target);
        if (target && perUserVarNames.has(target)) return true;
      }
      if (stmt.body) { if (scanStmts(stmt.body)) return true; }
      if (stmt.thenBlock) { if (scanStmts(stmt.thenBlock)) return true; }
      if (stmt.elseBlock) { if (scanStmts(stmt.elseBlock)) return true; }
      if (stmt.statements) { if (scanStmts(stmt.statements)) return true; }
    }
    return false;
  }

  function extractBaseIdent(expr: any): string | null {
    if (!expr) return null;
    if (expr.kind === 'identifier') return expr.name;
    if (expr.kind === 'index_access') return extractBaseIdent(expr.base);
    if (expr.kind === 'member_access') return extractBaseIdent(expr.object);
    return null;
  }

  return scanStmts(fn.body);
}
