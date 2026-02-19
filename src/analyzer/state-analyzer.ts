/**
 * State Variable Analyzer for Parallelization Optimization
 *
 * Analyzes a contract's IR to classify each state variable by its access
 * pattern, group variables into separate Move resource structs, and build
 * per-function access profiles. This enables the transformer to generate
 * multiple resources instead of a single monolithic struct, letting
 * Aptos Block-STM parallelize non-conflicting transactions.
 *
 * Five-phase algorithm:
 * 1. Identify admin modifiers (onlyOwner, etc.)
 * 2. Walk function bodies to build per-variable access records
 * 3. Classify each variable (admin_config, aggregatable, user_keyed_mapping, general)
 * 4. Group variables into resource structs
 * 5. Build per-function access profiles
 */

import type {
  IRContract,
  IRConstructor,
  IRFunction,
  IRModifier,
  IRModifierInvocation,
  IRStatement,
  IRExpression,
  IRStateVariable,
  IRType,
} from '../types/ir.js';

import type {
  StateVariableCategory,
  StateVariableAnalysis,
  VariableAccessRecord,
  ResourceGroup,
  FunctionAccessProfile,
  ContractAccessProfile,
  ResourcePlan,
  PerUserResourceConfig,
} from '../types/optimization.js';

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Analyze a contract's state variables for parallelization optimization.
 * Returns a ContractAccessProfile with variable classifications,
 * resource groups, and per-function access profiles.
 */
export function analyzeContract(contract: IRContract): ContractAccessProfile {
  const stateVars = contract.stateVariables.filter(v => v.mutability !== 'constant');
  if (stateVars.length === 0) {
    return emptyProfile(contract.name);
  }

  // Phase 1: Identify admin modifiers
  const adminModifiers = identifyAdminModifiers(contract);

  // Phase 2: Walk function bodies to build access records
  const accessRecords = buildAccessRecords(contract, adminModifiers);

  // Phase 2b: Propagate internal call access records
  propagateInternalCalls(contract, accessRecords);

  // Phase 3: Classify each variable
  const analyses = new Map<string, StateVariableAnalysis>();
  for (const v of stateVars) {
    const varAccess = accessRecords.get(v.name) || new Map();
    const analysis = classifyVariable(v, varAccess, contract.functions);
    analyses.set(v.name, analysis);
  }

  // Phase 4: Group into resources
  const resourceGroups = groupIntoResources(analyses, contract.name);

  // Phase 5: Build per-function access profiles
  const functionProfiles = buildFunctionProfiles(
    analyses, resourceGroups, contract
  );

  // Compute parallelization score
  const parallelizationScore = computeParallelizationScore(
    analyses, resourceGroups, functionProfiles
  );

  // Generate recommendations
  const recommendations = generateRecommendations(analyses, resourceGroups);

  return {
    contractName: contract.name,
    variableAnalyses: analyses,
    resourceGroups,
    functionProfiles,
    adminModifiers,
    parallelizationScore,
    recommendations,
  };
}

/**
 * Build a ResourcePlan from a ContractAccessProfile.
 * The ResourcePlan is the operational structure consumed by transformers.
 */
