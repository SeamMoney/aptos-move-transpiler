/**
 * Main Transpiler
 * Orchestrates the Solidity to Move transpilation process
 */

import { parseSolidity, extractContracts } from './parser/solidity-parser.js';
import { contractToIR, irToMoveModule } from './transformer/contract-transformer.js';
import { generateMoveCode, generateMoveToml } from './codegen/move-generator.js';
import { generateFungibleAssetModule, isERC20Contract, extractERC20Config } from './codegen/fungible-asset-generator.js';
import { generateDigitalAssetModule, isERC721Contract, extractERC721Config } from './codegen/digital-asset-generator.js';
import { formatMoveCode, isFormatterAvailable } from './formatter/move-formatter.js';
import type { FormatOptions } from './formatter/move-formatter.js';
import { generateSpecs } from './codegen/spec-generator.js';
import { setStringTypeConfig, setMappingTypeConfig } from './mapper/type-mapper.js';
import type { TranspileResult } from './types/ir.js';
import type { MoveModule } from './types/move-ast.js';

export interface TranspileOptions {
  /** Module address for the generated Move code */
  moduleAddress?: string;
  /** Generate Move.toml file */
  generateToml?: boolean;
  /** Package name for Move.toml */
  packageName?: string;
  /** Use Fungible Asset standard for ERC-20 tokens */
  useFungibleAsset?: boolean;
  /** Use Digital Asset standard for ERC-721 tokens */
  useDigitalAsset?: boolean;
  /** Additional Solidity sources for cross-file context (imports, libraries).
   *  These are parsed for reference but don't generate output modules. */
  contextSources?: string[];
  /** Post-process generated Move code with `aptos move fmt`.
   *  Requires the Aptos CLI to be installed. Falls back gracefully if unavailable. */
  format?: boolean;
  /** Options for the Move code formatter (only used when format=true). */
  formatOptions?: FormatOptions;
  /** Generate Move Specification Language (MSL) spec blocks alongside code.
   *  Specs include aborts_if conditions from require(), modifies declarations,
   *  and resource existence checks. */
  generateSpecs?: boolean;
  /** Parallelization optimization level.
   *  - 'low' (default): Single resource struct, current behavior.
   *  - 'medium': Split state into resource groups by access pattern, Aggregators for counters.
   *  - 'high': Everything in medium + per-user resources for address-keyed mappings. */
  optimizationLevel?: 'low' | 'medium' | 'high';

  // ── Tier 1 Transpilation Flags ──

  /** Strict mode: emit errors instead of stubs/warnings for unsupported Solidity patterns.
   *  When false (default), unsupported patterns produce placeholder code and warnings.
   *  When true, unsupported patterns cause transpilation to fail with errors. */
  strictMode?: boolean;

  /** Reentrancy guard pattern for nonReentrant modifiers.
   *  - 'mutex' (default): State field reentrancy_status with assert! check.
   *  - 'none': Strip reentrancy guards entirely (Move's ownership model prevents reentrancy). */
  reentrancyPattern?: 'mutex' | 'none';

  /** How to represent Solidity `string` type in Move.
   *  - 'string' (default): Use std::string::String with utf8() encoding.
   *  - 'bytes': Use vector<u8> for raw byte representation. */
  stringType?: 'string' | 'bytes';

  /** Mark small internal helper functions as `inline` in generated Move.
   *  Inline functions are expanded at call sites, reducing function call overhead.
   *  Only applies to private functions with simple bodies (no state access, ≤5 statements). */
  useInlineFunctions?: boolean;

  /** Include original Solidity source references as comments in generated Move code.
   *  Adds `// Solidity: <function_name>` headers and `// line <N>` annotations. */
  emitSourceComments?: boolean;

  /** How to handle Solidity view/pure function annotations.
   *  - 'annotate' (default): Emit #[view] attribute on view functions that read state.
   *  - 'skip': Omit #[view] annotations (useful for older Move compiler versions). */
  viewFunctionBehavior?: 'annotate' | 'skip';

  /** How to translate Solidity require/revert error messages.
   *  - 'abort-codes' (default): Map error messages to named u64 abort code constants.
   *  - 'abort-verbose': Include original error message as inline comment next to abort. */
  errorStyle?: 'abort-codes' | 'abort-verbose';

