/**
 * Contract Transformer
 * Transforms Solidity contracts to Move modules
 */

import type { ContractDefinition, FunctionDefinition, EventDefinition, ModifierDefinition } from '@solidity-parser/parser/dist/src/ast-types.js';
import type { MoveModule, MoveUseDeclaration, MoveStruct, MoveFunction, MoveConstant, MoveExpression, MoveStatement, MoveType, MoveAbility, MoveStructField } from '../types/move-ast.js';
import type { IRContract, IRStateVariable, IRFunction, IREvent, IRModifier, IRConstructor, TranspileContext, TranspileResult, FunctionSignature } from '../types/ir.js';
import { transformStateVariable } from './state-transformer.js';
import { analyzeContract, buildResourcePlan } from '../analyzer/state-analyzer.js';
import type { ResourceGroup } from '../types/optimization.js';
import { transformFunction, transformConstructor } from './function-transformer.js';
import { transformEvent } from './event-transformer.js';
import { createIRType } from '../mapper/type-mapper.js';
import { solidityStatementToIR, solidityExpressionToIR, wrapErrorCode } from './expression-transformer.js';
import { createHash } from 'node:crypto';

/**
 * Get the configured signer parameter name from context.
 * Returns 'account' (default) or 'signer' depending on the signerParamName flag.
 */
