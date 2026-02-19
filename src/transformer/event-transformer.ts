/**
 * Event Transformer
 * Transforms Solidity events to Move event structs
 */

import type { MoveStruct, MoveStructField, MoveType } from '../types/move-ast.js';
import type { IREvent, IREventParam, TranspileContext } from '../types/ir.js';
import { MoveTypes } from '../types/move-ast.js';

/**
 * Transform an IR event to a Move event struct.
 *
 * Returns null when eventPattern is 'none' (caller must skip the struct).
 * For 'event-handle' mode, sets isEvent to false so no #[event] attribute is rendered.
 * For 'native' mode (default), keeps existing behavior with isEvent: true.
 */
export function transformEvent(
  event: IREvent,
  context: TranspileContext
): MoveStruct | null {
  // 'none': strip event structs entirely
  if (context.eventPattern === 'none') {
    return null;
  }

  context.usedModules.add('aptos_framework::event');

  const fields: MoveStructField[] = event.params.map(param =>
    transformEventParam(param, context)
  );

  // 'event-handle': struct exists but without #[event] attribute
  const isNativeEvent = context.eventPattern !== 'event-handle';

  return {
    name: event.name,
    abilities: ['drop', 'store'],
    fields,
    isEvent: isNativeEvent,
  };
}

/**
 * Transform an event parameter to a Move struct field
 */
function transformEventParam(
  param: IREventParam,
  context: TranspileContext
): MoveStructField {
  let moveType: MoveType = param.type.move || MoveTypes.u256();

  // Indexed parameters in Solidity don't have a direct equivalent in Move
  // Move events store all fields equally
  // We could add a comment or handle this differently if needed

  return {
    name: toSnakeCase(param.name),
    type: moveType,
  };
}

/**
 * Generate event emission statement
 */
export function generateEventEmit(
  eventName: string,
  args: { name: string; value: any }[],
  context: TranspileContext
): any {
  context.usedModules.add('aptos_framework::event');

  return {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: 'event::emit',
      module: 'aptos_framework::event',
      args: [
        {
          kind: 'struct',
          name: eventName,
          fields: args,
        },
      ],
    },
  };
}

/**
 * Generate event struct for ERC-20 Transfer
 */
export function generateTransferEvent(context: TranspileContext): MoveStruct {
  context.usedModules.add('aptos_framework::event');

  return {
    name: 'Transfer',
    abilities: ['drop', 'store'],
    isEvent: true,
    fields: [
      { name: 'from', type: MoveTypes.address() },
      { name: 'to', type: MoveTypes.address() },
      { name: 'value', type: MoveTypes.u256() },
    ],
  };
}

/**
 * Generate event struct for ERC-20 Approval
 */
export function generateApprovalEvent(context: TranspileContext): MoveStruct {
  context.usedModules.add('aptos_framework::event');

  return {
    name: 'Approval',
    abilities: ['drop', 'store'],
    isEvent: true,
    fields: [
      { name: 'owner', type: MoveTypes.address() },
      { name: 'spender', type: MoveTypes.address() },
      { name: 'value', type: MoveTypes.u256() },
    ],
  };
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
