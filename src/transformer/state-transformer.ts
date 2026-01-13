/**
 * State Transformer
 * Transforms Solidity state variables to Move resource fields
 */

import type { MoveStructField, MoveType } from '../types/move-ast.js';
import type { IRStateVariable, TranspileContext } from '../types/ir.js';
import { MoveTypes } from '../types/move-ast.js';

/**
 * Transform a state variable to a Move struct field
 */
export function transformStateVariable(
  variable: IRStateVariable,
  context: TranspileContext
): MoveStructField {
  let moveType: MoveType;

  if (variable.isMapping) {
    // Mapping -> Table<K, V>
    moveType = transformMappingType(variable, context);
  } else if (variable.type.isArray) {
    // Array -> vector<T>
    moveType = transformArrayType(variable, context);
  } else {
    // Regular type
    moveType = variable.type.move || MoveTypes.u256();
  }

  return {
    name: toSnakeCase(variable.name),
    type: moveType,
  };
}

/**
 * Transform a mapping type to Move Table
 */
function transformMappingType(
  variable: IRStateVariable,
  context: TranspileContext
): MoveType {
  context.usedModules.add('aptos_std::table');

  const keyType = variable.mappingKeyType?.move || MoveTypes.address();
  const valueType = variable.mappingValueType?.move || MoveTypes.u256();

  // Handle nested mappings (e.g., mapping(address => mapping(address => uint256)))
  if (variable.mappingValueType?.isMapping) {
    context.usedModules.add('aptos_std::table');
    return {
      kind: 'struct',
      module: 'aptos_std::table',
      name: 'Table',
      typeArgs: [
        keyType,
        {
          kind: 'struct',
          module: 'aptos_std::table',
          name: 'Table',
          typeArgs: [
            variable.mappingValueType.keyType?.move || MoveTypes.address(),
            variable.mappingValueType.valueType?.move || MoveTypes.u256(),
          ],
        },
      ],
    };
  }

  return {
    kind: 'struct',
    module: 'aptos_std::table',
    name: 'Table',
    typeArgs: [keyType, valueType],
  };
}

/**
 * Transform an array type to Move vector
 */
function transformArrayType(
  variable: IRStateVariable,
  context: TranspileContext
): MoveType {
  // Get the base element type
  let elementType: MoveType = MoveTypes.u256();

  if (variable.type.move?.kind === 'vector') {
    elementType = variable.type.move.elementType;
  }

  return MoveTypes.vector(elementType);
}

/**
 * Generate initialization code for a state variable
 */
export function generateStateInitialization(
  variable: IRStateVariable,
  context: TranspileContext
): { name: string; value: any } {
  const name = toSnakeCase(variable.name);

  if (variable.initialValue) {
    return {
      name,
      value: variable.initialValue,
    };
  }

  // Generate default value
  return {
    name,
    value: getDefaultValueForType(variable, context),
  };
}

/**
 * Get default value for a type
 */
function getDefaultValueForType(
  variable: IRStateVariable,
  context: TranspileContext
): any {
  if (variable.isMapping) {
    context.usedModules.add('aptos_std::table');
    return {
      kind: 'call',
      function: 'table::new',
      module: 'aptos_std::table',
      args: [],
    };
  }

  if (variable.type.isArray) {
    return {
      kind: 'call',
      function: 'vector::empty',
      module: 'std::vector',
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
          // Numeric types
          return { kind: 'literal', type: 'number', value: 0, suffix: moveType.name };
      }

    case 'vector':
      return {
        kind: 'call',
        function: 'vector::empty',
        args: [],
      };

    case 'struct':
      if (moveType.module?.includes('string')) {
        context.usedModules.add('std::string');
        return {
          kind: 'call',
          function: 'string::utf8',
          module: 'std::string',
          args: [{ kind: 'vector', elements: [] }],
        };
      }
      // For other structs, we need to construct them
      return {
        kind: 'struct',
        name: moveType.name,
        module: moveType.module,
        fields: [],
      };

    default:
      return { kind: 'literal', type: 'number', value: 0 };
  }
}

/**
 * Determine the storage strategy for a state variable
 * Some variables might be better as separate resources at user addresses
 */
export function determineStorageStrategy(
  variable: IRStateVariable,
  context: TranspileContext
): 'central' | 'distributed' {
  // For mappings keyed by address, consider distributed storage
  if (variable.isMapping && variable.mappingKeyType?.solidity === 'address') {
    // This could be stored at each user's address for better parallelism
    // For now, we use central storage (single resource at contract address)
    return 'central';
  }

  return 'central';
}

/**
 * Generate getter function for a state variable
 */
export function generateGetter(
  variable: IRStateVariable,
  contractName: string,
  context: TranspileContext
): any {
  const stateName = `${contractName}State`;
  const fieldName = toSnakeCase(variable.name);
  const moduleAddr = context.moduleAddress;

  if (variable.isMapping) {
    context.usedModules.add('aptos_std::table');
    return {
      name: `get_${fieldName}`,
      visibility: 'public',
      isView: true,
      params: [
        { name: 'key', type: variable.mappingKeyType?.move || MoveTypes.address() },
      ],
      returnType: variable.mappingValueType?.move || MoveTypes.u256(),
      acquires: [stateName],
      body: [
        {
          kind: 'let',
          pattern: 'state',
          value: {
            kind: 'call',
            function: 'borrow_global',
            typeArgs: [{ kind: 'struct', name: stateName }],
            args: [{ kind: 'literal', type: 'address', value: `@${moduleAddr}` }],
          },
        },
        {
          kind: 'return',
          value: {
            kind: 'dereference',
            value: {
              kind: 'call',
              function: 'table::borrow',
              args: [
                { kind: 'borrow', mutable: false, value: { kind: 'field_access', object: { kind: 'identifier', name: 'state' }, field: fieldName } },
                { kind: 'identifier', name: 'key' },
              ],
            },
          },
        },
      ],
    };
  }

  return {
    name: `get_${fieldName}`,
    visibility: 'public',
    isView: true,
    params: [],
    returnType: variable.type.move || MoveTypes.u256(),
    acquires: [stateName],
    body: [
      {
        kind: 'return',
        value: {
          kind: 'field_access',
          object: {
            kind: 'call',
            function: 'borrow_global',
            typeArgs: [{ kind: 'struct', name: stateName }],
            args: [{ kind: 'literal', type: 'address', value: `@${moduleAddr}` }],
          },
          field: fieldName,
        },
      },
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
