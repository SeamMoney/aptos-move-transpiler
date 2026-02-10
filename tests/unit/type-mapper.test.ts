/**
 * Unit Tests for Type Mapper
 * Tests Solidity to Move type mappings
 */

import { describe, it, expect } from 'vitest';
import { mapSolidityTypeToMove } from '../../src/mapper/type-mapper.js';

// Helper to create a simple type node
function createTypeName(name: string): any {
  if (name.endsWith('[]')) {
    const baseType = name.slice(0, -2);
    return {
      type: 'ArrayTypeName',
      baseTypeName: { type: 'ElementaryTypeName', name: baseType },
    };
  }
  const match = name.match(/^(\w+)\[(\d+)\]$/);
  if (match) {
    return {
      type: 'ArrayTypeName',
      baseTypeName: { type: 'ElementaryTypeName', name: match[1] },
      length: { type: 'NumberLiteral', number: match[2] },
    };
  }
  return { type: 'ElementaryTypeName', name };
}

// Wrapper for convenience - returns any for easier testing
function mapSolidityType(typeName: string): any {
  return mapSolidityTypeToMove(createTypeName(typeName));
}

describe('Type Mapper', () => {
  describe('Primitive Types', () => {
    it('should map uint256 to u256', () => {
      const result = mapSolidityType('uint256');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u256');
    });

    it('should map uint128 to u128', () => {
      const result = mapSolidityType('uint128');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u128');
    });

    it('should map uint64 to u64', () => {
      const result = mapSolidityType('uint64');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u64');
    });

    it('should map uint32 to u32', () => {
      const result = mapSolidityType('uint32');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u32');
    });

    it('should map uint16 to u16', () => {
      const result = mapSolidityType('uint16');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u16');
    });

    it('should map uint8 to u8', () => {
      const result = mapSolidityType('uint8');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u8');
    });

    it('should map uint (alias for uint256) to u256', () => {
      const result = mapSolidityType('uint');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u256');
    });

    it('should map bool to bool', () => {
      const result = mapSolidityType('bool');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('bool');
    });

    it('should map address to address', () => {
      const result = mapSolidityType('address');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('address');
    });
  });

  describe('Signed Integers (Move 2.3)', () => {
    it('should map int256 to i256', () => {
      const result = mapSolidityType('int256');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('i256');
    });

    it('should map int128 to i128', () => {
      const result = mapSolidityType('int128');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('i128');
    });

    it('should map int64 to i64', () => {
      const result = mapSolidityType('int64');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('i64');
    });

    it('should map int to i256', () => {
      const result = mapSolidityType('int');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('i256');
    });
  });

  describe('String and Bytes', () => {
    it('should map string to vector<u8>', () => {
      const result = mapSolidityType('string');
      // Strings are mapped to vector<u8> for compatibility
      expect(result.kind).toBe('vector');
      expect(result.elementType.kind).toBe('primitive');
      expect(result.elementType.name).toBe('u8');
    });

    it('should map bytes to vector<u8>', () => {
      const result = mapSolidityType('bytes');
      expect(result.kind).toBe('vector');
      expect(result.elementType.kind).toBe('primitive');
      expect(result.elementType.name).toBe('u8');
    });

    it('should map bytes32 to u256 (used for bit packing in DeFi)', () => {
      const result = mapSolidityType('bytes32');
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('u256');
    });
  });

  describe('Array Types', () => {
    it('should map uint256[] to vector<u256>', () => {
      const result = mapSolidityType('uint256[]');
      expect(result.kind).toBe('vector');
      expect(result.elementType.kind).toBe('primitive');
      expect(result.elementType.name).toBe('u256');
    });

    it('should map address[] to vector<address>', () => {
      const result = mapSolidityType('address[]');
      expect(result.kind).toBe('vector');
      expect(result.elementType.kind).toBe('primitive');
      expect(result.elementType.name).toBe('address');
    });

    it('should handle fixed-size arrays as vectors', () => {
      const result = mapSolidityType('uint256[10]');
      expect(result.kind).toBe('vector');
    });
  });
});
