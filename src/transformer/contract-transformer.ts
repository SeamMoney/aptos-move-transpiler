/**
 * Contract Transformer
 * Transforms Solidity contracts to Move modules
 */

import type { ContractDefinition, FunctionDefinition, EventDefinition, ModifierDefinition } from '@solidity-parser/parser/dist/src/ast-types.js';
import type { MoveModule, MoveUseDeclaration, MoveStruct, MoveFunction, MoveConstant } from '../types/move-ast.js';
import type { IRContract, IRStateVariable, IRFunction, IREvent, IRModifier, IRConstructor, TranspileContext, TranspileResult } from '../types/ir.js';
import { transformStateVariable } from './state-transformer.js';
import { transformFunction, transformConstructor } from './function-transformer.js';
import { transformEvent } from './event-transformer.js';
import { createIRType } from '../mapper/type-mapper.js';
import { solidityStatementToIR, solidityExpressionToIR } from './expression-transformer.js';

/**
 * Transform a Solidity contract to IR
 */
export function contractToIR(contract: ContractDefinition): IRContract {
  const ir: IRContract = {
    name: contract.name,
    stateVariables: [],
    functions: [],
    events: [],
    errors: [],
    modifiers: [],
    structs: [],
    enums: [],
    constructor: undefined,
    inheritedContracts: contract.baseContracts.map(bc => bc.baseName.namePath),
    isAbstract: contract.kind === 'abstract',
    isInterface: contract.kind === 'interface',
  };

  // Process all sub-nodes
  for (const node of contract.subNodes) {
    const nodeAny = node as any;
    switch (node.type) {
      case 'StateVariableDeclaration':
        for (const variable of nodeAny.variables || []) {
          if (variable.typeName) {
            ir.stateVariables.push({
              name: variable.name || '',
              type: createIRType(variable.typeName),
              visibility: (variable.visibility as any) || 'internal',
              mutability: variable.isDeclaredConst ? 'constant' :
                         (variable.isImmutable ? 'immutable' : 'mutable'),
              initialValue: nodeAny.initialValue ? transformExpressionToIR(nodeAny.initialValue) : undefined,
              isMapping: variable.typeName.type === 'Mapping',
              mappingKeyType: variable.typeName.type === 'Mapping' ? createIRType(variable.typeName.keyType) : undefined,
              mappingValueType: variable.typeName.type === 'Mapping' ? createIRType(variable.typeName.valueType) : undefined,
            });
          }
        }
        break;

      case 'FunctionDefinition':
        if (nodeAny.isConstructor) {
          ir.constructor = extractConstructor(nodeAny as FunctionDefinition);
        } else if (nodeAny.name) {
          ir.functions.push(extractFunction(nodeAny as FunctionDefinition));
        }
        break;

      case 'EventDefinition':
        ir.events.push(extractEvent(nodeAny as EventDefinition));
        break;

      case 'ModifierDefinition':
        ir.modifiers.push(extractModifier(nodeAny as ModifierDefinition));
        break;

      case 'StructDefinition':
        ir.structs.push(extractStruct(nodeAny));
        break;

      case 'EnumDefinition':
        ir.enums.push(extractEnum(nodeAny));
        break;

      default:
        // Handle ErrorDefinition and other types
        if (node.type === 'CustomErrorDefinition' || (node as any).type === 'ErrorDefinition') {
          ir.errors.push({
            name: nodeAny.name,
            params: (nodeAny.parameters || []).map((p: any) => ({
              name: p.name || '',
              type: createIRType(p.typeName),
            })),
          });
        }
        break;
    }
  }

  return ir;
}

/**
 * Extract struct definition from Solidity AST
 */
function extractStruct(node: any): { name: string; fields: any[] } {
  return {
    name: node.name,
    fields: (node.members || []).map((member: any) => ({
      name: member.name,
      type: createIRType(member.typeName),
    })),
  };
}

/**
 * Extract enum definition from Solidity AST
 */