function signerName(context: TranspileContext): string {
  return context.signerParamName || 'account';
}

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
    isLibrary: contract.kind === 'library',
    usingFor: [],
  };

  // Process all sub-nodes
  for (const node of contract.subNodes) {
    const nodeAny = node as any;
    switch (node.type) {
      case 'StateVariableDeclaration':
        for (const variable of nodeAny.variables || []) {
          if (variable.typeName) {
            const irType = createIRType(variable.typeName);
            // Detect mapping-like types: native Mapping or OpenZeppelin map types (UintToUintMap etc.)
            const isNativeMapping = variable.typeName.type === 'Mapping';
            const isMapType = irType.isMapping; // Set by createIRType for OZ map types
            ir.stateVariables.push({
              name: variable.name || '',
              type: irType,
              visibility: (variable.visibility as any) || 'internal',
              mutability: variable.isDeclaredConst ? 'constant' :
                         (variable.isImmutable ? 'immutable' : 'mutable'),
              initialValue: nodeAny.initialValue ? transformExpressionToIR(nodeAny.initialValue) : undefined,
              isMapping: isNativeMapping || isMapType,
              mappingKeyType: isNativeMapping ? createIRType(variable.typeName.keyType) :
                            isMapType ? irType.keyType : undefined,
              mappingValueType: isNativeMapping ? createIRType(variable.typeName.valueType) :
                              isMapType ? irType.valueType : undefined,
            });
          }
        }
        break;

      case 'FunctionDefinition':
        if (nodeAny.isConstructor) {
          ir.constructor = extractConstructor(nodeAny as FunctionDefinition);
        } else if (nodeAny.isReceiveEther) {
          // Fail-fast: receive() has no Move equivalent
          ir.functions.push({
            name: '_receive',
            visibility: 'external',
            stateMutability: 'payable',
            params: [],
            returnParams: [],
            modifiers: [],
            body: [{
              kind: 'expression',
              expression: { kind: 'literal', type: 'string', value: 'UNSUPPORTED: receive() has no Move equivalent' },
            }],
            isVirtual: false,
            isOverride: false,
          });
        } else if (nodeAny.isFallback) {
          // Fail-fast: fallback() has no Move equivalent
          ir.functions.push({
            name: '_fallback',
            visibility: 'external',
            stateMutability: nodeAny.stateMutability || 'nonpayable',
            params: [],
            returnParams: [],
            modifiers: [],
            body: [{
              kind: 'expression',
              expression: { kind: 'literal', type: 'string', value: 'UNSUPPORTED: fallback() has no Move equivalent' },
            }],
            isVirtual: false,
            isOverride: false,
          });
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

      case 'UsingForDeclaration':
        // using SafeMath for uint256;
        ir.usingFor!.push({
          libraryName: nodeAny.libraryName || nodeAny.typeName?.namePath || '',
          typeName: nodeAny.typeName?.name || nodeAny.typeName?.namePath || '*',
        });
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
    if (expr.kind === 'function_call') return exprRefs(expr.function) || exprRefs(expr.expression) || (expr.args || []).some(exprRefs);
    if (expr.kind === 'member_access') return exprRefs(expr.object);
    if (expr.kind === 'index_access') return exprRefs(expr.base) || exprRefs(expr.index) || exprRefs(expr.object);
    if (expr.kind === 'conditional') return exprRefs(expr.condition) || exprRefs(expr.trueExpression) || exprRefs(expr.falseExpression);
    if (expr.kind === 'type_conversion') return exprRefs(expr.expression) || exprRefs(expr.value);
    if (expr.kind === 'tuple') return (expr.elements || []).some(exprRefs);
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
export interface TranspileFlags {
  optimizationLevel?: 'low' | 'medium' | 'high';
  strictMode?: boolean;
  reentrancyPattern?: 'mutex' | 'none';
  stringType?: 'string' | 'bytes';
  useInlineFunctions?: boolean;
  emitSourceComments?: boolean;
  viewFunctionBehavior?: 'annotate' | 'skip';
  errorStyle?: 'abort-codes' | 'abort-verbose';
  enumStyle?: 'native-enum' | 'u8-constants';
  constructorPattern?: 'resource-account' | 'deployer-direct' | 'named-object';
  internalVisibility?: 'public-package' | 'public-friend' | 'private';
  overflowBehavior?: 'abort' | 'wrapping';
  mappingType?: 'table' | 'smart-table';
  accessControl?: 'inline-assert' | 'capability';
  upgradeability?: 'immutable' | 'resource-account';
  optionalValues?: 'sentinel' | 'option-type';
  callStyle?: 'module-qualified' | 'receiver';
  eventPattern?: 'native' | 'event-handle' | 'none';
  signerParamName?: 'account' | 'signer';
  emitAllErrorConstants?: boolean;
  errorCodeType?: 'u64' | 'aptos-error-module';
  indexNotation?: boolean;
  acquiresStyle?: 'explicit' | 'inferred';
}

export function irToMoveModule(
  ir: IRContract,
  moduleAddress: string,
  allContracts?: Map<string, IRContract>,
  options?: TranspileFlags
): TranspileResult {
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
    structs: new Map(flattenedIR.structs.map(s => [s.name, s])),
    errors: [],
    warnings: [],
    usedModules: new Set(),
    acquiredResources: new Set(),
    inheritedContracts: allContracts,
    optimizationLevel: options?.optimizationLevel || 'low',
    strictMode: options?.strictMode || false,
    reentrancyPattern: options?.reentrancyPattern || 'mutex',
    stringType: options?.stringType || 'string',
    useInlineFunctions: options?.useInlineFunctions || false,
    emitSourceComments: options?.emitSourceComments || false,
    viewFunctionBehavior: options?.viewFunctionBehavior || 'annotate',
    errorStyle: options?.errorStyle || 'abort-codes',
    enumStyle: options?.enumStyle || 'native-enum',
    constructorPattern: options?.constructorPattern || 'resource-account',
    internalVisibility: options?.internalVisibility || 'public-package',
    overflowBehavior: options?.overflowBehavior || 'abort',
    mappingType: options?.mappingType || 'table',
    accessControl: options?.accessControl || 'inline-assert',
    upgradeability: options?.upgradeability || 'immutable',
    optionalValues: options?.optionalValues || 'sentinel',
    callStyle: options?.callStyle || 'module-qualified',
    eventPattern: options?.eventPattern || 'native',
    signerParamName: options?.signerParamName || 'account',
    emitAllErrorConstants: options?.emitAllErrorConstants !== false,
    errorCodeType: options?.errorCodeType || 'u64',
    indexNotation: options?.indexNotation || false,
    acquiresStyle: options?.acquiresStyle || 'explicit',
  };

  // Attach function registry for borrow checker prevention
  (context as any).functionRegistry = functionRegistry;

  // Pass using-for declarations for library method inlining
  context.usingFor = flattenedIR.usingFor;

  // Build library function map: maps function_name → library_module_name
  // This enables qualified cross-module calls (e.g., packed_uint128_math::decode)
  const libraryFunctions = new Map<string, string>();
  if (allContracts && flattenedIR.usingFor) {
    for (const using of flattenedIR.usingFor) {
      const library = allContracts.get(using.libraryName);
      if (library) {
        const moduleName = toSnakeCase(using.libraryName);
        for (const fn of library.functions) {
          const fnName = toSnakeCase(fn.name);
          // Don't overwrite if already mapped (first library wins, matches Solidity semantics)
          if (!libraryFunctions.has(fnName)) {
            libraryFunctions.set(fnName, moduleName);
          }
        }
      }
    }
  }
  context.libraryFunctions = libraryFunctions;

  // Build function signature registry for type inference
  const functionSignatures = new Map<string, FunctionSignature>();

  // 1. Local functions from this contract
  for (const fn of flattenedIR.functions) {
    const fnName = toSnakeCase(fn.name);
    const paramTypes = fn.params.map(p => p.type.move || { kind: 'primitive' as const, name: 'u256' as const });
    const returnType = fn.returnParams.length === 0
      ? undefined
      : fn.returnParams.length === 1
        ? (fn.returnParams[0].type.move || { kind: 'primitive' as const, name: 'u256' as const })
        : fn.returnParams.map(p => p.type.move || { kind: 'primitive' as const, name: 'u256' as const });
    functionSignatures.set(fnName, { params: paramTypes, returnType });
  }

  // 2. Library functions from usingFor declarations
  if (allContracts && flattenedIR.usingFor) {
    for (const using of flattenedIR.usingFor) {
      const library = allContracts.get(using.libraryName);
      if (library) {
        const moduleName = toSnakeCase(using.libraryName);
        for (const fn of library.functions) {
          const fnName = toSnakeCase(fn.name);
          const qualifiedName = `${moduleName}::${fnName}`;
          if (!functionSignatures.has(qualifiedName)) {
            const paramTypes = fn.params.map(p => p.type.move || { kind: 'primitive' as const, name: 'u256' as const });
            const returnType = fn.returnParams.length === 0
              ? undefined
              : fn.returnParams.length === 1
                ? (fn.returnParams[0].type.move || { kind: 'primitive' as const, name: 'u256' as const })
                : fn.returnParams.map(p => p.type.move || { kind: 'primitive' as const, name: 'u256' as const });
            functionSignatures.set(qualifiedName, { params: paramTypes, returnType, module: moduleName });
          }
          // Also register unqualified name for local lookups
          if (!functionSignatures.has(fnName)) {
            const paramTypes = fn.params.map(p => p.type.move || { kind: 'primitive' as const, name: 'u256' as const });
            const returnType = fn.returnParams.length === 0
              ? undefined
              : fn.returnParams.length === 1
                ? (fn.returnParams[0].type.move || { kind: 'primitive' as const, name: 'u256' as const })
                : fn.returnParams.map(p => p.type.move || { kind: 'primitive' as const, name: 'u256' as const });
            functionSignatures.set(fnName, { params: paramTypes, returnType, module: moduleName });
          }
        }
      }
    }
  }

  // 3. Standard library functions with known return types
  const stdlibSignatures: [string, FunctionSignature][] = [
    ['vector::length', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'vector', elementType: { kind: 'generic', name: 'T' } } }], returnType: { kind: 'primitive', name: 'u64' } }],
    ['vector::is_empty', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'vector', elementType: { kind: 'generic', name: 'T' } } }], returnType: { kind: 'primitive', name: 'bool' } }],
    ['vector::contains', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'vector', elementType: { kind: 'generic', name: 'T' } } }, { kind: 'reference', mutable: false, innerType: { kind: 'generic', name: 'T' } }], returnType: { kind: 'primitive', name: 'bool' } }],
    ['table::contains', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'struct', name: 'Table' } }, { kind: 'generic', name: 'K' }], returnType: { kind: 'primitive', name: 'bool' } }],
    ['smart_table::contains', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'struct', name: 'SmartTable' } }, { kind: 'generic', name: 'K' }], returnType: { kind: 'primitive', name: 'bool' } }],
    ['string::length', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'struct', name: 'String' } }], returnType: { kind: 'primitive', name: 'u64' } }],
    ['timestamp::now_seconds', { params: [], returnType: { kind: 'primitive', name: 'u64' } }],
    ['signer::address_of', { params: [{ kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } }], returnType: { kind: 'primitive', name: 'address' } }],
  ];
  for (const [name, sig] of stdlibSignatures) {
    if (!functionSignatures.has(name)) {
      functionSignatures.set(name, sig);
    }
  }

  context.functionSignatures = functionSignatures;

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
    callStyle: context.callStyle,
    indexNotation: context.indexNotation,
    eventPattern: context.eventPattern,
  };

  // Track if this is a library (no state, no init_module, pure functions)
  const isLibrary = flattenedIR.isLibrary;
  (context as any).isLibrary = isLibrary;

  // Add standard imports
  addStandardImports(module, context);

  // Transform state variables to resource struct(s) (skip for libraries)
  if (flattenedIR.stateVariables.length > 0 && !isLibrary) {
    const optLevel = context.optimizationLevel || 'low';

    if (optLevel !== 'low') {
      // Medium/High: Run state analyzer and split into resource groups
      const profile = analyzeContract(flattenedIR);
      const plan = buildResourcePlan(profile, optLevel);
      context.resourcePlan = plan;

      // Add optimization recommendations as warnings
      for (const rec of profile.recommendations) {
        context.warnings.push({ message: `[optimization] ${rec}`, severity: 'warning' });
      }
      context.warnings.push({
        message: `[optimization] Parallelization score: ${profile.parallelizationScore}/100`,
        severity: 'warning',
      });

      // Generate a resource struct for each group
      for (const group of plan.groups) {
        const resourceStruct = transformResourceGroup(group, context);
        if (group.isPrimary) {
          if (context.constructorPattern === 'resource-account') {
            resourceStruct.fields.push({
              name: 'signer_cap',
              type: { kind: 'struct', module: 'account', name: 'SignerCapability' },
            });
            context.usedModules.add('aptos_framework::account');
          } else if (context.constructorPattern === 'named-object') {
            resourceStruct.fields.push({
              name: 'extend_ref',
              type: { kind: 'struct', module: 'object', name: 'ExtendRef' },
            });
            context.usedModules.add('aptos_framework::object');
          }
          // deployer-direct: no extra field in primary group
        }
        module.structs.push(resourceStruct);
      }

      // If aggregatable variables exist at medium+, add aggregator import
      if (profile.variableAnalyses) {
        for (const [, analysis] of profile.variableAnalyses) {
          if (analysis.category === 'aggregatable') {
            context.usedModules.add('aptos_framework::aggregator_v2');
            break;
          }
        }
      }

      // Generate event structs for event-trackable variables (fees tracked via events)
      if (plan.eventTrackables && plan.eventTrackables.size > 0) {
        context.usedModules.add('aptos_framework::event');
        for (const [, config] of plan.eventTrackables) {
          module.structs.push({
            name: config.eventName,
            abilities: ['drop', 'store'],
            fields: [{ name: 'amount', type: config.fieldType }],
            isEvent: true,
          });
        }
      }

      // Generate per-user resource struct (high optimization)
      if (plan.perUserResources) {
        const pur = plan.perUserResources;
        module.structs.push({
          name: pur.structName,
          abilities: ['key'],
          fields: pur.fields.map(f => ({ name: f.fieldName, type: f.type })),
        });

        // Generate ensure_user_state helper function
        const sName = signerName(context);
        const ensureFn: MoveFunction = {
          name: 'ensure_user_state',
          visibility: 'private',
          params: [{ name: sName, type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } }],
          returnType: undefined,
          body: [],
          acquires: [pur.structName],
        };

        // Build: if (!exists<UserState>(signer::address_of(account))) { move_to(account, UserState { field: default }) }
        const addrExpr: MoveExpression = {
          kind: 'call', module: 'signer', function: 'address_of',
          args: [{ kind: 'identifier', name: sName }],
        };
        const existsExpr: MoveExpression = {
          kind: 'call', function: `exists<${pur.structName}>`,
          args: [addrExpr],
        };
        const notExists: MoveExpression = {
          kind: 'unary', operator: '!', operand: existsExpr,
        };
        const structFields = pur.fields.map(f => ({
          name: f.fieldName,
          value: getDefaultValueForType(f.type, context) as MoveExpression,
        }));
        const moveToCall: MoveStatement = {
          kind: 'expression',
          expression: {
            kind: 'call', function: 'move_to',
            args: [
              { kind: 'identifier', name: sName },
              { kind: 'struct', name: pur.structName, fields: structFields },
            ],
          },
        };
        ensureFn.body.push({
          kind: 'if',
          condition: notExists,
          thenBlock: [moveToCall],
          elseBlock: undefined,
        });

        module.functions.push(ensureFn);
        context.usedModules.add('std::signer');
      }
    } else {
      // Low: Single resource struct (current behavior)
      const resourceStruct = transformStateVariablesToResource(flattenedIR.stateVariables, flattenedIR.name, context);
      if (context.constructorPattern === 'resource-account') {
        resourceStruct.fields.push({
          name: 'signer_cap',
          type: { kind: 'struct', module: 'account', name: 'SignerCapability' },
        });
        context.usedModules.add('aptos_framework::account');
      } else if (context.constructorPattern === 'named-object') {
        resourceStruct.fields.push({
          name: 'extend_ref',
          type: { kind: 'struct', module: 'object', name: 'ExtendRef' },
        });
        context.usedModules.add('aptos_framework::object');
      }
      // deployer-direct: no extra field needed
      module.structs.push(resourceStruct);
    }
  }

  // Transform custom structs
  for (const struct of flattenedIR.structs) {
    const moveStruct = transformStruct(struct, context);
    module.structs.push(moveStruct);
  }

  // Generate capability structs when accessControl === 'capability'
  if (context.accessControl === 'capability' && !isLibrary) {
    if (contractUsesOwnerModifier(flattenedIR)) {
      module.structs.push({
        name: 'OwnerCapability',
        abilities: ['key'],
        fields: [],
        isResource: false,
      });
    }
    const roleNames = contractUsesRoleModifiers(flattenedIR);
    for (const roleName of roleNames) {
      const capName = roleNameToCapabilityStruct(roleName);
      module.structs.push({
        name: capName,
        abilities: ['key'],
        fields: [],
        isResource: false,
      });
    }
  }

  // Transform enums (Move v2 supports enums)
  for (const enumDef of flattenedIR.enums) {
    if (context.enumStyle === 'u8-constants') {
      // Generate u8 constants for each variant instead of native enum
      for (let i = 0; i < enumDef.members.length; i++) {
        const constName = `${toScreamingSnakeCase(enumDef.name)}_${toScreamingSnakeCase(enumDef.members[i])}`;
        module.constants.push({
          name: constName,
          type: { kind: 'primitive', name: 'u8' },
          value: { kind: 'literal', type: 'number', value: i, suffix: 'u8' },
        });
      }
    } else {
      const moveEnum = transformEnum(enumDef, context);
      module.enums.push(moveEnum);
    }
  }

  // Transform events (respects eventPattern flag)
  if (context.eventPattern !== 'none') {
    for (const event of flattenedIR.events) {
      const eventStruct = transformEvent(event, context);
      if (eventStruct) {
        module.structs.push(eventStruct);
      }
    }
  }

  // For event-handle mode: add EventHandle<T> fields to the state struct
  if (context.eventPattern === 'event-handle' && flattenedIR.events.length > 0 && !isLibrary) {
    context.usedModules.add('aptos_framework::event');
    context.usedModules.add('aptos_framework::account');

    // Find the primary state struct (the one with isResource flag)
    const stateStruct = module.structs.find(s => s.isResource);
    if (stateStruct) {
      for (const event of flattenedIR.events) {
        const handleFieldName = `${toSnakeCase(event.name)}_events`;
        // Only add if not already present (avoid duplicates from inheritance)
        if (!stateStruct.fields.some(f => f.name === handleFieldName)) {
          stateStruct.fields.push({
            name: handleFieldName,
            type: {
              kind: 'struct',
              module: 'event',
              name: 'EventHandle',
              typeArgs: [{ kind: 'struct', name: event.name }],
            },
          });
        }
      }
    }
  }

  // Transform Solidity constants to Move const declarations FIRST
  // This populates context.constants so function transformation knows about constants
  const stateConstants = generateStateConstants(flattenedIR.stateVariables, context);
  module.constants.push(...stateConstants);

  // Pre-compute whether we need OwnerCapability move_to in init functions
  const needsOwnerCap = context.accessControl === 'capability' && contractUsesOwnerModifier(flattenedIR);

  // Transform constructor to init_module (skip for libraries)
  if (!isLibrary) {
    if (flattenedIR.constructor) {
      const initFn = transformConstructor(flattenedIR.constructor, flattenedIR.name, flattenedIR.stateVariables, context);
      // Append OwnerCapability move_to at the end of the constructor body
      if (needsOwnerCap) {
        initFn.body.push(generateCapabilityMoveTo({ kind: 'identifier', name: 'deployer' }));
      }
      module.functions.push(initFn);
    } else if (flattenedIR.stateVariables.length > 0) {
      // Generate default init_module based on constructor pattern
      let initFn: MoveFunction;
      if (context.resourcePlan && context.optimizationLevel !== 'low') {
        initFn = generateOptimizedInit(flattenedIR.name, flattenedIR.stateVariables, context);
      } else if (context.constructorPattern === 'deployer-direct') {
        initFn = generateDeployerDirectInit(flattenedIR.name, flattenedIR.stateVariables, context);
      } else if (context.constructorPattern === 'named-object') {
        initFn = generateNamedObjectInit(flattenedIR.name, flattenedIR.stateVariables, context);
      } else {
        initFn = generateDefaultInit(flattenedIR.name, flattenedIR.stateVariables, context);
      }
      // Append OwnerCapability move_to at the end of init_module body
      if (needsOwnerCap) {
        initFn.body.push(generateCapabilityMoveTo({ kind: 'identifier', name: 'deployer' }));
      }
      module.functions.push(initFn);
    }

    // For event-handle mode: inject EventHandle initialization into init_module state struct
    if (context.eventPattern === 'event-handle' && flattenedIR.events.length > 0) {
      injectEventHandleInitFields(module, flattenedIR.events, context);
    }
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

  // Generate upgrade_module function if upgradeability is enabled
  // Requires resource-account constructor pattern (signer_cap field must exist)
  if (context.upgradeability === 'resource-account' &&
      context.constructorPattern === 'resource-account' &&
      !isLibrary) {
    module.functions.push(generateUpgradeFunction(flattenedIR.name, context));
  }

  // Copy imported constants from other modules (Move constants are module-private)
  // Constants.SCALE in Solidity → need to copy SCALE definition into this module
  const importedConstants = (context as any).importedConstants as Map<string, { source: string; name: string }> | undefined;
  if (importedConstants && importedConstants.size > 0 && context.inheritedContracts) {
    // Pre-build evaluated constants from source contracts so cross-references resolve
    // e.g., SCALE = 1 << SCALE_OFFSET needs SCALE_OFFSET to be evaluated first
    const sourceConstantsCache = new Map<string, Map<string, { type: any; value: any }>>();
    for (const [, { source }] of importedConstants) {
      if (sourceConstantsCache.has(source)) continue;
      const sourceContract = context.inheritedContracts.get(source);
      if (!sourceContract) continue;
      const srcConstants = new Map<string, { type: any; value: any }>();
      for (const v of sourceContract.stateVariables) {
        if (v.mutability !== 'constant') continue;
        const mt = v.type.move || { kind: 'primitive', name: 'u256' };
        const val = v.initialValue ? transformConstantValue(v.initialValue, mt, srcConstants) : getDefaultConstantValue(mt);
        srcConstants.set(v.name, { type: mt, value: val });
      }
      sourceConstantsCache.set(source, srcConstants);
    }

    for (const [constName, { source, name: originalName }] of importedConstants) {
      // Skip if already defined in this module
      if (context.constants?.has(constName) || context.constants?.has(toScreamingSnakeCase(constName))) continue;
      const srcConstants = sourceConstantsCache.get(source);
      if (srcConstants) {
        // Look up using both stripped name and original name (may have leading underscores)
        const entry = srcConstants.get(constName) || srcConstants.get(originalName);
        if (entry) {
          const name = toScreamingSnakeCase(constName);
          if (!context.constants) context.constants = new Map();
          context.constants.set(constName, entry);
          module.constants.push({ name, type: entry.type, value: entry.value });
        }
      }
    }
  }

  // Add error constants AFTER function transformation
  // so dynamically discovered error codes from require messages are included.
  // When emitAllErrorConstants is false, scan function bodies to find which E_* codes are used.
  const referencedErrors = !context.emitAllErrorConstants
    ? collectReferencedErrorCodes(module.functions)
    : undefined;
  const errorConstants = generateErrorConstants(flattenedIR, context, referencedErrors);
  module.constants.push(...errorConstants);

  // Auto-discover cross-module references from function bodies
  discoverModuleReferences(module, context);

  // Finalize imports based on used modules
  module.uses = generateImports(context);

  // Strip acquires annotations if compiler-inferred mode (Move 2.2+)
  if (context.acquiresStyle === 'inferred') {
    for (const fn of module.functions) {
      delete fn.acquires;
    }
  }

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
  // Only add signer import for contracts with state (not for stateless libraries)
  if (!(context as any).isLibrary) {
    context.usedModules.add('std::signer');
  }
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

// Standard library module address mapping
const STDLIB_MODULES: Record<string, string> = {
  'vector': 'std::vector',
  'string': 'std::string',
  'option': 'std::option',
  'signer': 'std::signer',
  'error': 'std::error',
  'hash': 'std::hash',
  'bcs': 'aptos_std::bcs',
  'table': 'aptos_std::table',
  'smart_table': 'aptos_std::smart_table',
  'simple_map': 'aptos_std::simple_map',
  'math64': 'aptos_std::math64',
  'math128': 'aptos_std::math128',
  'aptos_hash': 'aptos_std::aptos_hash',
  'type_info': 'aptos_std::type_info',
  'coin': 'aptos_framework::coin',
  'account': 'aptos_framework::account',
  'timestamp': 'aptos_framework::timestamp',
  'event': 'aptos_framework::event',
  'object': 'aptos_framework::object',
  'fungible_asset': 'aptos_framework::fungible_asset',
  'primary_fungible_store': 'aptos_framework::primary_fungible_store',
  'evm_compat': 'transpiler::evm_compat',
  'aggregator_v2': 'aptos_framework::aggregator_v2',
  'code': 'aptos_framework::code',
  'u256': 'std::u256',
  'u128': 'std::u128',
  'u64': 'std::u64',
};

/**
 * Scan all function bodies for cross-module references (module::function patterns)
 * and auto-add the required use declarations to context.usedModules.
 */
function discoverModuleReferences(module: MoveModule, context: TranspileContext): void {
  const discovered = new Set<string>();

  for (const func of module.functions) {
    for (const stmt of func.body) {
      walkStatement(stmt, discovered);
    }
  }
  // Also scan constant values
  for (const constant of module.constants) {
    walkExpression(constant.value, discovered);
  }

  for (const moduleName of discovered) {
    // Check if it's a known stdlib module
    const fullPath = STDLIB_MODULES[moduleName];
    if (fullPath) {
      context.usedModules.add(fullPath);
    } else {
      // Assume it's a sibling module at the same address
      context.usedModules.add(`${context.moduleAddress}::${moduleName}`);
    }
  }
}

function walkStatement(stmt: MoveStatement, modules: Set<string>): void {
  switch (stmt.kind) {
    case 'let':
      if (stmt.value) walkExpression(stmt.value, modules);
      break;
    case 'assign':
      walkExpression(stmt.target, modules);
      walkExpression(stmt.value, modules);
      break;
    case 'if':
      walkExpression(stmt.condition, modules);
      stmt.thenBlock.forEach(s => walkStatement(s, modules));
      stmt.elseBlock?.forEach(s => walkStatement(s, modules));
      break;
    case 'while':
      walkExpression(stmt.condition, modules);
      stmt.body.forEach(s => walkStatement(s, modules));
      break;
    case 'loop':
      stmt.body.forEach(s => walkStatement(s, modules));
      break;
    case 'for':
      walkExpression(stmt.iterable, modules);
      stmt.body.forEach(s => walkStatement(s, modules));
      break;
    case 'return':
      if (stmt.value) walkExpression(stmt.value, modules);
      break;
    case 'abort':
      walkExpression(stmt.code, modules);
      break;
    case 'expression':
      walkExpression(stmt.expression, modules);
      break;
    case 'block':
      stmt.statements.forEach(s => walkStatement(s, modules));
      break;
  }
}

function walkExpression(expr: MoveExpression, modules: Set<string>): void {
  switch (expr.kind) {
    case 'call':
      // Check for module::function pattern
      if (expr.function.includes('::')) {
        const moduleName = expr.function.split('::')[0];
        modules.add(moduleName);
      }
      expr.args.forEach(a => walkExpression(a, modules));
      break;
    case 'binary':
      walkExpression(expr.left, modules);
      walkExpression(expr.right, modules);
      break;
    case 'unary':
      walkExpression(expr.operand, modules);
      break;
    case 'method_call':
      walkExpression(expr.receiver, modules);
      expr.args.forEach(a => walkExpression(a, modules));
      break;
    case 'field_access':
      walkExpression(expr.object, modules);
      break;
    case 'index':
      walkExpression(expr.object, modules);
      walkExpression(expr.index, modules);
      break;
    case 'struct':
      expr.fields.forEach(f => walkExpression(f.value, modules));
      break;
    case 'borrow':
    case 'dereference':
    case 'move':
    case 'copy':
      walkExpression(expr.value, modules);
      break;
    case 'cast':
      walkExpression(expr.value, modules);
      break;
    case 'if_expr':
      walkExpression(expr.condition, modules);
      walkExpression(expr.thenExpr, modules);
      if (expr.elseExpr) walkExpression(expr.elseExpr, modules);
      break;
    case 'tuple':
    case 'vector':
      expr.elements.forEach(e => walkExpression(e, modules));
      break;
    case 'break':
      if (expr.value) walkExpression(expr.value, modules);
      break;
    // literal, identifier, continue don't have sub-expressions
  }
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
 * Transform a resource group into a Move struct (used for medium/high optimization).
 * Each resource group becomes a separate `has key` struct.
 */
function transformResourceGroup(
  group: ResourceGroup,
  context: TranspileContext
): MoveStruct {
  const struct: MoveStruct = {
    name: group.name,
    abilities: ['key'],
    fields: [],
    isResource: true,
  };

  for (const analysis of group.variables) {
    const variable = analysis.variable;
    if (variable.mutability === 'constant') continue;

    // For aggregatable variables at medium+, use Aggregator type
    if (analysis.category === 'aggregatable' && context.optimizationLevel !== 'low') {
      struct.fields.push({
        name: toSnakeCase(variable.name),
        type: {
          kind: 'struct',
          module: 'aggregator_v2',
          name: 'Aggregator',
          typeArgs: [{ kind: 'primitive', name: 'u128' }],
        },
      });
    } else {
      const field = transformStateVariable(variable, context);
      struct.fields.push(field);
    }
  }

  return struct;
}

/**
 * Generate default init_module function (multi-resource version for medium/high).
 * Creates one move_to() call per resource group.
 */
function generateOptimizedInit(
  contractName: string,
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveFunction {
  const plan = context.resourcePlan;
  if (!plan) throw new Error('resourcePlan required for optimized init');

  context.usedModules.add('aptos_framework::account');
  context.usedModules.add('std::string');

  const body: MoveStatement[] = [
    // Create resource account
    {
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
    },
  ];

  // Generate one move_to() per resource group
  for (const group of plan.groups) {
    const fields: Array<{ name: string; value: MoveExpression }> = [];

    for (const analysis of group.variables) {
      const v = analysis.variable;
      if (v.mutability === 'constant') continue;

      if (analysis.category === 'aggregatable' && context.optimizationLevel !== 'low') {
        // Initialize unbounded Aggregator (no max_value limit, better parallelism)
        context.usedModules.add('aptos_framework::aggregator_v2');
        if (v.initialValue) {
          // Non-zero initial value: use create_unbounded_aggregator_with_value()
          const initValue = transformIRExpressionToMove(v.initialValue);
          fields.push({
            name: toSnakeCase(v.name),
            value: {
              kind: 'call',
              function: 'aggregator_v2::create_unbounded_aggregator_with_value',
              args: [initValue],
            },
          });
        } else {
          // Zero initial value: use create_unbounded_aggregator()
          fields.push({
            name: toSnakeCase(v.name),
            value: {
              kind: 'call',
              function: 'aggregator_v2::create_unbounded_aggregator',
              typeArgs: [{ kind: 'primitive', name: 'u128' }],
              args: [],
            },
          });
        }
      } else if (v.isMapping) {
        // Mapping types need table::new() or smart_table::new() initialization
        const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
        const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
        context.usedModules.add(tblModPath);
        fields.push({
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: `${tblModPrefix}::new`, args: [] },
        });
      } else if (v.type.isArray) {
        // Array types need vector::empty() initialization
        fields.push({
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: 'vector::empty', args: [] },
        });
      } else {
        fields.push({
          name: toSnakeCase(v.name),
          value: v.initialValue
            ? transformIRExpressionToMove(v.initialValue)
            : getDefaultValue(v.type, context),
        });
      }
    }

    // Primary group gets signer_cap
    if (group.isPrimary) {
      fields.push({
        name: 'signer_cap',
        value: { kind: 'identifier', name: 'signer_cap' },
      });
    }

    body.push({
      kind: 'expression',
      expression: {
        kind: 'call',
        function: 'move_to',
        args: [
          { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'resource_signer' } },
          {
            kind: 'struct',
            name: group.name,
            fields,
          },
        ],
      },
    });
  }

  return {
    name: 'init_module',
    visibility: 'private',
    params: [{ name: 'deployer', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } }],
    body,
  };
}