  // ── Tier 2 Transpilation Flags ──

  /** How to represent Solidity enums in Move.
   *  - 'native-enum' (default): Use Move 2.0 native `enum` declarations.
   *  - 'u8-constants': Use `const VARIANT: u8 = N` pattern (wider tooling compatibility). */
  enumStyle?: 'native-enum' | 'u8-constants';

  /** State storage and initialization pattern.
   *  - 'resource-account' (default): Create resource account in init_module, store state there.
   *  - 'deployer-direct': Store state directly at deployer address (simpler, no resource account).
   *  - 'named-object': Use Aptos Object model with named objects for state storage. */
  constructorPattern?: 'resource-account' | 'deployer-direct' | 'named-object';

  /** How to map Solidity `internal` visibility to Move.
   *  - 'public-package' (default): Use `public(package)` (Move 2.0+, recommended).
   *  - 'public-friend': Use `public(friend)` (explicit friend declarations).
   *  - 'private': Make internal functions fully private. */
  internalVisibility?: 'public-package' | 'public-friend' | 'private';

  /** Arithmetic overflow behavior.
   *  - 'abort' (default): Move native behavior — abort on overflow/underflow.
   *  - 'wrapping': Use wrapping arithmetic (matches Solidity unchecked blocks). */
  overflowBehavior?: 'abort' | 'wrapping';

  // ── Tier 3 Transpilation Flags ──

  /** Mapping data structure in generated Move.
   *  - 'table' (default): Use aptos_std::table::Table<K,V>. Suitable for small/medium maps.
   *  - 'smart-table': Use aptos_std::smart_table::SmartTable<K,V>. Auto-splits buckets
   *    for better parallelism on large datasets. */
  mappingType?: 'table' | 'smart-table';

  /** Access control pattern for modifier translation (onlyOwner, onlyRole, etc.).
   *  - 'inline-assert' (default): Inline assert! checks comparing signer address to owner.
   *  - 'capability': Use Move capability pattern with typed marker structs (OwnerCap, RoleCap).
   *    More idiomatic Move; enables delegation and composable permissions. */
  accessControl?: 'inline-assert' | 'capability';

  /** Module upgradeability support.
   *  - 'immutable' (default): No upgrade infrastructure. Module is frozen after publish.
   *  - 'resource-account': Store SignerCapability; generate upgrade_module() that calls
   *    code::publish_package_txn. Only effective with constructorPattern='resource-account'. */
  upgradeability?: 'immutable' | 'resource-account';

  /** How to represent nullable/optional values.
   *  - 'sentinel' (default): Use sentinel values (0, @0x0, empty vector) for "not set".
   *  - 'option-type': Use std::option::Option<T> for nullable address/struct fields. */
  optionalValues?: 'sentinel' | 'option-type';

  /** Function call syntax style in generated Move code.
   *  - 'module-qualified' (default): vector::length(&v), table::borrow(&t, key).
   *  - 'receiver' (Move 2.2+): v.length(), t.borrow(key). More readable, requires Move 2.2+. */
  callStyle?: 'module-qualified' | 'receiver';

  // ── Tier 4 Transpilation Flags ──

  /** Event emission pattern.
   *  - 'native' (default): #[event] struct + event::emit() (Move 2.0+, recommended).
   *  - 'event-handle': Legacy EventHandle<T> stored in state with emit_event().
   *  - 'none': Strip all event emissions (useful for gas optimization or testing). */
  eventPattern?: 'native' | 'event-handle' | 'none';

  /** Signer parameter name convention.
   *  - 'account' (default): Use `account: &signer` as the parameter name.
   *  - 'signer': Use `signer: &signer` (common in Aptos framework code). */
  signerParamName?: 'account' | 'signer';

  /** Whether to emit all boilerplate error constants or only referenced ones.
   *  - true (default): Emit all 19 standard E_* error constants for every module.
   *  - false: Only emit error constants that appear in generated function bodies. */
  emitAllErrorConstants?: boolean;

  /** Error code encoding style.
   *  - 'u64' (default): Raw `const E_UNAUTHORIZED: u64 = 2` abort code constants.
   *  - 'aptos-error-module': Use `error::permission_denied(REASON)` from std::error module.
   *    Encodes category + reason per Aptos framework convention. */
  errorCodeType?: 'u64' | 'aptos-error-module';

