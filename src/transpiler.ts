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

/**
 * Transpile Solidity source code to Move
 */
export function transpile(
  source: string,
  options: TranspileOptions = {}
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
  } = options;

  const output: TranspileOutput = {
    success: true,
    modules: [],
    errors: [],
    warnings: [],
  };

  // Track if any module uses Digital Assets (for Move.toml dependencies)
  let usesTokenObjects = false;

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

  // Build IR for all contracts first (needed for inheritance flattening)
  const allContractsIR = new Map<string, ReturnType<typeof contractToIR>>();
  for (const contract of contracts) {
    if (contract.kind === 'interface') continue;
    try {
      allContractsIR.set(contract.name, contractToIR(contract));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.warnings.push(`Could not parse ${contract.name} for inheritance: ${message}`);
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
    // Skip interfaces for now (they don't generate modules)
    if (contract.kind === 'interface') {
      output.warnings.push(`Skipping interface: ${contract.name}`);
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
      const result = irToMoveModule(ir, moduleAddress, allContractsIR, { optimizationLevel });

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

        // Add warnings
        output.warnings.push(...result.warnings.map(w => w.message));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.errors.push(`Error transpiling ${contract.name}: ${message}`);
      output.success = false;
    }
  }

  // Generate Move.toml if requested
  if (generateToml && output.modules.length > 0) {
    output.moveToml = generateMoveToml(packageName, moduleAddress, {
      includeTokenObjects: usesTokenObjects,
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
  const parseResult = parseSolidity(source);

  if (!parseResult.success || !parseResult.ast) {
    return {
      success: false,
      modules: [],
      errors: parseResult.errors.map(e => e.message),
      warnings: [],
    };
  }

  const contracts = extractContracts(parseResult.ast);
  const contract = contracts.find(c => c.name === contractName);

  if (!contract) {
    return {
      success: false,
      modules: [],
      errors: [`Contract '${contractName}' not found`],
      warnings: [],
    };
  }

  // Create a new source with just this contract
  // For now, we'll just use the full source and filter
  const output = transpile(source, options);

  return {
    ...output,
    modules: output.modules.filter(m =>
      m.name === contractName.toLowerCase() ||
      m.name === toSnakeCase(contractName)
    ),
  };
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
  if (/^[A-Z][A-Z0-9_]*$/.test(str)) {
    return str.toLowerCase();
  }
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}