function extractEnum(node: any): { name: string; members: string[] } {
  return {
    name: node.name,
    members: (node.members || []).map((member: any) => member.name),
  };
}

/**
 * Flatten inherited contracts into a single IR
 * Merges state variables, functions, events, etc. from parent contracts
 */
export function flattenInheritance(
  contract: IRContract,
  allContracts: Map<string, IRContract>
): IRContract {
  // Start with the current contract
  const flattened: IRContract = {
    ...contract,
    stateVariables: [...contract.stateVariables],
    functions: [...contract.functions],
    events: [...contract.events],
    errors: [...contract.errors],
    modifiers: [...contract.modifiers],
    structs: [...contract.structs],
    enums: [...contract.enums],
  };

  // Process each inherited contract (in reverse order for proper override semantics)
  const inheritanceChain = resolveInheritanceChain(contract, allContracts);

  for (const parentName of inheritanceChain) {
    const parent = allContracts.get(parentName);
    if (!parent) {
      continue; // Parent not found - will be handled as external dependency
    }

    // Merge state variables (parent first, child overrides)
    const existingVarNames = new Set(flattened.stateVariables.map(v => v.name));
    for (const variable of parent.stateVariables) {
      if (!existingVarNames.has(variable.name)) {
        flattened.stateVariables.unshift(variable);
      }
    }

    // Merge functions (respect virtual/override)
    const existingFuncNames = new Set(flattened.functions.map(f => f.name));
    for (const func of parent.functions) {
      if (!existingFuncNames.has(func.name)) {
        // Add parent function if not overridden
        flattened.functions.push(func);
      } else if (func.isVirtual) {
        // Child has override - keep child version (already in flattened)
      }
    }

    // Merge events
    const existingEventNames = new Set(flattened.events.map(e => e.name));
    for (const event of parent.events) {
      if (!existingEventNames.has(event.name)) {
        flattened.events.push(event);
      }
    }

    // Merge errors
    const existingErrorNames = new Set(flattened.errors.map(e => e.name));
    for (const error of parent.errors) {
      if (!existingErrorNames.has(error.name)) {
        flattened.errors.push(error);
      }
    }

    // Merge modifiers
    const existingModifierNames = new Set(flattened.modifiers.map(m => m.name));
    for (const modifier of parent.modifiers) {
      if (!existingModifierNames.has(modifier.name)) {
        flattened.modifiers.push(modifier);
      }
    }

    // Merge structs
    const existingStructNames = new Set(flattened.structs.map(s => s.name));
    for (const struct of parent.structs) {
      if (!existingStructNames.has(struct.name)) {
        flattened.structs.push(struct);
      }
    }

    // Merge enums
    const existingEnumNames = new Set(flattened.enums.map(e => e.name));
    for (const enumDef of parent.enums) {
      if (!existingEnumNames.has(enumDef.name)) {
        flattened.enums.push(enumDef);
      }
    }

    // Inherit constructor logic if no constructor defined
    if (!flattened.constructor && parent.constructor) {
      flattened.constructor = parent.constructor;
    }
  }

  return flattened;
}

/**
 * Resolve the full inheritance chain (C3 linearization simplified)
 * Returns list of parent contract names in order
 */
function resolveInheritanceChain(
  contract: IRContract,
  allContracts: Map<string, IRContract>
): string[] {
  const visited = new Set<string>();
  const chain: string[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const c = allContracts.get(name);
    if (!c) return;

    // Visit parents first (depth-first)
    for (const parentName of c.inheritedContracts) {
      visit(parentName);
    }

    chain.push(name);
  }

  // Visit all parents (not the contract itself)
  for (const parentName of contract.inheritedContracts) {
    visit(parentName);
  }

  return chain;
}

/**
 * Check if an IR statement references any of the given names (for state access detection)
 */