  /** Use index notation (Move 2.0+) for vector/resource access.
   *  - false (default): vector::borrow(&v, i), borrow_global<T>(addr).
   *  - true: v[i], Resource[addr]. More concise but requires Move 2.0+ tooling. */
  indexNotation?: boolean;

  /** Acquires annotation style for functions accessing global storage.
   *  - 'explicit' (default): Emit `acquires ResourceType` annotations on all functions.
   *  - 'inferred': Omit acquires annotations (Move 2.2+ compiler infers them). */
  acquiresStyle?: 'explicit' | 'inferred';
}

export interface TranspileOutput {
  success: boolean;
  modules: {
    name: string;
    code: string;
    ast: MoveModule;
  }[];
  moveToml?: string;
  errors: string[];
  warnings: string[];
}

const EVM_COMPAT_MODULE_NAME = 'evm_compat';
const EVM_COMPAT_USE_PATH = 'transpiler::evm_compat';

// Embedded helper module so published builds don't depend on source-file reads.
const EVM_COMPAT_MODULE_SOURCE = `module transpiler::evm_compat {
    use std::vector;
    use aptos_std::bcs;
    use aptos_std::from_bcs;

    public fun address_to_u256(addr: address): u256 {
        let bytes = bcs::to_bytes(&addr);
        bytes_to_u256(bytes)
    }

    public fun bytes_to_u256(bytes: vector<u8>): u256 {
        let len = vector::length(&bytes);
        let value: u256 = 0;
        let i = 0;
        while (i < len && i < 32) {
            value = (value << 8) | (*vector::borrow(&bytes, i) as u256);
            i = i + 1;
        };
        value
    }

    public fun to_address(value: u256): address {
        let bytes = bcs::to_bytes(&value);
        let addr_bytes = vector::empty<u8>();
        let len = vector::length(&bytes);
        let start = if (len > 32) { len - 32 } else { 0 };
        let i = start;
        while (i < len) {
            vector::push_back(&mut addr_bytes, *vector::borrow(&bytes, i));
            i = i + 1;
        };
        while (vector::length(&addr_bytes) < 32) {
            vector::push_back(&mut addr_bytes, 0u8);
        };
        from_bcs::to_address(addr_bytes)
    }
}
`;

function moduleUsesEvmCompat(module: MoveModule): boolean {
  return module.uses.some(use => use.module === EVM_COMPAT_USE_PATH);
}

/**
 * Transpile Solidity source code to Move
 */
export function transpile(
  source: string,
  options: TranspileOptions = {}
): TranspileOutput {
  return transpileInternal(source, options);
}