export function buildResourcePlan(
  profile: ContractAccessProfile,
  optimizationLevel: 'low' | 'medium' | 'high' = 'medium'
): ResourcePlan {
  const varToGroup = new Map<string, string>();

  // Identify event-trackable variables and exclude them from resource groups
  const eventTrackables = new Map<string, { eventName: string; fieldType: any }>();
  for (const [varName, analysis] of profile.variableAnalyses) {
    if (analysis.category === 'event_trackable') {
      // Generate event name: "FeeAccumulated" for "accumulatedFees", etc.
      const pascalName = varName.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
      const eventName = `${pascalName}Updated`;
      eventTrackables.set(varName, {
        eventName,
        fieldType: analysis.variable.type?.move || { kind: 'primitive', name: 'u256' },
      });
    }
  }

  // Remove event-trackable vars from resource groups
  for (const group of profile.resourceGroups) {
    group.variables = group.variables.filter(va => va.category !== 'event_trackable');
  }
  // Remove empty groups (but keep primary)
  profile.resourceGroups = profile.resourceGroups.filter(g => g.isPrimary || g.variables.length > 0);

  for (const group of profile.resourceGroups) {
    for (const va of group.variables) {
      varToGroup.set(va.variable.name, group.name);
    }
  }

  // Compute snapshot-eligible functions: any function that both reads AND writes
  // aggregatable variables. Snapshot reads avoid sequential dependencies with writes.
  const snapshotEligibleFunctions = new Set<string>();
  const aggregatableVars = [...profile.variableAnalyses.values()]
    .filter(a => a.category === 'aggregatable');
  if (aggregatableVars.length > 0) {
    // Collect all functions that write any aggregatable var
    const aggWriterFunctions = new Set<string>();
    for (const a of aggregatableVars) {
      for (const writer of a.writers) aggWriterFunctions.add(writer);
    }
    // A function is snapshot-eligible if it writes aggregatable vars AND reads any aggregatable var
    for (const a of aggregatableVars) {
      for (const reader of a.readers) {
        if (aggWriterFunctions.has(reader)) {
          snapshotEligibleFunctions.add(reader);
        }
      }
    }
  }

  // Per-user resources (high optimization only): user_keyed_mapping variables
  // where ALL non-view writes use msg.sender as key are stored at each user's address.
  let perUserResources: PerUserResourceConfig | undefined;
  if (optimizationLevel === 'high') {
    const eligibleVars: Array<{ varName: string; analysis: StateVariableAnalysis }> = [];

    for (const [varName, analysis] of profile.variableAnalyses) {
      if (analysis.category !== 'user_keyed_mapping') continue;

      // Check that ALL non-view write accesses use msg.sender as key
      let allWritesMsgSender = true;
      for (const [fnName, record] of analysis.accessByFunction) {
        if (!record.writes) continue;
        // Skip view/pure functions (they don't create contention)
        const fn = profile.functionProfiles.get(fnName);
        if (fn && profile.functionProfiles.get(fnName)) {
          // We can't check stateMutability from profile — check if function has no write resources
          // Instead, check the mapping key patterns: writes must use msg_sender only
        }
        if (record.writes && record.mappingKeyPatterns.size > 0) {
          const hasNonSenderKey = record.mappingKeyPatterns.has('parameter') ||
            record.mappingKeyPatterns.has('literal') ||
            record.mappingKeyPatterns.has('computed');
          if (hasNonSenderKey) {
            allWritesMsgSender = false;
            break;
          }
        }
      }

      if (allWritesMsgSender) {
        eligibleVars.push({ varName, analysis });
      }
    }

    if (eligibleVars.length > 0) {
      const fields = eligibleVars.map(({ varName, analysis }) => {
        // For mapping(address => T), extract the value type T
        const moveType = analysis.variable.type?.move;
        const valueType = (moveType?.kind === 'struct' && moveType.typeArgs?.[1]) ||
          analysis.variable.mappingValueType?.move ||
          { kind: 'primitive' as const, name: 'u256' };
        // Field name: strip "balances" → "balance", or use as-is
        let fieldName = varName.replace(/s$/, '');
        fieldName = fieldName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase().replace(/^_/, '');
        return { varName, fieldName, type: valueType };
      });

      perUserResources = {
        structName: `${profile.contractName}UserState`,
        fields,
      };

      // Remove eligible vars from their central resource groups
      const eligibleNames = new Set(eligibleVars.map(v => v.varName));
      for (const group of profile.resourceGroups) {
        group.variables = group.variables.filter(va => !eligibleNames.has(va.variable.name));
      }
      profile.resourceGroups = profile.resourceGroups.filter(g => g.isPrimary || g.variables.length > 0);

      // Remove from varToGroup (per-user vars aren't in central groups)
      for (const name of eligibleNames) {
        varToGroup.delete(name);
      }

      // Clean up function profiles: remove references to groups that no longer exist
      const remainingGroupNames = new Set(profile.resourceGroups.map(g => g.name));
      for (const [fnName, fnProfile] of profile.functionProfiles) {
        for (const rName of fnProfile.readsResources) {
          if (!remainingGroupNames.has(rName)) fnProfile.readsResources.delete(rName);
        }
        for (const wName of fnProfile.writesResources) {
          if (!remainingGroupNames.has(wName)) fnProfile.writesResources.delete(wName);
        }
        fnProfile.acquires = fnProfile.acquires.filter(a => remainingGroupNames.has(a));
      }
    }
  }

  return {
    groups: profile.resourceGroups,
    varToGroup,
    functionProfiles: profile.functionProfiles,
    snapshotEligibleFunctions,
    eventTrackables,
    perUserResources,
  };
}

// ─── Phase 1: Identify Admin Modifiers ───────────────────────────────

function identifyAdminModifiers(contract: IRContract): Set<string> {
  const adminMods = new Set<string>();

  for (const mod of contract.modifiers) {
    // Well-known admin modifier names
    if (/^only/i.test(mod.name)) {
      adminMods.add(mod.name);
      continue;
    }

    // Pattern-match modifier body for msg.sender == stateVar checks
    if (modifierBodyChecksOwnership(mod.body, contract.stateVariables)) {
      adminMods.add(mod.name);
    }
  }

  return adminMods;
}

/**
 * Check if a modifier body contains an ownership check pattern:
 * require(msg.sender == owner) or similar.
 */