function stmtReferencesAny(stmt: any, names: Set<string>): boolean {
  if (!stmt) return false;

  function exprRefs(expr: any): boolean {
    if (!expr) return false;
    if (expr.kind === 'identifier' && names.has(expr.name)) return true;
    if (expr.kind === 'binary') return exprRefs(expr.left) || exprRefs(expr.right);
    if (expr.kind === 'unary') return exprRefs(expr.operand);
    if (expr.kind === 'function_call') return (expr.args || []).some(exprRefs);
    if (expr.kind === 'member_access') return exprRefs(expr.object);
    if (expr.kind === 'index_access') return exprRefs(expr.base) || exprRefs(expr.index);
    if (expr.kind === 'conditional') return exprRefs(expr.condition) || exprRefs(expr.trueExpression) || exprRefs(expr.falseExpression);
    return false;
  }

  switch (stmt.kind) {
    case 'variable_declaration': return stmt.initialValue ? exprRefs(stmt.initialValue) : false;
    case 'assignment': return exprRefs(stmt.target) || exprRefs(stmt.value);
    case 'expression': return exprRefs(stmt.expression);
    case 'if': return exprRefs(stmt.condition) || (stmt.thenBlock || []).some((s: any) => stmtReferencesAny(s, names)) || (stmt.elseBlock || []).some((s: any) => stmtReferencesAny(s, names));
    case 'for': case 'while': case 'do_while': return (stmt.body || []).some((s: any) => stmtReferencesAny(s, names));
    case 'return': return stmt.value ? exprRefs(stmt.value) : false;
    case 'block': return (stmt.statements || []).some((s: any) => stmtReferencesAny(s, names));
    case 'emit': return (stmt.args || []).some(exprRefs);
    default: return false;
  }
}

/**
 * Deduplicate overloaded functions by appending type-based suffixes.
 * Move doesn't support function overloading, so rename duplicates.
 * E.g., two `mint` functions become `mint` and `mint_address_u256`.
 */
function deduplicateOverloadedFunctions(functions: IRFunction[]): IRFunction[] {
  const nameCounts = new Map<string, number>();
  for (const fn of functions) {
    nameCounts.set(fn.name, (nameCounts.get(fn.name) || 0) + 1);
  }

  // Only process names that appear more than once
  const duplicateNames = new Set<string>();
  for (const [name, count] of nameCounts) {
    if (count > 1) duplicateNames.add(name);
  }

  if (duplicateNames.size === 0) return functions;

  const result: IRFunction[] = [];
  const usedNames = new Set<string>();

  for (const fn of functions) {
    if (!duplicateNames.has(fn.name)) {
      result.push(fn);
      usedNames.add(fn.name);
      continue;
    }

    // First occurrence keeps the original name
    if (!usedNames.has(fn.name)) {
      usedNames.add(fn.name);
      result.push(fn);
      continue;
    }

    // Subsequent occurrences get a suffix based on parameter types
    const suffix = fn.params
      .map(p => {
        const solType = p.type.solidity || 'unknown';
        // Simplify type names for suffix
        return solType
          .replace(/uint\d*/g, 'u')
          .replace(/int\d*/g, 'i')
          .replace(/bytes\d*/g, 'b')
          .replace(/address/g, 'addr')
          .replace(/bool/g, 'bool')
          .replace(/string/g, 'str')
          .replace(/\[\]/g, '_arr');
      })
      .join('_');

    let newName = `${fn.name}_${suffix || 'v2'}`;
    // Ensure uniqueness
    let counter = 2;
    while (usedNames.has(newName)) {
      newName = `${fn.name}_${suffix || 'v'}_${counter++}`;
    }
    usedNames.add(newName);

    result.push({ ...fn, name: newName });
  }

  return result;
}

/**
 * Transform IR contract to Move module
 */