/**
 * Inject EventHandle initialization fields into init_module for event-handle mode.
 * Walks the init function body to find move_to struct expressions and adds
 * `event_name_events: account::new_event_handle<EventType>(account)` fields.
 */
function injectEventHandleInitFields(
  module: MoveModule,
  events: IREvent[],
  context: TranspileContext
): void {
  // Find the init_module function
  const initFn = module.functions.find(f => f.name === 'init_module');
  if (!initFn) return;

  // Determine the signer identifier used in the init function
  // (typically 'deployer' for resource-account pattern, or the first param name)
  const signerName = initFn.params.length > 0 ? initFn.params[0].name : 'deployer';

  // Walk all statements to find move_to calls with struct expressions
  for (const stmt of initFn.body) {
    if (stmt.kind === 'expression' && stmt.expression.kind === 'call') {
      const call = stmt.expression as any;
      if (call.function === 'move_to') {
        // Find the struct arg (typically the second argument to move_to)
        for (const arg of call.args) {
          if (arg.kind === 'struct') {
            // Check if this is the primary state struct (contains resource fields)
            // Add event handle fields for each event
            for (const event of events) {
              const handleFieldName = `${toSnakeCase(event.name)}_events`;
              // Only add if not already present
              if (!arg.fields.some((f: any) => f.name === handleFieldName)) {
                arg.fields.push({
                  name: handleFieldName,
                  value: {
                    kind: 'call',
                    function: 'account::new_event_handle',
                    typeArgs: [{ kind: 'struct', name: event.name }],
                    args: [{ kind: 'identifier', name: signerName }],
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  context.usedModules.add('aptos_framework::account');
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

  context.usedModules.add('aptos_framework::account');
  context.usedModules.add('std::string');

  const stateFields = stateVariables
    .filter(v => v.mutability !== 'constant')
    .map(v => {
      if (v.isMapping) {
        const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
        const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
        context.usedModules.add(tblModPath);
        return {
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: `${tblModPrefix}::new`, args: [] } as any,
        };
      }
      if (v.type.isArray) {
        return {
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: 'vector::empty', args: [] } as any,
        };
      }
      return {
        name: toSnakeCase(v.name),
        value: v.initialValue ?
          transformIRExpressionToMove(v.initialValue) :
          getDefaultValue(v.type, context),
      };
    });

  // Add signer_cap field
  stateFields.push({
    name: 'signer_cap',
    value: { kind: 'identifier', name: 'signer_cap' },
  });

  return {
    name: 'init_module',
    visibility: 'private',
    params: [{ name: 'deployer', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } }],
    body: [
      // Create resource account: let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"seed");
      {
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
      },
      // move_to(&resource_signer, State { ... })
      {
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
      },
    ],
  };
}

/**
 * Generate deployer-direct init_module function.
 * Stores state directly at the deployer's address via move_to(deployer, ...).
 * No resource account creation, no signer_cap field.
 */
function generateDeployerDirectInit(
  contractName: string,
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveFunction {
  const stateName = `${contractName}State`;

  const stateFields = stateVariables
    .filter(v => v.mutability !== 'constant')
    .map(v => {
      if (v.isMapping) {
        const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
        const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
        context.usedModules.add(tblModPath);
        return {
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: `${tblModPrefix}::new`, args: [] } as any,
        };
      }
      if (v.type.isArray) {
        return {
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: 'vector::empty', args: [] } as any,
        };
      }
      return {
        name: toSnakeCase(v.name),
        value: v.initialValue ?
          transformIRExpressionToMove(v.initialValue) :
          getDefaultValue(v.type, context),
      };
    });

  return {
    name: 'init_module',
    visibility: 'private',
    params: [{ name: 'deployer', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } }],
    body: [
      // move_to(deployer, State { ... })
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
              fields: stateFields,
            },
          ],
        },
      },
    ],
  };
}

/**
 * Generate named-object init_module function.
 * Uses Aptos Object model: creates a named object, stores state on the object signer,
 * and persists an extend_ref for future state access.
 */
function generateNamedObjectInit(
  contractName: string,
  stateVariables: IRStateVariable[],
  context: TranspileContext
): MoveFunction {
  const stateName = `${contractName}State`;

  context.usedModules.add('aptos_framework::object');

  const stateFields = stateVariables
    .filter(v => v.mutability !== 'constant')
    .map(v => {
      if (v.isMapping) {
        const tblModPath = context.mappingType === 'smart-table' ? 'aptos_std::smart_table' : 'aptos_std::table';
        const tblModPrefix = context.mappingType === 'smart-table' ? 'smart_table' : 'table';
        context.usedModules.add(tblModPath);
        return {
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: `${tblModPrefix}::new`, args: [] } as any,
        };
      }
      if (v.type.isArray) {
        return {
          name: toSnakeCase(v.name),
          value: { kind: 'call', function: 'vector::empty', args: [] } as any,
        };
      }
      return {
        name: toSnakeCase(v.name),
        value: v.initialValue ?
          transformIRExpressionToMove(v.initialValue) :
          getDefaultValue(v.type, context),
      };
    });

  // Add extend_ref field to the struct initialization
  stateFields.push({
    name: 'extend_ref',
    value: { kind: 'identifier', name: 'extend_ref' },
  });

  return {
    name: 'init_module',
    visibility: 'private',
    params: [{ name: 'deployer', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } }],
    body: [
      // let constructor_ref = object::create_named_object(deployer, b"contract_name");
      {
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
      },
      // let object_signer = object::generate_signer(&constructor_ref);
      {
        kind: 'let',
        pattern: 'object_signer',
        value: {
          kind: 'call',
          function: 'object::generate_signer',
          args: [
            { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'constructor_ref' } },
          ],
        },
      },
      // let extend_ref = object::generate_extend_ref(&constructor_ref);
      {
        kind: 'let',
        pattern: 'extend_ref',
        value: {
          kind: 'call',
          function: 'object::generate_extend_ref',
          args: [
            { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'constructor_ref' } },
          ],
        },
      },
      // move_to(&object_signer, State { ..., extend_ref })
      {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'move_to',
          args: [
            { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'object_signer' } },
            {
              kind: 'struct',
              name: stateName,
              fields: stateFields,
            },
          ],
        },
      },
    ],
  };
}