function modifierBodyChecksOwnership(
  body: IRStatement[],
  stateVars: IRStateVariable[]
): boolean {
  const stateVarNames = new Set(stateVars.map(v => v.name));

  for (const stmt of body) {
    if (stmt.kind === 'require' && isOwnershipCheck(stmt.condition, stateVarNames)) {
      return true;
    }
    // if (msg.sender != owner) revert pattern
    if (stmt.kind === 'if' && isOwnershipCheck(stmt.condition, stateVarNames)) {
      return true;
    }
    // Recurse into blocks
    if (stmt.kind === 'block') {
      if (modifierBodyChecksOwnership(stmt.statements, stateVars)) return true;
    }
  }
  return false;
}

function isOwnershipCheck(expr: IRExpression, stateVarNames: Set<string>): boolean {
  if (expr.kind !== 'binary') return false;

  if (expr.operator === '==' || expr.operator === '!=') {
    const hasMsgSender = isMsgSender(expr.left) || isMsgSender(expr.right);
    const hasStateRef = isStateVarRef(expr.left, stateVarNames) ||
                        isStateVarRef(expr.right, stateVarNames);
    return hasMsgSender && hasStateRef;
  }

  // Handle OR patterns: msg.sender == owner || msg.sender == admin
  if (expr.operator === '||') {
    return isOwnershipCheck(expr.left, stateVarNames) ||
           isOwnershipCheck(expr.right, stateVarNames);
  }

  return false;
}

function isMsgSender(expr: IRExpression): boolean {
  return expr.kind === 'msg_access' && expr.property === 'sender';
}

function isStateVarRef(expr: IRExpression, stateVarNames: Set<string>): boolean {
  if (expr.kind === 'identifier') return stateVarNames.has(expr.name);
  if (expr.kind === 'member_access' && expr.object.kind === 'identifier') {
    return stateVarNames.has(expr.object.name);
  }
  return false;
}

// ─── Phase 2: Walk Function Bodies ───────────────────────────────────

/**
 * Build per-variable, per-function access records by walking all function
 * bodies (including constructor and modifier bodies).
 *
 * Returns: Map<variableName, Map<functionName, VariableAccessRecord>>
 */
function buildAccessRecords(
  contract: IRContract,
  adminModifiers: Set<string>
): Map<string, Map<string, VariableAccessRecord>> {
  const stateVarNames = new Set(
    contract.stateVariables
      .filter(v => v.mutability !== 'constant')
      .map(v => v.name)
  );
  const result = new Map<string, Map<string, VariableAccessRecord>>();

  // Initialize entries for each mutable state variable
  for (const name of stateVarNames) {
    result.set(name, new Map());
  }

  // Process constructor
  if (contract.constructor) {
    const walker = new BodyWalker(
      '__constructor__', stateVarNames, true, new Set()
    );
    walker.walkStatements(contract.constructor.body);
    mergeWalkerResults(walker, result);
  }

  // Process each function
  for (const fn of contract.functions) {
    const isAdmin = fn.modifiers.some(m => adminModifiers.has(m.name));

    // Build local parameter set to avoid false positives
    const localParams = new Set(fn.params.map(p => p.name));

    const walker = new BodyWalker(fn.name, stateVarNames, isAdmin, localParams);

    // Walk modifier bodies first (they execute before/around the function)
    for (const modInvocation of fn.modifiers) {
      const modDef = contract.modifiers.find(m => m.name === modInvocation.name);
      if (modDef) {
        walker.walkStatements(modDef.body);
      }
    }

    // Walk function body
    walker.walkStatements(fn.body);
    mergeWalkerResults(walker, result);
  }

  return result;
}

/**
 * Merge a BodyWalker's collected records into the global access map.
 */
function mergeWalkerResults(
  walker: BodyWalker,
  result: Map<string, Map<string, VariableAccessRecord>>
): void {
  for (const [varName, record] of walker.records) {
    let fnMap = result.get(varName);
    if (!fnMap) {
      fnMap = new Map();
      result.set(varName, fnMap);
    }
    fnMap.set(record.functionName, record);
  }
}

/**
 * Walks an IR function/modifier body, collecting per-variable access records.
 */
class BodyWalker {
  readonly functionName: string;
  private readonly stateVarNames: Set<string>;
  private readonly isAdminGuarded: boolean;
  private readonly localVars: Set<string>;
  private readonly writtenVars = new Set<string>();

  /** Collected access records: varName → VariableAccessRecord */
  readonly records = new Map<string, VariableAccessRecord>();

  constructor(
    functionName: string,
    stateVarNames: Set<string>,
    isAdminGuarded: boolean,
    localParams: Set<string>
  ) {
    this.functionName = functionName;
    this.stateVarNames = stateVarNames;
    this.isAdminGuarded = isAdminGuarded;
    this.localVars = new Set(localParams);
  }

  private getRecord(varName: string): VariableAccessRecord {
    let record = this.records.get(varName);
    if (!record) {
      record = {
        functionName: this.functionName,
        reads: false,
        writes: false,
        writeOperators: new Set(),
        isAdminGuarded: this.isAdminGuarded,
        mappingKeyPatterns: new Set(),
        readBeforeWrite: false,
        hasExplicitRead: false,
      };
      this.records.set(varName, record);
    }
    return record;
  }

