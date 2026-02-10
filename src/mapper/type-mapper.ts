/**
 * Type Mapper
 * Maps Solidity types to Move v2 types
 */

import type { TypeName } from '@solidity-parser/parser/dist/src/ast-types.js';
import type { MoveType, MoveStructType } from '../types/move-ast.js';
import { MoveTypes } from '../types/move-ast.js';
import type { IRType } from '../types/ir.js';

/**
 * Map a Solidity type name to a Move type
 */
export function mapSolidityTypeToMove(typeName: TypeName): MoveType {
  switch (typeName.type) {
    case 'ElementaryTypeName':
      return mapElementaryType(typeName.name);

    case 'ArrayTypeName':
      const elementType = mapSolidityTypeToMove(typeName.baseTypeName);
      return MoveTypes.vector(elementType);

    case 'Mapping':
      // Mappings become Table<K, V>
      const keyType = mapSolidityTypeToMove(typeName.keyType);
      const valueType = mapSolidityTypeToMove(typeName.valueType);
      return {
        kind: 'struct',
        module: 'aptos_std::table',
        name: 'Table',
        typeArgs: [keyType, valueType],
      };

    case 'UserDefinedTypeName': {
      // User-defined types (structs, enums, contracts, interfaces)
      const namePath = typeName.namePath;

      // Interface types (IERC20, ILBPair, etc.) → address
      // In Move, contract references are just addresses
      if (namePath.startsWith('I') && namePath.length > 1 && namePath[1] === namePath[1].toUpperCase() && /^I[A-Z]/.test(namePath)) {
        return MoveTypes.address();
      }

      // Dotted type access (Library.StructName) → just use StructName
      if (namePath.includes('.')) {
        const parts = namePath.split('.');
        const structName = parts[parts.length - 1];
        return { kind: 'struct', name: structName };
      }

      return { kind: 'struct', name: namePath };
    }

    case 'FunctionTypeName':
      // Function types - Move 2.2 supports function values
      // For now, we'll represent as a placeholder
      return {
        kind: 'struct',
        name: 'FunctionRef',
      };

    default:
      throw new Error(`Unsupported type: ${(typeName as any).type}`);
  }
}

/**
 * Map Solidity elementary types to Move primitive types
 */
function mapElementaryType(name: string): MoveType {
  // Unsigned integers
  if (name === 'uint' || name === 'uint256') return MoveTypes.u256();
  if (name === 'uint8') return MoveTypes.u8();
  if (name === 'uint16') return MoveTypes.u16();
  if (name === 'uint32') return MoveTypes.u32();
  if (name === 'uint64') return MoveTypes.u64();
  if (name === 'uint128') return MoveTypes.u128();
  // uint24, uint40, etc. -> u32, u64 (nearest larger)
  if (name.startsWith('uint')) {
    const bits = parseInt(name.slice(4));
    if (bits <= 8) return MoveTypes.u8();
    if (bits <= 16) return MoveTypes.u16();
    if (bits <= 32) return MoveTypes.u32();
    if (bits <= 64) return MoveTypes.u64();
    if (bits <= 128) return MoveTypes.u128();
    return MoveTypes.u256();
  }

  // Signed integers (Move 2.3+ supports i8 through i256)
  // NOTE: Move signed integers do NOT support bitwise operations (&, |, ^, <<, >>)
  // For DeFi bit-packing patterns that use signed types with bitwise ops,
  // the unsigned equivalent should be used instead
  if (name === 'int' || name === 'int256') return MoveTypes.i256();
  if (name === 'int8') return MoveTypes.i8();
  if (name === 'int16') return MoveTypes.i16();
  if (name === 'int32') return MoveTypes.i32();
  if (name === 'int64') return MoveTypes.i64();
  if (name === 'int128') return MoveTypes.i128();
  if (name.startsWith('int')) {
    const bits = parseInt(name.slice(3));
    if (bits <= 8) return MoveTypes.i8();
    if (bits <= 16) return MoveTypes.i16();
    if (bits <= 32) return MoveTypes.i32();
    if (bits <= 64) return MoveTypes.i64();
    if (bits <= 128) return MoveTypes.i128();
    return MoveTypes.i256();
  }

  // Boolean
  if (name === 'bool') return MoveTypes.bool();

  // Address types
  if (name === 'address' || name === 'address payable') return MoveTypes.address();

  // Bytes types
  if (name === 'bytes' || name === 'string') {
    return MoveTypes.vector(MoveTypes.u8());
  }

  // Fixed-size bytes (bytes1 to bytes32)
  // bytes32 is commonly used for bit packing in DeFi (e.g., packed uint128 pairs)
  // Map to u256 since Move supports bitwise operations on integers
  // bytes1-bytes31 also map to the nearest uint type for arithmetic compatibility
  if (name.startsWith('bytes') && name.length <= 7) {
    const size = parseInt(name.slice(5));
    if (!isNaN(size) && size >= 1 && size <= 32) {
      if (size <= 1) return MoveTypes.u8();
      if (size <= 2) return MoveTypes.u16();
      if (size <= 4) return MoveTypes.u32();
      if (size <= 8) return MoveTypes.u64();
      if (size <= 16) return MoveTypes.u128();
      return MoveTypes.u256(); // bytes17-bytes32 → u256
    }
  }

  // String type
  if (name === 'string') {
    return {
      kind: 'struct',
      module: 'std::string',
      name: 'String',
    };
  }

  throw new Error(`Unknown elementary type: ${name}`);
}