export function irToMoveModule(ir: IRContract, moduleAddress: string, allContracts?: Map<string, IRContract>): TranspileResult {
  // Flatten inheritance if parent contracts are provided
  const flattenedIR = allContracts ? flattenInheritance(ir, allContracts) : ir;

  // Build function registry for detecting internal state-accessing functions
  // This enables the double-mutable-borrow prevention strategy
  const stateVarNames = new Set(flattenedIR.stateVariables.map(v => v.name));
  const functionRegistry = new Map<string, { visibility: string; accessesState: boolean }>();
  for (const fn of flattenedIR.functions) {
    const accessesStateVars = fn.body.some(stmt => stmtReferencesAny(stmt, stateVarNames));
    functionRegistry.set(fn.name, {
      visibility: fn.visibility,
      accessesState: accessesStateVars,
    });
  }

  const context: TranspileContext = {
    contractName: flattenedIR.name,
    moduleAddress,
    stateVariables: new Map(flattenedIR.stateVariables.map(v => [v.name, v])),
    localVariables: new Map(),
    events: new Map(flattenedIR.events.map(e => [e.name, e])),
    modifiers: new Map(flattenedIR.modifiers.map(m => [m.name, m])),
    enums: new Map(flattenedIR.enums.map(e => [e.name, e])),
    errors: [],
    warnings: [],
    usedModules: new Set(),
    acquiredResources: new Set(),
    inheritedContracts: allContracts,
  };

  // Attach function registry for borrow checker prevention
  (context as any).functionRegistry = functionRegistry;

  // Build the Move module
  const module: MoveModule = {
    address: moduleAddress,
    name: toSnakeCase(flattenedIR.name),
    uses: [],
    friends: [],
    structs: [],
    enums: [],
    constants: [],
    functions: [],
  };

  // Add standard imports
  addStandardImports(module, context);

  // Transform state variables to resource struct
  if (flattenedIR.stateVariables.length > 0) {
    const resourceStruct = transformStateVariablesToResource(flattenedIR.stateVariables, flattenedIR.name, context);
    module.structs.push(resourceStruct);
  }

  // Transform custom structs
  for (const struct of flattenedIR.structs) {
    const moveStruct = transformStruct(struct, context);
    module.structs.push(moveStruct);
  }

  // Transform enums (Move v2 supports enums)
  for (const enumDef of flattenedIR.enums) {
    const moveEnum = transformEnum(enumDef, context);
    module.enums.push(moveEnum);
  }

  // Transform events
  for (const event of flattenedIR.events) {
    const eventStruct = transformEvent(event, context);
    module.structs.push(eventStruct);
  }

  // Transform Solidity constants to Move const declarations FIRST
  // This populates context.constants so function transformation knows about constants
  const stateConstants = generateStateConstants(flattenedIR.stateVariables, context);
  module.constants.push(...stateConstants);

  // Transform constructor to init_module
  if (flattenedIR.constructor) {
    const initFn = transformConstructor(flattenedIR.constructor, flattenedIR.name, flattenedIR.stateVariables, context);
    module.functions.push(initFn);
  } else if (flattenedIR.stateVariables.length > 0) {
    // Generate default init_module
    module.functions.push(generateDefaultInit(flattenedIR.name, flattenedIR.stateVariables, context));
  }

  // Deduplicate overloaded functions before transformation
  // Move doesn't support function overloading, so rename duplicates
  const deduplicatedFunctions = deduplicateOverloadedFunctions(flattenedIR.functions);

  // Transform functions BEFORE generating error constants
  // This allows error codes from require/assert messages to be discovered first
  for (const fn of deduplicatedFunctions) {
    const moveFn = transformFunction(fn, context);
    module.functions.push(moveFn);
  }

  // Add error constants AFTER function transformation
  // so dynamically discovered error codes from require messages are included
  const errorConstants = generateErrorConstants(flattenedIR, context);
  module.constants.push(...errorConstants);

  // Finalize imports based on used modules
  module.uses = generateImports(context);

  return {
    success: context.errors.length === 0,
    module,
    errors: context.errors,
    warnings: context.warnings,
  };
}

/**
 * Add standard imports that most modules need
 */
function addStandardImports(module: MoveModule, context: TranspileContext): void {
  context.usedModules.add('std::signer');
}

/**
 * Generate imports based on used modules
 */