  private recordRead(varName: string, isCompoundImplicit = false): void {
    if (!this.stateVarNames.has(varName)) return;
    if (this.localVars.has(varName)) return;
    const record = this.getRecord(varName);
    record.reads = true;
    if (!isCompoundImplicit) {
      record.hasExplicitRead = true;
    }
    if (!this.writtenVars.has(varName)) {
      record.readBeforeWrite = true;
    }
  }

  private recordWrite(varName: string, operator: string): void {
    if (!this.stateVarNames.has(varName)) return;
    if (this.localVars.has(varName)) return;
    const record = this.getRecord(varName);
    record.writes = true;
    record.writeOperators.add(operator);
    this.writtenVars.add(varName);
  }

  private recordMappingKey(varName: string, keyExpr: IRExpression): void {
    if (!this.stateVarNames.has(varName)) return;
    const record = this.getRecord(varName);
    if (keyExpr.kind === 'msg_access' && keyExpr.property === 'sender') {
      record.mappingKeyPatterns.add('msg_sender');
    } else if (keyExpr.kind === 'identifier' && !this.stateVarNames.has(keyExpr.name)) {
      record.mappingKeyPatterns.add('parameter');
    } else if (keyExpr.kind === 'literal') {
      record.mappingKeyPatterns.add('literal');
    } else {
      record.mappingKeyPatterns.add('computed');
    }
  }

  // ─── Statement Walking ─────────────────────────────────────────

  walkStatements(stmts: IRStatement[]): void {
    for (const stmt of stmts) {
      this.walkStatement(stmt);
    }
  }

  private walkStatement(stmt: IRStatement): void {
    switch (stmt.kind) {
      case 'assignment': {
        const targetName = extractBaseIdentifier(stmt.target);
        if (targetName && this.stateVarNames.has(targetName) && !this.localVars.has(targetName)) {
          // RHS is always read
          this.walkExprRead(stmt.value);

          // Compound assignments also read the target (implicit from +=/-= operator)
          if (stmt.operator !== '=') {
            this.recordRead(targetName, true);
          }

          this.recordWrite(targetName, stmt.operator);

          // Record mapping key if index access
          if (stmt.target.kind === 'index_access') {
            const baseName = extractBaseIdentifier(stmt.target.base);
            if (baseName && this.stateVarNames.has(baseName)) {
              this.recordMappingKey(baseName, stmt.target.index);
            }
          }
        } else {
          // Local variable assignment — scan both sides for state reads
          this.walkExprRead(stmt.target);
          this.walkExprRead(stmt.value);
        }
        break;
      }

      case 'variable_declaration': {
        // Register as local variable
        if (typeof stmt.name === 'string') {
          this.localVars.add(stmt.name);
        } else if (Array.isArray(stmt.name)) {
          for (const n of stmt.name) this.localVars.add(n);
        }
        if (stmt.initialValue) this.walkExprRead(stmt.initialValue);
        break;
      }

      case 'if':
        this.walkExprRead(stmt.condition);
        this.walkStatements(stmt.thenBlock);
        if (stmt.elseBlock) this.walkStatements(stmt.elseBlock);
        break;

      case 'for':
        if (stmt.init) this.walkStatement(stmt.init);
        if (stmt.condition) this.walkExprRead(stmt.condition);
        if (stmt.update) this.walkExprRead(stmt.update);
        this.walkStatements(stmt.body);
        break;

      case 'while':
      case 'do_while':
        this.walkExprRead(stmt.condition);
        this.walkStatements(stmt.body);
        break;

      case 'return':
        if (stmt.value) this.walkExprRead(stmt.value);
        break;

      case 'emit':
        if (stmt.args) {
          for (const arg of stmt.args) this.walkExprRead(arg);
        }
        break;

      case 'require':
        this.walkExprRead(stmt.condition);
        if (stmt.message) this.walkExprRead(stmt.message);
        break;

      case 'expression':
        this.walkExprRead(stmt.expression);
        break;

      case 'block':
        this.walkStatements(stmt.statements);
        break;

      case 'unchecked':
        this.walkStatements(stmt.statements);
        break;

      case 'revert':
        if (stmt.args) {
          for (const arg of stmt.args) this.walkExprRead(arg);
        }
        break;

      case 'try':
        this.walkExprRead(stmt.expression);
        this.walkStatements(stmt.body);
        for (const clause of stmt.catchClauses) {
          this.walkStatements(clause.body);
        }
        break;

      // break, continue, placeholder — no state access
    }
  }

  // ─── Expression Walking (read context) ─────────────────────────

