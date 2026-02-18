/**
 * Parallelization Optimization Types
 *
 * Defines the data structures used by the state variable analyzer and
 * the optimization pipeline. The analyzer classifies each state variable
 * into a category, groups them into separate Move resource structs, and
 * builds per-function access profiles for targeted resource borrowing.
 */

import type { IRStateVariable } from './ir.js';

// ─── Optimization Level ──────────────────────────────────────────────

export type OptimizationLevel = 'low' | 'medium' | 'high';

// ─── State Variable Classification ───────────────────────────────────

/**
 * Category assigned to each state variable based on its access patterns.
 *
 * - admin_config: Written only by admin-guarded functions or constructor.
 *   Rarely changes, safe to isolate in its own resource.
 * - aggregatable: Numeric, modified only via +=/-=, never plain `=` outside
 *   constructor. Can use Aggregator<u128> for lock-free parallel updates.
 * - user_keyed_mapping: mapping(address => ...) primarily keyed by msg.sender.
 *   Can be distributed to per-user resources at high optimization.
 * - general: Everything else — complex access patterns, mixed read/write.
 */
export type StateVariableCategory =
  | 'admin_config'
  | 'aggregatable'
  | 'event_trackable'
  | 'user_keyed_mapping'
  | 'general';

/**
 * How a single function accesses a single state variable.
 */
export interface VariableAccessRecord {
  functionName: string;
  reads: boolean;
  writes: boolean;
  /** Which assignment operators are used (empty if writes === false) */
  writeOperators: Set<string>;
  /** Whether this function is guarded by an admin-only modifier */
  isAdminGuarded: boolean;
  /**
   * For mappings: what kind of key expressions are used.
   * - 'msg_sender': key is msg.sender
   * - 'parameter': key is a function parameter
   * - 'literal': key is a literal/constant
   * - 'computed': key is a complex expression
   */
  mappingKeyPatterns: Set<'msg_sender' | 'parameter' | 'literal' | 'computed'>;
  /** Whether the variable is read before being written in this function */
  readBeforeWrite: boolean;
  /** Whether the function has an explicit (non-compound-implicit) read of this variable */
  hasExplicitRead: boolean;
}

/**
 * Analysis result for a single state variable.
 */
export interface StateVariableAnalysis {
  variable: IRStateVariable;
  category: StateVariableCategory;
  /** Confidence in the classification (0.0 to 1.0) */
  confidence: number;
  /** Per-function access records */
  accessByFunction: Map<string, VariableAccessRecord>;
  /** Set of function names that read this variable */
  readers: Set<string>;
  /** Set of function names that write this variable */
  writers: Set<string>;
  /** Union of all write operators across all functions */
  writeOperators: Set<string>;
  /** Whether any function both reads and writes this variable */
  isReadAlongWithWrite: boolean;
  /** For user_keyed_mapping: fraction of accesses using msg.sender as key */
  msgSenderKeyFraction: number;
}

// ─── Resource Grouping ───────────────────────────────────────────────

/**
 * A group of state variables that will become a single Move resource struct.
 */
export interface ResourceGroup {
  /** Name of the resource struct (e.g., 'TokenAdminConfig') */
  name: string;
  /** The classified variables in this group */
  variables: StateVariableAnalysis[];
  /** Move abilities for this struct */
  abilities: string[];
  /** Whether this is the primary resource (holds signer_cap) */
  isPrimary: boolean;
  /** Whether this group should be distributed to per-user addresses (high only) */
  isDistributed: boolean;
}

/**
 * Per-function access profile: which resources a function needs.
 */
export interface FunctionAccessProfile {
  functionName: string;
  /** Resource group names this function reads (borrow_global) */
  readsResources: Set<string>;
  /** Resource group names this function writes (borrow_global_mut) */
  writesResources: Set<string>;
  /** All resource type names for the acquires annotation */
  acquires: string[];
}

// ─── Contract-Level Results ──────────────────────────────────────────

/**
 * Complete analysis result for a contract.
 */
export interface ContractAccessProfile {
  contractName: string;
  /** Per-variable classification and access analysis */
  variableAnalyses: Map<string, StateVariableAnalysis>;
  /** How variables are grouped into resource structs */
  resourceGroups: ResourceGroup[];
  /** Per-function resource access profiles */
  functionProfiles: Map<string, FunctionAccessProfile>;
  /** Modifier names identified as admin-only */
  adminModifiers: Set<string>;
  /** Overall parallelization score (0-100) */
  parallelizationScore: number;
  /** Human-readable optimization recommendations */
  recommendations: string[];
}

/**
 * The resource plan is the operational output of the analyzer,
 * consumed by the transformers during code generation.
 */
export interface EventTrackableConfig {
  /** Name of the auto-generated event struct (e.g., 'FeeAccumulated') */
  eventName: string;
  /** Move type of the event field (e.g., u256) */
  fieldType: any; // MoveType
}

/**
 * Configuration for a per-user resource (high optimization).
 * User-keyed mappings where all writes use msg.sender as key
 * are stored at each user's address instead of a central resource.
 */
export interface PerUserResourceConfig {
  /** Name of the per-user struct (e.g., 'TokenUserState') */
  structName: string;
  /** Fields in the per-user struct */
  fields: Array<{
    /** Original variable name (e.g., 'balances') */
    varName: string;
    /** Move field name (e.g., 'balance') */
    fieldName: string;
    /** Move type of the value (e.g., u256) */
    type: any; // MoveType
  }>;
}

export interface ResourcePlan {
  /** Resource groups to generate */
  groups: ResourceGroup[];
  /** Maps variable name → resource group name for field routing */
  varToGroup: Map<string, string>;
  /** Per-function access profiles for targeted borrowing */
  functionProfiles: Map<string, FunctionAccessProfile>;
  /** Functions that both read AND write aggregatable vars — use snapshot reads */
  snapshotEligibleFunctions: Set<string>;
  /** Variables tracked via events instead of state (variable name → config) */
  eventTrackables: Map<string, EventTrackableConfig>;
  /** Per-user resources (high optimization): mapping var name → config */
  perUserResources?: PerUserResourceConfig;
}