/**
 * Generate upgrade_module entry function for resource-account upgradeability.
 * Uses stored SignerCapability to create resource signer, then calls
 * code::publish_package_txn to upgrade the module code.
 *
 * Only generated when upgradeability === 'resource-account' AND
 * constructorPattern === 'resource-account' (signer_cap field must exist).
 */
function generateUpgradeFunction(
  contractName: string,
  context: TranspileContext
): MoveFunction {
  const stateName = `${contractName}State`;

  context.usedModules.add('aptos_framework::code');
  context.usedModules.add('aptos_framework::account');
  context.usedModules.add('std::signer');

  // For resource-account pattern, state is at @module_address
  const borrowAddress: MoveExpression = { kind: 'literal', type: 'address', value: `@${context.moduleAddress}` };

  const sName = signerName(context);
  return {
    name: 'upgrade_module',
    visibility: 'public',
    isEntry: true,
    params: [
      { name: sName, type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } },
      { name: 'metadata_serialized', type: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } } },
      { name: 'code', type: { kind: 'vector', elementType: { kind: 'vector', elementType: { kind: 'primitive', name: 'u8' } } } },
    ],
    body: [
      // assert!(signer::address_of(account) == @module_address, E_UNAUTHORIZED);
      {
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
                args: [{ kind: 'identifier', name: sName }],
              },
              right: { kind: 'literal', type: 'address', value: `@${context.moduleAddress}` },
            },
            wrapErrorCode('E_UNAUTHORIZED', context),
          ],
        },
      },
      // let state = borrow_global<State>(@module_address);
      {
        kind: 'let',
        pattern: 'state',
        value: {
          kind: 'call',
          function: 'borrow_global',
          typeArgs: [{ kind: 'struct', name: stateName }],
          args: [borrowAddress],
        },
      },
      // let resource_signer = account::create_signer_with_capability(&state.signer_cap);
      {
        kind: 'let',
        pattern: 'resource_signer',
        value: {
          kind: 'call',
          function: 'account::create_signer_with_capability',
          args: [{
            kind: 'borrow',
            mutable: false,
            value: {
              kind: 'field_access',
              object: { kind: 'identifier', name: 'state' },
              field: 'signer_cap',
            },
          }],
        },
      },
      // code::publish_package_txn(&resource_signer, metadata_serialized, code);
      {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: 'code::publish_package_txn',
          args: [
            { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'resource_signer' } },
            { kind: 'identifier', name: 'metadata_serialized' },
            { kind: 'identifier', name: 'code' },
          ],
        },
      },
    ],
    acquires: [stateName],
  };
}