  private walkExprRead(expr: IRExpression): void {
    if (!expr) return;

    switch (expr.kind) {
      case 'identifier':
        if (this.stateVarNames.has(expr.name) && !this.localVars.has(expr.name)) {
          this.recordRead(expr.name);
        }
        break;

      case 'index_access': {
        // If base is a state variable mapping, record read + key pattern
        const baseName = extractBaseIdentifier(expr.base);
        if (baseName && this.stateVarNames.has(baseName) && !this.localVars.has(baseName)) {
          this.recordRead(baseName);
          this.recordMappingKey(baseName, expr.index);
        } else {
          this.walkExprRead(expr.base);
        }
        this.walkExprRead(expr.index);
        break;
      }

      case 'member_access':
        this.walkExprRead(expr.object);
        break;

      case 'binary':
        this.walkExprRead(expr.left);
        this.walkExprRead(expr.right);
        break;

      case 'unary':
        // ++ and -- are both read and write (implicit compound read)
        if (expr.operator === '++' || expr.operator === '--') {
          const name = extractBaseIdentifier(expr.operand);
          if (name && this.stateVarNames.has(name) && !this.localVars.has(name)) {
            this.recordRead(name, true);
            this.recordWrite(name, expr.operator === '++' ? '+=' : '-=');
          }
        }
        this.walkExprRead(expr.operand);
        break;

      case 'function_call':
        this.walkExprRead(expr.function);
        for (const arg of expr.args) this.walkExprRead(arg);
        break;

      case 'conditional':
        this.walkExprRead(expr.condition);
        this.walkExprRead(expr.trueExpression);
        this.walkExprRead(expr.falseExpression);
        break;

      case 'type_conversion':
        this.walkExprRead(expr.expression);
        break;

      case 'tuple':
        for (const el of expr.elements) {
          if (el) this.walkExprRead(el);
        }
        break;

      case 'array_literal':
        for (const el of expr.elements) {
          this.walkExprRead(el);
        }
        break;

      case 'new':
        if (expr.args) {
          for (const arg of expr.args) this.walkExprRead(arg);
        }
        break;

      // literal, msg_access, block_access, tx_access, type_member — no state access
    }
  }
}

/**
 * Extract the base identifier name from an expression
 * (follows index_access and member_access chains).
 */
function extractBaseIdentifier(expr: IRExpression | undefined): string | null {
  if (!expr) return null;
  if (expr.kind === 'identifier') return expr.name;
  if (expr.kind === 'index_access') return extractBaseIdentifier(expr.base);
  if (expr.kind === 'member_access') return extractBaseIdentifier(expr.object);
  return null;
}

// ─── Phase 2b: Internal Call Propagation ─────────────────────────────

/**
 * Propagate access records through internal function calls.
 * If public function A calls internal function B which writes totalSupply,
 * then A's access records should also include totalSupply writes.
 */
function propagateInternalCalls(
  contract: IRContract,
  accessRecords: Map<string, Map<string, VariableAccessRecord>>
): void {
  const internalFunctions = new Set(
    contract.functions
      .filter(f => f.visibility === 'internal' || f.visibility === 'private')
      .map(f => f.name)
  );

  if (internalFunctions.size === 0) return;

  // Build call graph: function name → set of called internal functions
  const callGraph = new Map<string, Set<string>>();
  for (const fn of contract.functions) {
    const calls = new Set<string>();
    findInternalCalls(fn.body, internalFunctions, calls);
    callGraph.set(fn.name, calls);
  }

  // Transitive closure: propagate access records through call graph (fixed-point)
  let changed = true;
  let iterations = 0;
  const maxIterations = 100; // prevent infinite loops

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const [caller, callees] of callGraph) {
      for (const callee of callees) {
        // For each state variable, merge callee's access into caller
        for (const [varName, fnMap] of accessRecords) {
          const calleeRecord = fnMap.get(callee);
          if (!calleeRecord) continue;

          let callerRecord = fnMap.get(caller);
          if (!callerRecord) {
            callerRecord = {
              functionName: caller,
              reads: false,
              writes: false,
              writeOperators: new Set(),
              isAdminGuarded: false,
              mappingKeyPatterns: new Set(),
              readBeforeWrite: false,
              hasExplicitRead: false,
            };
            fnMap.set(caller, callerRecord);
            changed = true;
          }

          if (calleeRecord.reads && !callerRecord.reads) {
            callerRecord.reads = true;
            changed = true;
          }
          if (calleeRecord.hasExplicitRead && !callerRecord.hasExplicitRead) {
            callerRecord.hasExplicitRead = true;
            changed = true;
          }
          if (calleeRecord.writes && !callerRecord.writes) {
            callerRecord.writes = true;
            changed = true;
          }
          for (const op of calleeRecord.writeOperators) {
            if (!callerRecord.writeOperators.has(op)) {
              callerRecord.writeOperators.add(op);
              changed = true;
            }
          }
          for (const pattern of calleeRecord.mappingKeyPatterns) {
            if (!callerRecord.mappingKeyPatterns.has(pattern)) {
              callerRecord.mappingKeyPatterns.add(pattern);
              changed = true;
            }
          }
        }
      }
    }
  }
}