/**
 * Create an IR type from a Solidity type
 */
export function createIRType(typeName: TypeName): IRType {
  const solidityStr = typeNameToString(typeName);
  const moveType = mapSolidityTypeToMove(typeName);

  const irType: IRType = {
    solidity: solidityStr,
    move: moveType,
    isArray: typeName.type === 'ArrayTypeName',
    isMapping: typeName.type === 'Mapping',
  };

  // Store struct name for user-defined types (needed for struct constructor detection)
  if (typeName.type === 'UserDefinedTypeName') {
    irType.structName = typeName.namePath;
  }

  if (typeName.type === 'ArrayTypeName') {
    if (typeName.length) {
      // Fixed-size array
      irType.arrayLength = parseInt((typeName.length as any).number || '0');
    }
  }

  if (typeName.type === 'Mapping') {
    irType.keyType = createIRType(typeName.keyType);
    irType.valueType = createIRType(typeName.valueType);
  }

  return irType;
}

/**
 * Convert a TypeName AST node to a string representation
 */
export function typeNameToString(typeName: TypeName): string {
  switch (typeName.type) {
    case 'ElementaryTypeName':
      return typeName.name;

    case 'ArrayTypeName':
      const baseStr = typeNameToString(typeName.baseTypeName);
      if (typeName.length) {
        return `${baseStr}[${(typeName.length as any).number || ''}]`;
      }
      return `${baseStr}[]`;

    case 'Mapping':
      const keyStr = typeNameToString(typeName.keyType);
      const valueStr = typeNameToString(typeName.valueType);
      return `mapping(${keyStr} => ${valueStr})`;

    case 'UserDefinedTypeName':
      return typeName.namePath;

    case 'FunctionTypeName':
      return 'function';

    default:
      return 'unknown';
  }
}

/**
 * Get the Move type string representation
 */
export function moveTypeToString(type: MoveType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;

    case 'vector':
      return `vector<${moveTypeToString(type.elementType)}>`;

    case 'struct':
      let str = '';
      if (type.module) {
        str = `${type.module}::`;
      }
      str += type.name;
      if (type.typeArgs && type.typeArgs.length > 0) {
        str += `<${type.typeArgs.map(moveTypeToString).join(', ')}>`;
      }
      return str;

    case 'reference':
      const prefix = type.mutable ? '&mut ' : '&';
      return prefix + moveTypeToString(type.innerType);

    case 'generic':
      return type.name;

    default:
      return 'unknown';
  }
}

/**
 * Check if a Move type needs the 'copy' ability
 */
export function needsCopyAbility(type: MoveType): boolean {
  if (type.kind === 'primitive') return true;
  if (type.kind === 'vector') return needsCopyAbility(type.elementType);
  return false;
}

/**
 * Check if a Move type needs the 'drop' ability
 */
export function needsDropAbility(type: MoveType): boolean {
  // Most types need drop for automatic cleanup
  return true;
}

/**
 * Check if a Move type needs the 'store' ability
 */
export function needsStoreAbility(type: MoveType): boolean {
  // Types stored in global storage need store
  return true;
}

/**
 * Get default abilities for a struct based on its purpose
 */
export function getDefaultAbilities(isResource: boolean, isEvent: boolean): string[] {
  if (isEvent) {
    return ['drop', 'store'];
  }
  if (isResource) {
    return ['key'];
  }
  return ['copy', 'drop', 'store'];
}

/**
 * Map common Solidity patterns to Move equivalents
 */
export const CommonPatterns = {
  // ERC20 balance: mapping(address => uint256)
  isBalanceMapping: (type: IRType): boolean => {
    return type.isMapping &&
      type.keyType?.solidity === 'address' &&
      (type.valueType?.solidity === 'uint256' || type.valueType?.solidity === 'uint');
  },

  // ERC20 allowance: mapping(address => mapping(address => uint256))
  isAllowanceMapping: (type: IRType): boolean => {
    return type.isMapping &&
      type.keyType?.solidity === 'address' &&
      type.valueType?.isMapping === true &&
      type.valueType?.keyType?.solidity === 'address';
  },

  // NFT ownership: mapping(uint256 => address)
  isOwnershipMapping: (type: IRType): boolean => {
    return type.isMapping &&
      type.keyType?.solidity === 'uint256' &&
      type.valueType?.solidity === 'address';
  },
};