/**
 * Walk a MoveExpression tree and collect all identifier names matching the E_* pattern.
 * This supports filtering error constants to only those actually referenced in code.
 */
function walkExprForErrors(expr: any, refs: Set<string>): void {
  if (!expr) return;
  if (expr.kind === 'identifier' && typeof expr.name === 'string' && expr.name.startsWith('E_')) {
    refs.add(expr.name);
  }
  // Recurse into all object properties to catch every expression variant
  for (const key of Object.keys(expr)) {
    if (key === 'inferredType' || key === 'kind') continue;
    const val = expr[key];
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            if (item.kind) {
              walkExprForErrors(item, refs);
            } else {
              // Handle struct field entries: { name, value }
              walkExprForErrors(item, refs);
            }
          }
        }
      } else if (val.kind) {
        walkExprForErrors(val, refs);
      }
    }
  }
}

/**
 * Walk a MoveStatement tree and collect all E_* identifier references.
 */
function walkStmtForErrors(stmt: any, refs: Set<string>): void {
  if (!stmt) return;
  switch (stmt.kind) {
    case 'let':
      walkExprForErrors(stmt.value, refs);
      break;
    case 'assign':
      walkExprForErrors(stmt.target, refs);
      walkExprForErrors(stmt.value, refs);
      break;
    case 'if':
      walkExprForErrors(stmt.condition, refs);
      if (stmt.thenBlock) {
        for (const s of stmt.thenBlock) walkStmtForErrors(s, refs);
      }
      if (stmt.elseBlock) {
        for (const s of stmt.elseBlock) walkStmtForErrors(s, refs);
      }
      break;
    case 'while':
      walkExprForErrors(stmt.condition, refs);
      if (stmt.body) {
        for (const s of stmt.body) walkStmtForErrors(s, refs);
      }
      break;
    case 'loop':
      if (stmt.body) {
        for (const s of stmt.body) walkStmtForErrors(s, refs);
      }
      break;
    case 'for':
      walkExprForErrors(stmt.iterable, refs);
      if (stmt.body) {
        for (const s of stmt.body) walkStmtForErrors(s, refs);
      }
      break;
    case 'return':
      walkExprForErrors(stmt.value, refs);
      break;
    case 'abort':
      walkExprForErrors(stmt.code, refs);
      break;
    case 'expression':
      walkExprForErrors(stmt.expression, refs);
      break;
    case 'block':
      if (stmt.statements) {
        for (const s of stmt.statements) walkStmtForErrors(s, refs);
      }
      break;
  }
}