/**
 * Find internal function calls within an IR body.
 */
function findInternalCalls(
  body: IRStatement[],
  internalFunctions: Set<string>,
  result: Set<string>
): void {
  function walkExpr(expr: any): void {
    if (!expr) return;
    if (expr.kind === 'function_call' && expr.function?.kind === 'identifier') {
      if (internalFunctions.has(expr.function.name)) {
        result.add(expr.function.name);
      }
    }
    // Recurse into sub-expressions
    for (const key of Object.keys(expr)) {
      const val = expr[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object' && item.kind) walkExpr(item);
        }
      } else if (val && typeof val === 'object' && val.kind) {
        walkExpr(val);
      }
    }
  }

  function walkStmt(stmt: any): void {
    if (!stmt) return;
    for (const key of Object.keys(stmt)) {
      const val = stmt[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            if (item.kind) {
              // Could be either statement or expression
              if (isIRStatement(item)) walkStmt(item);
              else walkExpr(item);
            }
          }
        }
      } else if (val && typeof val === 'object' && val.kind) {
        if (isIRStatement(val)) walkStmt(val);
        else walkExpr(val);
      }
    }
  }

  for (const stmt of body) {
    walkStmt(stmt);
  }
}

const STATEMENT_KINDS = new Set([
  'variable_declaration', 'assignment', 'if', 'for', 'while', 'do_while',
  'return', 'emit', 'revert', 'require', 'expression', 'block', 'unchecked',
  'break', 'continue', 'try', 'placeholder',
]);

function isIRStatement(node: any): boolean {
  return node && STATEMENT_KINDS.has(node.kind);
}

// ─── Phase 3: Variable Classification ────────────────────────────────

function classifyVariable(
  variable: IRStateVariable,
  accessByFunction: Map<string, VariableAccessRecord>,
  allFunctions: IRFunction[]
): StateVariableAnalysis {
  const readers = new Set<string>();
  const writers = new Set<string>();
  const allWriteOps = new Set<string>();
  let isReadAlongWithWrite = false;
  let allWritersAreAdmin = true;
  let msgSenderKeyCount = 0;
  let totalKeyAccesses = 0;

  for (const [fnName, record] of accessByFunction) {
    if (record.reads) readers.add(fnName);
    if (record.writes) {
      writers.add(fnName);
      if (!record.isAdminGuarded) allWritersAreAdmin = false;
      for (const op of record.writeOperators) allWriteOps.add(op);
    }
    if (record.reads && record.writes) isReadAlongWithWrite = true;
    if (record.readBeforeWrite) isReadAlongWithWrite = true;

    if (record.mappingKeyPatterns.has('msg_sender')) msgSenderKeyCount++;
    totalKeyAccesses += record.mappingKeyPatterns.size;
  }

  const msgSenderKeyFraction = totalKeyAccesses > 0
    ? msgSenderKeyCount / totalKeyAccesses
    : 0;

  // ─── Classification rules ────────────────────────────────────

  let category: StateVariableCategory = 'general';
  let confidence = 0.5;

  // Rule 1: Admin/Config
  if (variable.mutability === 'immutable') {
    category = 'admin_config';
    confidence = 1.0;
  } else if (writers.size === 0) {
    // Never written outside constructor — read-only config
    category = 'admin_config';
    confidence = 0.9;
  } else if (writers.size === 1 && writers.has('__constructor__')) {
    category = 'admin_config';
    confidence = 0.95;
  } else if (allWritersAreAdmin && writers.size > 0) {
    category = 'admin_config';
    confidence = 0.85;
    if (writers.size > 3) confidence = 0.6;
  }

  // Rule 2: Aggregatable (only if not already classified)
  if (category === 'general') {
    const isNumeric = isNumericType(variable.type);
    const onlyCompound = allWriteOps.size > 0 &&
      [...allWriteOps].every(op => op === '+=' || op === '-=');
    const noPlainAssignment = !allWriteOps.has('=');

    if (isNumeric && onlyCompound && noPlainAssignment) {
      // Compound-only variables (only +=/-=, no plain =) are always good aggregator
      // candidates. The += operator maps to aggregator_v2::add() which doesn't need
      // a separate read. If there ARE explicit reads in the same function, the
      // snapshot pattern handles them.
      category = 'aggregatable';
      if (!isReadAlongWithWrite) {
        confidence = 0.9;
      } else {
        // Check if reads are only in view/pure functions or implicit from compound ops
        const readOnlyInViews = [...readers].every(fnName => {
          if (!writers.has(fnName)) return true; // Read in a separate function = OK
          const fn = allFunctions.find(f => f.name === fnName);
          return fn && (fn.stateMutability === 'view' || fn.stateMutability === 'pure');
        });
        confidence = readOnlyInViews ? 0.8 : 0.7;
      }
    }

    // Special case: counter-like name with compound-only writes (even if has plain = too)
    if (category === 'general' && isNumeric && onlyCompound) {
      const looksLikeCounter = /nonce|counter|count|total|supply/i.test(variable.name);
      if (looksLikeCounter) {
        category = 'aggregatable';
        confidence = 0.65;
      }
    }
  }

  // Rule 2b: Event-trackable (aggregatable variable never explicitly read in non-view functions)
  // These are write-only counters like accumulatedFees that can be tracked via events.
  // The implicit "read" from compound operators (+=/-=) doesn't count — aggregator_v2::add()
  // handles increments without reading the current value.
  if (category === 'aggregatable') {
    const hasExplicitNonViewRead = [...accessByFunction.entries()].some(([fnName, record]) => {
      if (!record.hasExplicitRead) return false; // Only compound-implicit reads
      const fn = allFunctions.find(f => f.name === fnName);
      return !(fn && (fn.stateMutability === 'view' || fn.stateMutability === 'pure'));
    });
    if (!hasExplicitNonViewRead && writers.size > 0) {
      // Name heuristic boost for fee-like variables
      const looksLikeFee = /fee|accumulated|collected|revenue/i.test(variable.name);
      if (looksLikeFee || readers.size === 0) {
        category = 'event_trackable';
        confidence = looksLikeFee ? 0.9 : 0.75;
      }
    }
  }

  // Rule 3: User-keyed mapping (only if not already classified)
  if (category === 'general' && variable.isMapping) {
    const keyType = variable.mappingKeyType?.solidity;
    if (keyType === 'address' && msgSenderKeyFraction >= 0.5) {
      category = 'user_keyed_mapping';
      confidence = Math.max(0.5, msgSenderKeyFraction);
    }
  }

  return {
    variable,
    category,
    confidence,
    accessByFunction,
    readers,
    writers,
    writeOperators: allWriteOps,
    isReadAlongWithWrite,
    msgSenderKeyFraction,
  };
}