function generateImports(context: TranspileContext): MoveUseDeclaration[] {
  const imports: MoveUseDeclaration[] = [];

  for (const mod of context.usedModules) {
    const parts = mod.split('::');
    if (parts.length === 2) {
      imports.push({
        module: mod,
      });
    }
  }

  return imports;
}

/**
 * Transform state variables to a resource struct
 */
function transformStateVariablesToResource(
  variables: IRStateVariable[],
  contractName: string,
  context: TranspileContext
): MoveStruct {
  const struct: MoveStruct = {
    name: `${contractName}State`,
    abilities: ['key'],
    fields: [],
    isResource: true,
  };

  for (const variable of variables) {
    if (variable.mutability === 'constant') {
      // Constants don't go in the resource struct
      continue;
    }

    const field = transformStateVariable(variable, context);
    struct.fields.push(field);
  }

  return struct;
}

/**
 * Generate default init_module function
 */
function generateDefaultInit(
  contractName: string,
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveFunction {
  const stateName = `${contractName}State`;

  return {
    name: 'init_module',
    visibility: 'private',
    params: [{ name: 'deployer', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } }],
    body: [
      {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'move_to',
          args: [
            { kind: 'identifier', name: 'deployer' },
            {
              kind: 'struct',
              name: stateName,
              fields: stateVariables
                .filter(v => v.mutability !== 'constant')
                .map(v => ({
                  name: v.name,
                  value: v.initialValue ?
                    transformIRExpressionToMove(v.initialValue) :
                    getDefaultValue(v.type),
                })),
            },
          ],
        },
      },
    ],
  };
}

/**
 * Generate error constants
 * Based on EVM error code patterns from e2m reverse engineering
 */
function generateErrorConstants(ir: IRContract, context: TranspileContext): MoveConstant[] {
  const constants: MoveConstant[] = [];

  // Standard error codes matching EVM Solidity patterns
  const standardErrors: Array<{ name: string; code: number; comment?: string }> = [
    { name: 'E_REVERT', code: 0x00, comment: 'Generic revert' },
    { name: 'E_REQUIRE_FAILED', code: 0x01, comment: 'Require condition failed' },
    { name: 'E_ASSERT_FAILED', code: 0x01, comment: 'Assert condition failed' },
    { name: 'E_UNAUTHORIZED', code: 0x02, comment: 'Unauthorized access' },
    { name: 'E_INVALID_ARGUMENT', code: 0x03, comment: 'Invalid argument' },
    { name: 'E_INSUFFICIENT_BALANCE', code: 0x04, comment: 'Insufficient balance' },
    { name: 'E_REENTRANCY', code: 0x05, comment: 'Reentrancy detected' },
    { name: 'E_PAUSED', code: 0x06, comment: 'Contract is paused' },
    { name: 'E_NOT_PAUSED', code: 0x07, comment: 'Contract is not paused' },
    { name: 'E_ALREADY_EXISTS', code: 0x08, comment: 'Already exists' },
    { name: 'E_NOT_FOUND', code: 0x09, comment: 'Not found' },
    { name: 'E_EXPIRED', code: 0x0A, comment: 'Expired or deadline passed' },
    { name: 'E_LOCKED', code: 0x0B, comment: 'Resource is locked' },
    { name: 'E_INVALID_ADDRESS', code: 0x0C, comment: 'Invalid address (zero address)' },
    { name: 'E_INVALID_AMOUNT', code: 0x0D, comment: 'Invalid amount' },
    { name: 'E_TRANSFER_FAILED', code: 0x0E, comment: 'Transfer failed' },
    { name: 'E_INSUFFICIENT_ALLOWANCE', code: 0x0F, comment: 'Insufficient allowance' },
    { name: 'E_OVERFLOW', code: 0x11, comment: 'Arithmetic overflow' },
    { name: 'E_UNDERFLOW', code: 0x12, comment: 'Arithmetic underflow' },
    { name: 'E_DIVISION_BY_ZERO', code: 0x12, comment: 'Division by zero' },
  ];

  // Add standard error codes
  for (const error of standardErrors) {
    constants.push({
      name: error.name,
      type: { kind: 'primitive', name: 'u64' },
      value: { kind: 'literal', type: 'number', value: error.code, suffix: 'u64' },
    });
  }

  // Add custom errors from the contract (starting at 0x100 to avoid conflicts)
  // Check for duplicates to avoid redefining standard error codes
  let customErrorCode = 0x100;
  for (const error of ir.errors) {
    const errorName = `E_${toScreamingSnakeCase(error.name)}`;
    // Skip if already defined (e.g., E_OVERFLOW, E_LOCKED are standard codes)
    if (!constants.some(c => c.name === errorName)) {
      constants.push({
        name: errorName,
        type: { kind: 'primitive', name: 'u64' },
        value: { kind: 'literal', type: 'number', value: customErrorCode++, suffix: 'u64' },
      });
    }
  }

  // Add dynamically discovered error codes from require/revert messages
  if (context.errorCodes) {
    for (const [name, info] of context.errorCodes) {
      if (!constants.some(c => c.name === name)) {
        constants.push({
          name,
          type: { kind: 'primitive', name: 'u64' },
          value: { kind: 'literal', type: 'number', value: customErrorCode++, suffix: 'u64' },
        });
      }
    }
  }

  return constants;
}