/**
 * Scan all function bodies in a module for E_* error constant references.
 * Returns the set of error constant names that are actually used in the generated code.
 */
function collectReferencedErrorCodes(functions: MoveFunction[]): Set<string> {
  const refs = new Set<string>();
  for (const fn of functions) {
    for (const stmt of fn.body) {
      walkStmtForErrors(stmt, refs);
    }
  }
  return refs;
}

/**
 * Generate error constants
 * Based on EVM error code patterns from e2m reverse engineering
 */
function generateErrorConstants(ir: IRContract, context: TranspileContext, referencedErrors?: Set<string>): MoveConstant[] {
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

  // Add standard error codes — filter to only referenced ones when emitAllErrorConstants is false
  const shouldFilterStandard = !context.emitAllErrorConstants && referencedErrors;
  for (const error of standardErrors) {
    if (shouldFilterStandard && !referencedErrors!.has(error.name)) continue;
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
    // Pass context.constants so references to previously-defined constants can be inlined
    let value: any;
    if (variable.initialValue) {
      value = transformConstantValue(variable.initialValue, moveType, context.constants);
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
 * Transform a constant initial value to Move expression.
 * Move constants CANNOT reference other constants, so we try to evaluate
 * constant expressions at transpile time and inline literal values.
 */
function transformConstantValue(expr: any, targetType: any, constants?: Map<string, any>): any {
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
  // Move constants CANNOT reference other constants — try to inline the value
  if (expr.kind === 'identifier') {
    if (constants) {
      const constDef = constants.get(expr.name) || constants.get(toScreamingSnakeCase(expr.name));
      if (constDef?.value) {
        return constDef.value;
      }
    }
    // Fallback: keep as identifier (will produce a compiler error, but better than losing info)
    return { kind: 'identifier', name: toScreamingSnakeCase(expr.name) };
  }

  // Handle binary operations (for compile-time constant expressions)
  // Try to evaluate to a literal if both sides are literals
  if (expr.kind === 'binary') {
    const left = transformConstantValue(expr.left, targetType, constants);
    const right = transformConstantValue(expr.right, targetType, constants);

    // Try to evaluate if both sides are number literals
    const leftVal = extractBigInt(left);
    const rightVal = extractBigInt(right);
    if (leftVal !== null && rightVal !== null) {
      const result = evaluateConstOp(expr.operator, leftVal, rightVal);
      if (result !== null) {
        const suffix = getMoveTypeSuffix(targetType);
        return {
          kind: 'literal',
          type: 'number',
          value: result.toString(),
          suffix,
        };
      }
    }

    // Can't evaluate — emit as expression (may not compile if it refs other constants)
    return {
      kind: 'binary',
      operator: expr.operator,
      left,
      right,
    };
  }

  // Handle type conversions (e.g., uint8(128))
  if (expr.kind === 'type_conversion') {
    const inner = transformConstantValue(expr.expression, targetType, constants);
    const val = extractBigInt(inner);
    if (val !== null) {
      const suffix = getMoveTypeSuffix(targetType);
      return { kind: 'literal', type: 'number', value: val.toString(), suffix };
    }
    return inner;
  }

  // Handle function calls in constant context (e.g., keccak256("string"))
  if (expr.kind === 'function_call') {
    const funcName = expr.function?.name || (expr.function?.kind === 'identifier' ? expr.function.name : null);
    // keccak256 of a string literal → compute hash at transpile time
    if (funcName === 'keccak256' && expr.args?.length === 1) {
      const arg = expr.args[0];
      if (arg.kind === 'literal' && arg.type === 'string') {
        // Compute keccak256 hash of the string → u256
        // Use a deterministic hash approach: convert string to bytes, hash
        const hashValue = computeKeccak256AsU256(String(arg.value));
        const suffix = getMoveTypeSuffix(targetType);
        return { kind: 'literal', type: 'number', value: hashValue, suffix };
      }
      // For abi.encodePacked and other non-literal args, emit placeholder
      const suffix = getMoveTypeSuffix(targetType);
      return { kind: 'literal', type: 'number', value: '0', suffix };
    }
  }

  // Default: return as-is with suffix
  return expr;
}

/**
 * Compute keccak256 hash of a string and return as a u256 decimal string.
 * Uses Node.js crypto (sha3-256 is keccak256 in Ethereum context).
 * Note: Ethereum's keccak256 is slightly different from standard SHA3-256,
 * but for constant identification purposes the exact value matters less
 * than having a consistent, deterministic output.
 */
function computeKeccak256AsU256(input: string): string {
  // Ethereum uses the original Keccak-256, not NIST SHA3-256
  // Node.js doesn't have keccak natively, so we use sha3-256 as a reasonable approximation
  // The exact hash value doesn't affect correctness since this is used for constant IDs
  try {
    const hash = createHash('sha3-256').update(input).digest('hex');
    return BigInt('0x' + hash).toString();
  } catch {
    // Fallback: return 0
    return '0';
  }
}

/**
 * Extract a BigInt value from a literal expression, or null if not a number literal.
 */
function extractBigInt(expr: any): bigint | null {
  if (!expr || expr.kind !== 'literal' || expr.type !== 'number') return null;
  try {
    const value = String(expr.value);
    // Handle scientific notation (e.g., 1e18, 1E18) — BigInt doesn't support it
    const sciMatch = value.match(/^(\d+(?:\.\d+)?)[eE]\+?(\d+)$/);
    if (sciMatch) {
      const mantissa = sciMatch[1];
      const exponent = parseInt(sciMatch[2], 10);
      if (mantissa.includes('.')) {
        const [intPart, decPart] = mantissa.split('.');
        const decLen = decPart.length;
        if (exponent >= decLen) {
          return BigInt(intPart + decPart + '0'.repeat(exponent - decLen));
        }
        return BigInt(intPart + decPart.slice(0, exponent));
      }
      return BigInt(mantissa + '0'.repeat(exponent));
    }
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Evaluate a constant binary operation at transpile time.
 */
function evaluateConstOp(op: string, left: bigint, right: bigint): bigint | null {
  switch (op) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return right !== 0n ? left / right : null;
    case '%': return right !== 0n ? left % right : null;
    case '&': return left & right;
    case '|': return left | right;
    case '^': return left ^ right;
    case '<<': return left << right;
    case '>>': return left >> right;
    case '**': return left ** right;
    default: return null;
  }
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
 * Set of struct type names that lack the `copy` and `drop` abilities.
 * These are Move framework types that manage internal state/resources.
 */
const NON_COPYABLE_DROP_STRUCT_NAMES = new Set([
  'Table', 'SmartTable', 'SimpleMap', 'BigOrderedMap',
  'Aggregator', 'AggregatorSnapshot',
]);

/**
 * Compute the abilities a MoveType can carry.
 * Returns the set of abilities (`copy`, `drop`, `store`) that the type supports.
 */
function typeAbilities(ty: MoveType): Set<MoveAbility> {
  switch (ty.kind) {
    case 'primitive':
      // All primitive types (u8, u64, bool, address, signer, etc.) have full abilities
      return new Set(['copy', 'drop', 'store']);

    case 'reference':
      // References always have copy and drop, but NOT store
      return new Set(['copy', 'drop']);

    case 'generic':
      // For generics, assume all abilities (constraints are enforced at the type-parameter level)
      return new Set(['copy', 'drop', 'store']);

    case 'vector': {
      // Vector inherits abilities from its element type
      const elementAbilities = typeAbilities(ty.elementType);
      // Vectors themselves always have store if the element does; copy/drop follow the element
      return elementAbilities;
    }

    case 'struct': {
      // Check if this is a known non-copyable/non-droppable framework type
      if (NON_COPYABLE_DROP_STRUCT_NAMES.has(ty.name)) {
        return new Set(['store']);
      }
      // Also check module name for table/aggregator types that may have non-standard names
      if (ty.module && (ty.module.includes('table') || ty.module.includes('aggregator'))) {
        return new Set(['store']);
      }
      // For other struct types, conservatively assume all abilities
      // (the struct's own declaration controls its abilities; we can't introspect further here)
      return new Set(['copy', 'drop', 'store']);
    }

    default:
      return new Set(['copy', 'drop', 'store']);
  }
}

/**
 * Compute struct abilities from the intersection of field type abilities.
 * A struct can only have an ability if ALL of its field types support that ability.
 */
function computeStructAbilities(fields: MoveStructField[]): MoveAbility[] {
  const allAbilities: MoveAbility[] = ['copy', 'drop', 'store'];

  if (fields.length === 0) {
    return allAbilities;
  }

  // Intersect abilities across all fields
  const result = new Set<MoveAbility>(allAbilities);
  for (const field of fields) {
    const fieldAbilities = typeAbilities(field.type);
    for (const ability of result) {
      if (!fieldAbilities.has(ability)) {
        result.delete(ability);
      }
    }
  }

  return Array.from(result);
}

/**
 * Transform struct to Move struct
 */
function transformStruct(struct: { name: string; fields: any[] }, context: TranspileContext): MoveStruct {
  const fields: MoveStructField[] = struct.fields.map(field => ({
    name: toSnakeCase(field.name),
    type: field.type.move || { kind: 'primitive' as const, name: 'u256' },
  }));

  return {
    name: struct.name,
    abilities: computeStructAbilities(fields),
    fields,
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

function getDefaultValue(type: any, context?: TranspileContext): any {
  if (type.move?.kind === 'primitive') {
    switch (type.move.name) {
      case 'bool': return { kind: 'literal', type: 'bool', value: false };
      case 'address':
        // optionalValues='option-type': default address → option::none<address>()
        if (context?.optionalValues === 'option-type') {
          context.usedModules.add('std::option');
          return { kind: 'call', function: 'option::none', typeArgs: [{ kind: 'primitive', name: 'address' }], args: [] };
        }
        return { kind: 'call', function: '@0x0', args: [] };
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

/** Get default value for a MoveType (not IRType). Used by per-user resource generation. */
function getDefaultValueForType(moveType: any, context?: TranspileContext): any {
  if (!moveType) return { kind: 'literal', type: 'number', value: 0 };
  if (moveType.kind === 'primitive') {
    switch (moveType.name) {
      case 'bool': return { kind: 'literal', type: 'bool', value: false };
      case 'address':
        // optionalValues='option-type': default address → option::none<address>()
        if (context?.optionalValues === 'option-type') {
          context.usedModules.add('std::option');
          return { kind: 'call', function: 'option::none', typeArgs: [{ kind: 'primitive', name: 'address' }], args: [] };
        }
        return { kind: 'call', function: '@0x0', args: [] };
      default:
        if (moveType.name.startsWith('u') || moveType.name.startsWith('i')) {
          return { kind: 'literal', type: 'number', value: 0 };
        }
    }
  }
  if (moveType.kind === 'vector') {
    return { kind: 'call', function: 'vector::empty', args: [] };
  }
  return { kind: 'literal', type: 'number', value: 0 };
}

/**
 * Check if a contract uses the onlyOwner modifier on any function or defines it.
 */
function contractUsesOwnerModifier(ir: IRContract): boolean {
  return ir.functions.some(fn =>
    fn.modifiers.some(m => m.name === 'onlyOwner')
  ) || ir.modifiers.some(m => m.name === 'onlyOwner');
}

/**
 * Collect role names from onlyRole modifier usages in the contract.
 * Returns a set of role argument names (e.g., 'ADMIN_ROLE', 'MINTER_ROLE').
 */
function contractUsesRoleModifiers(ir: IRContract): Set<string> {
  const roleNames = new Set<string>();
  for (const fn of ir.functions) {
    for (const mod of fn.modifiers) {
      if (mod.name === 'onlyRole' && mod.args.length > 0) {
        const arg = mod.args[0];
        const roleName = (arg as any).value || (arg as any).name || 'ADMIN_ROLE';
        roleNames.add(String(roleName));
      }
    }
  }
  return roleNames;
}

/**
 * Convert a role name (e.g., ADMIN_ROLE, MINTER_ROLE) to a PascalCase capability struct name.
 * ADMIN_ROLE -> AdminRoleCapability
 * MINTER_ROLE -> MinterRoleCapability
 * myRole -> MyRoleCapability
 */
function roleNameToCapabilityStruct(roleName: string): string {
  // Handle SCREAMING_SNAKE_CASE (e.g., ADMIN_ROLE)
  if (/^[A-Z][A-Z0-9_]*$/.test(roleName)) {
    const parts = roleName.split('_').filter(Boolean);
    const pascal = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    return `${pascal}Capability`;
  }
  // Handle camelCase or PascalCase
  const pascal = roleName.charAt(0).toUpperCase() + roleName.slice(1);
  return `${pascal}Capability`;
}

/**
 * Generate a move_to statement that grants an OwnerCapability to the deployer.
 * Used in init_module / constructor when accessControl === 'capability'.
 */
function generateCapabilityMoveTo(signerExpr: any): MoveStatement {
  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'move_to',
      args: [
        signerExpr,
        {
          kind: 'struct',
          name: 'OwnerCapability',
          fields: [],
        },
      ],
    },
  };
}

/**
 * Convert string to snake_case
 */
function toSnakeCase(str: string): string {
  if (!str) return '';
  // Handle $ variable (EVM storage reference) — not valid in Move
  if (str === '$') return '_storage_ref';
  if (str.includes('$')) str = str.replace(/\$/g, '_');
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