function isNumericType(type: IRType): boolean {
  const sol = type.solidity || '';
  return /^u?int\d*$/.test(sol);
}

// ─── Phase 4: Resource Grouping ──────────────────────────────────────

function groupIntoResources(
  analyses: Map<string, StateVariableAnalysis>,
  contractName: string
): ResourceGroup[] {
  const groups: ResourceGroup[] = [];

  const adminVars = [...analyses.values()].filter(a => a.category === 'admin_config');
  const aggregatableVars = [...analyses.values()].filter(a => a.category === 'aggregatable');
  const userKeyedVars = [...analyses.values()].filter(a => a.category === 'user_keyed_mapping');
  const generalVars = [...analyses.values()].filter(a => a.category === 'general');

  // Admin config resource
  if (adminVars.length > 0) {
    groups.push({
      name: `${contractName}AdminConfig`,
      variables: adminVars,
      abilities: ['key'],
      isPrimary: false,
      isDistributed: false,
    });
  }

  // Aggregatable counters resource
  if (aggregatableVars.length > 0) {
    groups.push({
      name: `${contractName}Counters`,
      variables: aggregatableVars,
      abilities: ['key'],
      isPrimary: false,
      isDistributed: false,
    });
  }

  // User-keyed mappings resource
  if (userKeyedVars.length > 0) {
    groups.push({
      name: `${contractName}UserData`,
      variables: userKeyedVars,
      abilities: ['key'],
      isPrimary: false,
      isDistributed: false,
    });
  }

  // General state resource (primary)
  if (generalVars.length > 0) {
    groups.push({
      name: `${contractName}State`,
      variables: generalVars,
      abilities: ['key'],
      isPrimary: true,
      isDistributed: false,
    });
  }

  // Ensure exactly one primary group
  if (groups.length > 0 && !groups.some(g => g.isPrimary)) {
    groups[0].isPrimary = true;
  }

  // If no groups at all (shouldn't happen), create an empty state
  if (groups.length === 0) {
    groups.push({
      name: `${contractName}State`,
      variables: [],
      abilities: ['key'],
      isPrimary: true,
      isDistributed: false,
    });
  }

  return groups;
}

// ─── Phase 5: Function Access Profiles ───────────────────────────────

function buildFunctionProfiles(
  analyses: Map<string, StateVariableAnalysis>,
  resourceGroups: ResourceGroup[],
  contract: IRContract
): Map<string, FunctionAccessProfile> {
  // Build reverse map: variable name → resource group name
  const varToGroup = new Map<string, string>();
  for (const group of resourceGroups) {
    for (const va of group.variables) {
      varToGroup.set(va.variable.name, group.name);
    }
  }

  const profiles = new Map<string, FunctionAccessProfile>();

  for (const fn of contract.functions) {
    const reads = new Set<string>();
    const writes = new Set<string>();

    for (const [varName, analysis] of analyses) {
      const fnAccess = analysis.accessByFunction.get(fn.name);
      if (!fnAccess) continue;

      const groupName = varToGroup.get(varName);
      if (!groupName) continue;

      if (fnAccess.reads) reads.add(groupName);
      if (fnAccess.writes) writes.add(groupName);
    }

    // Combine for acquires annotation
    const allResources = new Set([...reads, ...writes]);

    profiles.set(fn.name, {
      functionName: fn.name,
      readsResources: reads,
      writesResources: writes,
      acquires: [...allResources],
    });
  }

  return profiles;
}