/**
 * Generate Move const declarations from Solidity constant state variables
 */
function generateStateConstants(
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveConstant[] {
  const constants: MoveConstant[] = [];

  for (const variable of stateVariables) {
    if (variable.mutability !== 'constant') continue;

    // Get the Move type for this constant
    const moveType = variable.type.move || { kind: 'primitive', name: 'u256' };

    // Transform the initial value to a Move expression
    let value: any;
    if (variable.initialValue) {
      value = transformConstantValue(variable.initialValue, moveType);
    } else {
      value = getDefaultConstantValue(moveType);
    }

    // Add to context so expression transformer knows this is a constant
    if (!context.constants) {
      context.constants = new Map();
    }
    context.constants.set(variable.name, { type: moveType, value });

    constants.push({
      name: toScreamingSnakeCase(variable.name),
      type: moveType,
      value,
    });
  }

  return constants;
}

/**
 * Transform a constant initial value to Move expression
 */
function transformConstantValue(expr: any, targetType: any): any {
  if (!expr) return getDefaultConstantValue(targetType);

  // Handle literals
  if (expr.kind === 'literal') {
    const suffix = getMoveTypeSuffix(targetType);
    return {
      kind: 'literal',
      type: expr.type,
      value: expr.value,
      suffix,
    };
  }

  // Handle identifiers (references to other constants)
  if (expr.kind === 'identifier') {
    return { kind: 'identifier', name: toScreamingSnakeCase(expr.name) };
  }

  // Handle binary operations (for compile-time constant expressions)
  if (expr.kind === 'binary') {
    return {
      kind: 'binary',
      operator: expr.operator,
      left: transformConstantValue(expr.left, targetType),
      right: transformConstantValue(expr.right, targetType),
    };
  }

  // Default: return as-is with suffix
  return expr;
}

/**
 * Get Move type suffix for literals
 */
function getMoveTypeSuffix(type: any): string {
  if (type?.name?.startsWith('u')) return type.name;
  if (type?.name?.startsWith('i')) return type.name;
  return 'u256';
}

/**
 * Get default value for a constant type
 */
function getDefaultConstantValue(type: any): any {
  if (type?.kind === 'primitive') {
    if (type.name === 'bool') return { kind: 'literal', type: 'bool', value: false };
    if (type.name.startsWith('u') || type.name.startsWith('i')) {
      return { kind: 'literal', type: 'number', value: 0, suffix: type.name };
    }
  }
  return { kind: 'literal', type: 'number', value: 0, suffix: 'u256' };
}

/**
 * Transform struct to Move struct
 */
function transformStruct(struct: { name: string; fields: any[] }, context: TranspileContext): MoveStruct {
  return {
    name: struct.name,
    abilities: ['copy', 'drop', 'store'],
    fields: struct.fields.map(field => ({
      name: toSnakeCase(field.name),
      type: field.type.move || { kind: 'primitive' as const, name: 'u256' },
    })),
    isResource: false,
  };
}

/**
 * Transform enum to Move enum
 */
function transformEnum(enumDef: { name: string; members: string[] }, context: TranspileContext): any {
  // Move v2 supports native enums
  return {
    name: enumDef.name,
    variants: enumDef.members.map((member, index) => ({
      name: member,
      // Each variant can be represented as a unit variant in Move
    })),
    abilities: ['copy', 'drop', 'store'],
  };
}

/**
 * Extract function from Solidity AST
 */
function extractFunction(node: FunctionDefinition): IRFunction {
  return {
    name: node.name || '',
    visibility: (node.visibility as any) || 'public',
    stateMutability: (node.stateMutability as any) || 'nonpayable',
    params: (node.parameters || []).map((p: any) => ({
      name: p.name || '',
      type: createIRType(p.typeName),
      storageLocation: p.storageLocation,
    })),
    returnParams: (node.returnParameters || []).map((p: any) => ({
      name: p.name || '',
      type: createIRType(p.typeName),
      storageLocation: p.storageLocation,
    })),
    modifiers: (node.modifiers || []).map((m: any) => ({
      name: m.name,
      args: (m.arguments || []).map(transformExpressionToIR),
    })),
    body: node.body ? transformBlockToIR(node.body) : [],
    isVirtual: node.isVirtual || false,
    isOverride: node.override !== null,
  };
}

/**
 * Extract constructor from Solidity AST
 */
function extractConstructor(node: FunctionDefinition): IRConstructor {
  return {
    params: (node.parameters || []).map((p: any) => ({
      name: p.name || '',
      type: createIRType(p.typeName),
      storageLocation: p.storageLocation,
    })),
    modifiers: (node.modifiers || []).map((m: any) => ({
      name: m.name,
      args: (m.arguments || []).map(transformExpressionToIR),
    })),
    body: node.body ? transformBlockToIR(node.body) : [],
  };
}

/**
 * Extract event from Solidity AST
 */
function extractEvent(node: EventDefinition): IREvent {
  return {
    name: node.name,
    params: node.parameters.map((p: any) => ({
      name: p.name || '',
      type: createIRType(p.typeName),
      indexed: p.isIndexed || false,
    })),
  };
}

/**
 * Extract modifier from Solidity AST
 */
function extractModifier(node: ModifierDefinition): IRModifier {
  return {
    name: node.name,
    params: (node.parameters || []).map((p: any) => ({
      name: p.name || '',
      type: createIRType(p.typeName),
    })),
    body: node.body ? transformBlockToIR(node.body) : [],
  };
}

// Transform expression to IR
function transformExpressionToIR(expr: any): any {
  return solidityExpressionToIR(expr);
}

// Transform block to IR statements
function transformBlockToIR(block: any): any[] {
  if (!block || !block.statements) {
    return [];
  }
  return block.statements.map((stmt: any) => solidityStatementToIR(stmt));
}

function transformIRExpressionToMove(expr: any): any {
  return expr;
}

function getDefaultValue(type: any): any {
  if (type.move?.kind === 'primitive') {
    switch (type.move.name) {
      case 'bool': return { kind: 'literal', type: 'bool', value: false };
      case 'address': return { kind: 'call', function: '@0x0', args: [] };
      default:
        if (type.move.name.startsWith('u') || type.move.name.startsWith('i')) {
          return { kind: 'literal', type: 'number', value: 0 };
        }
    }
  }
  if (type.move?.kind === 'vector') {
    return { kind: 'call', function: 'vector::empty', args: [] };
  }
  return { kind: 'literal', type: 'number', value: 0 };
}

/**
 * Convert string to snake_case
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

/**
 * Convert string to SCREAMING_SNAKE_CASE
 * Handles spaces, camelCase, and special characters
 */
function toScreamingSnakeCase(str: string): string {
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