function transpileInternal(
  source: string,
  options: TranspileOptions,
  targetContractName?: string
): TranspileOutput {
  const {
    moduleAddress = '0x1',
    generateToml = true,
    packageName = 'transpiled',
    useFungibleAsset = false,
    useDigitalAsset = false,
    contextSources = [],
    format = false,
    formatOptions = {},
    generateSpecs: shouldGenerateSpecs = false,
    optimizationLevel = 'low',
    strictMode = false,
    reentrancyPattern = 'mutex',
    stringType = 'string',
    useInlineFunctions = false,
    emitSourceComments = false,
    viewFunctionBehavior = 'annotate',
    errorStyle = 'abort-codes',
    enumStyle = 'native-enum',
    constructorPattern = 'resource-account',
    internalVisibility = 'public-package',
    overflowBehavior = 'abort',
    mappingType = 'table',
    accessControl = 'inline-assert',
    upgradeability = 'immutable',
    optionalValues = 'sentinel',
    callStyle = 'module-qualified',
    eventPattern = 'native',
    signerParamName = 'account',
    emitAllErrorConstants = true,
    errorCodeType = 'u64',
    indexNotation = false,
    acquiresStyle = 'explicit',
  } = options;

  // Configure module-level type mapper for string and mapping representation
  setStringTypeConfig(stringType);
  setMappingTypeConfig(mappingType);

  const output: TranspileOutput = {
    success: true,
    modules: [],
    errors: [],
    warnings: [],
  };

  // Track if any module uses Digital Assets (for Move.toml dependencies)
  let usesTokenObjects = false;
  // Track if any generated module references transpiler::evm_compat helpers.
  let usesEvmCompat = false;

  // Parse Solidity
  const parseResult = parseSolidity(source);

  if (!parseResult.success || !parseResult.ast) {
    output.success = false;
    output.errors = parseResult.errors.map(e =>
      `Parse error at line ${e.line || '?'}: ${e.message}`
    );
    return output;
  }

  // Extract contracts
  const contracts = extractContracts(parseResult.ast);

  if (contracts.length === 0) {
    output.success = false;
    output.errors.push('No contracts found in source file');
    return output;
  }

  if (targetContractName) {
    const targetContract = contracts.find(
      c => c.name === targetContractName && c.kind !== 'interface'
    );
    if (!targetContract) {
      output.success = false;
      output.errors.push(`Contract '${targetContractName}' not found`);
      return output;
    }
  }

  // Build IR for all contracts first (needed for inheritance flattening)
  const allContractsIR = new Map<string, ReturnType<typeof contractToIR>>();
  for (const contract of contracts) {
    if (contract.kind === 'interface') continue;
    try {
      allContractsIR.set(contract.name, contractToIR(contract));
    } catch (error) {
      if (!targetContractName || contract.name === targetContractName) {
        const message = error instanceof Error ? error.message : String(error);
        output.warnings.push(`Could not parse ${contract.name} for inheritance: ${message}`);
      }
    }
  }

  // Parse context sources for cross-file references (libraries, constants, etc.)
  for (const ctxSource of contextSources) {
    try {
      const ctxParse = parseSolidity(ctxSource);
      if (ctxParse.success && ctxParse.ast) {
        const ctxContracts = extractContracts(ctxParse.ast);
        for (const ctxContract of ctxContracts) {
          if (ctxContract.kind === 'interface') continue;
          if (!allContractsIR.has(ctxContract.name)) {
            allContractsIR.set(ctxContract.name, contractToIR(ctxContract));
          }
        }
      }
    } catch {
      // Context sources are best-effort — skip on failure
    }
  }

  // Transpile each contract
  for (const contract of contracts) {
    if (targetContractName && contract.name !== targetContractName) {
      continue;
    }

    // Skip interfaces for now (they don't generate modules)
    if (contract.kind === 'interface') {
      if (!targetContractName) {
        output.warnings.push(`Skipping interface: ${contract.name}`);
      }
      continue;
    }

    try {
      // Convert to IR first to analyze the contract
      const ir = contractToIR(contract);

      // Check if we should use Fungible Asset for ERC-20
      if (useFungibleAsset && isERC20Contract(ir.functions, ir.stateVariables)) {
        output.warnings.push(`Using Fungible Asset standard for ${contract.name}`);

        const faConfig = extractERC20Config(
          contract.name,
          moduleAddress,
          ir.stateVariables,
          ir.functions
        );

        let code = generateFungibleAssetModule(faConfig);
        const moduleName = toSnakeCase(contract.name);

        if (format) {
          const fmtResult = formatMoveCode(code, formatOptions);
          if (fmtResult.formatted) code = fmtResult.code;
        }

        output.modules.push({
          name: moduleName,
          code,
          ast: {} as MoveModule, // Simplified - FA doesn't use the standard AST
        });

        continue;
      }

      // Check if we should use Digital Asset for ERC-721
      if (useDigitalAsset && isERC721Contract(ir.functions, ir.stateVariables)) {
        output.warnings.push(`Using Digital Asset standard for ${contract.name}`);

        const daConfig = extractERC721Config(
          contract.name,
          moduleAddress,
          ir.stateVariables,
          ir.functions
        );

        let code = generateDigitalAssetModule(daConfig);
        const moduleName = toSnakeCase(contract.name);

        if (format) {
          const fmtResult = formatMoveCode(code, formatOptions);
          if (fmtResult.formatted) code = fmtResult.code;
        }

        output.modules.push({
          name: moduleName,
          code,
          ast: {} as MoveModule, // Simplified - DA doesn't use the standard AST
        });

        usesTokenObjects = true;
        continue;
      }

      // Convert IR to Move module (standard transpilation)
      // Pass all contracts for inheritance flattening
      const result = irToMoveModule(ir, moduleAddress, allContractsIR, {
        optimizationLevel,
        strictMode,
        reentrancyPattern,
        stringType,
        useInlineFunctions,
        emitSourceComments,
        viewFunctionBehavior,
        errorStyle,
        enumStyle,
        constructorPattern,
        internalVisibility,
        overflowBehavior,
        mappingType,
        accessControl,
        upgradeability,
        optionalValues,
        callStyle,
        eventPattern,
        signerParamName,
        emitAllErrorConstants,
        errorCodeType,
        indexNotation,
        acquiresStyle,
      });

      if (!result.success) {
        output.errors.push(...result.errors.map(e => e.message));
        output.success = false;
        continue;
      }

      if (result.module) {
        // Generate MSL specs if requested
        if (shouldGenerateSpecs) {
          generateSpecs(result.module);
        }

        // Generate Move code (includes spec blocks if they were generated)
        let code = generateMoveCode(result.module);

        // Post-process with movefmt if requested
        if (format) {
          const fmtResult = formatMoveCode(code, formatOptions);
          if (fmtResult.formatted) code = fmtResult.code;
        }

        output.modules.push({
          name: result.module.name,
          code,
          ast: result.module,
        });

        usesEvmCompat = usesEvmCompat || moduleUsesEvmCompat(result.module);

        // Add warnings
        output.warnings.push(...result.warnings.map(w => w.message));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.errors.push(`Error transpiling ${contract.name}: ${message}`);
      output.success = false;
    }
  }

  if (usesEvmCompat) {
    const helperNameCollision = output.modules.some(
      module => module.name === EVM_COMPAT_MODULE_NAME
    );
    if (helperNameCollision) {
      output.errors.push(
        "Helper module name conflict: generated source includes a module named 'evm_compat', " +
        "which collides with required transpiler helper 'transpiler::evm_compat'. " +
        "Rename the Solidity contract/module or avoid address/u256 conversion helpers."
      );
      output.success = false;
    } else {
      let helperCode = EVM_COMPAT_MODULE_SOURCE;
      if (format) {
        const fmtResult = formatMoveCode(helperCode, formatOptions);
        if (fmtResult.formatted) helperCode = fmtResult.code;
      }
      output.modules.push({
        name: EVM_COMPAT_MODULE_NAME,
        code: helperCode,
        ast: {} as MoveModule,
      });
    }
  }

  // Generate Move.toml if requested
  if (generateToml && output.modules.length > 0) {
    output.moveToml = generateMoveToml(packageName, moduleAddress, {
      includeTokenObjects: usesTokenObjects,
      includeEvmCompat: usesEvmCompat,
    });
  }

  return output;
}

/**
 * Transpile a single contract by name
 */
export function transpileContract(
  source: string,
  contractName: string,
  options: TranspileOptions = {}
): TranspileOutput {
  return transpileInternal(source, options, contractName);
}

/**
 * Validate Solidity source without transpiling
 */
export function validate(source: string): {
  valid: boolean;
  contracts: string[];
  errors: string[];
} {
  const parseResult = parseSolidity(source);

  if (!parseResult.success) {
    return {
      valid: false,
      contracts: [],
      errors: parseResult.errors.map(e => e.message),
    };
  }

  const contracts = extractContracts(parseResult.ast!);

  return {
    valid: true,
    contracts: contracts.map(c => c.name),
    errors: [],
  };
}

/**
 * Get information about a Solidity file
 */
export function analyze(source: string): {
  valid: boolean;
  contracts: {
    name: string;
    kind: string;
    functions: string[];
    events: string[];
    stateVariables: string[];
  }[];
  errors: string[];
} {
  const parseResult = parseSolidity(source);

  if (!parseResult.success) {
    return {
      valid: false,
      contracts: [],
      errors: parseResult.errors.map(e => e.message),
    };
  }

  const contracts = extractContracts(parseResult.ast!);

  return {
    valid: true,
    contracts: contracts.map(c => ({
      name: c.name,
      kind: c.kind,
      functions: c.subNodes
        .filter((n: any) => n.type === 'FunctionDefinition' && n.name)
        .map((n: any) => n.name),
      events: c.subNodes
        .filter((n: any) => n.type === 'EventDefinition')
        .map((n: any) => n.name),
      stateVariables: c.subNodes
        .filter((n: any) => n.type === 'StateVariableDeclaration')
        .flatMap((n: any) => n.variables.map((v: any) => v.name)),
    })),
    errors: [],
  };
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