// ─── Scoring & Recommendations ───────────────────────────────────────

function computeParallelizationScore(
  analyses: Map<string, StateVariableAnalysis>,
  resourceGroups: ResourceGroup[],
  functionProfiles: Map<string, FunctionAccessProfile>
): number {
  // Component 1: Number of distinct resource groups (max 30 pts)
  const groupScore = Math.min(30, resourceGroups.length * 10);

  // Component 2: Fraction of functions touching <= 1 resource group (max 30 pts)
  let singleResourceFns = 0;
  let totalFns = 0;
  for (const [, profile] of functionProfiles) {
    totalFns++;
    const total = new Set([...profile.readsResources, ...profile.writesResources]);
    if (total.size <= 1) singleResourceFns++;
  }
  const singleResourceScore = totalFns > 0
    ? Math.round((singleResourceFns / totalFns) * 30) : 0;

  // Component 3: Fraction of variables that are aggregatable (max 20 pts)
  let aggregatableCount = 0;
  for (const [, a] of analyses) {
    if (a.category === 'aggregatable') aggregatableCount++;
  }
  const aggregatableScore = analyses.size > 0
    ? Math.round((aggregatableCount / analyses.size) * 20) : 0;

  // Component 4: Fraction of variables that are user-keyed (max 20 pts)
  let userKeyedCount = 0;
  for (const [, a] of analyses) {
    if (a.category === 'user_keyed_mapping') userKeyedCount++;
  }
  const userKeyedScore = analyses.size > 0
    ? Math.round((userKeyedCount / analyses.size) * 20) : 0;

  return groupScore + singleResourceScore + aggregatableScore + userKeyedScore;
}

function generateRecommendations(
  analyses: Map<string, StateVariableAnalysis>,
  resourceGroups: ResourceGroup[]
): string[] {
  const recs: string[] = [];

  if (resourceGroups.length > 1) {
    recs.push(
      `State split into ${resourceGroups.length} resource groups: ` +
      resourceGroups.map(g => g.name).join(', ')
    );
  }

  const aggregatable = [...analyses.values()].filter(a => a.category === 'aggregatable');
  if (aggregatable.length > 0) {
    recs.push(
      `${aggregatable.length} counter(s) can use Aggregator for parallel updates: ` +
      aggregatable.map(a => a.variable.name).join(', ')
    );
  }

  const userKeyed = [...analyses.values()].filter(a => a.category === 'user_keyed_mapping');
  if (userKeyed.length > 0) {
    recs.push(
      `${userKeyed.length} mapping(s) are user-keyed and could use per-user resources: ` +
      userKeyed.map(a => a.variable.name).join(', ')
    );
  }

  // Aggregator precision warning: Aggregator only supports u64/u128, not u256
  if (aggregatable.length > 0) {
    const u256Counters = aggregatable.filter(a => {
      const moveType = a.variable.type?.move;
      return moveType && moveType.kind === 'primitive' && moveType.name === 'u256';
    });
    if (u256Counters.length > 0) {
      recs.push(
        `Note: Aggregator<u128> used for u256 counters (${u256Counters.map(a => a.variable.name).join(', ')}). ` +
        'Aggregator does not support u256 — values capped at u128::MAX'
      );
    }
  }

  // Event-trackable recommendation
  const eventTrackable = [...analyses.values()].filter(a => a.category === 'event_trackable');
  if (eventTrackable.length > 0) {
    recs.push(
      `${eventTrackable.length} variable(s) tracked via events instead of state (write-only): ` +
      eventTrackable.map(a => a.variable.name).join(', ')
    );
  }

  // Snapshot pattern recommendation for functions that both read and write aggregators
  if (aggregatable.length > 0) {
    const readWriteFns = new Set<string>();
    for (const a of aggregatable) {
      for (const reader of a.readers) {
        if (a.writers.has(reader)) {
          readWriteFns.add(reader);
        }
      }
    }
    if (readWriteFns.size > 0) {
      recs.push(
        `Consider aggregator_v2::snapshot() pattern in functions that read+write counters: ` +
        [...readWriteFns].join(', ')
      );
    }
  }

  return recs;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function emptyProfile(contractName: string): ContractAccessProfile {
  return {
    contractName,
    variableAnalyses: new Map(),
    resourceGroups: [],
    functionProfiles: new Map(),
    adminModifiers: new Set(),
    parallelizationScore: 100, // No state = fully parallel
    recommendations: ['Contract has no mutable state — fully parallelizable.'],
  };
}
