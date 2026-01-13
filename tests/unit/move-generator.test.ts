/**
 * Unit Tests for Move Code Generator
 * Tests generation of Move source code from AST
 */

import { describe, it, expect } from 'vitest';
import { generateMoveCode, generateMoveToml } from '../../src/codegen/move-generator.js';
import type { MoveModule, MoveStruct, MoveFunction, MoveEnum, MoveConstant } from '../../src/types/move-ast.js';

// Helper to create minimal module
function createModule(overrides: Partial<MoveModule> = {}): MoveModule {
  return {
    address: '0x1',
    name: 'test_module',
    uses: [],
    friends: [],
    structs: [],
    enums: [],
    constants: [],
    functions: [],
    ...overrides,
  };
}

describe('Move Code Generator', () => {
  describe('Module Generation', () => {
    it('should generate empty module', () => {
      const module = createModule();
      const code = generateMoveCode(module);

      expect(code).toContain('module 0x1::test_module');
      expect(code).toContain('{');
      expect(code).toContain('}');
    });

    it('should generate module with different address', () => {
      const module = createModule({ address: '0xCAFE' });
      const code = generateMoveCode(module);

      expect(code).toContain('module 0xCAFE::test_module');
    });
  });

  describe('Use Declarations', () => {
    it('should generate simple use declaration', () => {
      const module = createModule({
        uses: [{ module: 'std::signer' }],
      });
      const code = generateMoveCode(module);

      expect(code).toContain('use std::signer;');
    });

    it('should generate use with members', () => {
      const module = createModule({
        uses: [{ module: 'std::string', members: ['String', 'utf8'] }],
      });
      const code = generateMoveCode(module);

      expect(code).toContain('use std::string::{String, utf8};');
    });

    it('should generate use with alias', () => {
      const module = createModule({
        uses: [{ module: 'aptos_framework::timestamp', alias: 'ts' }],
      });
      const code = generateMoveCode(module);

      expect(code).toContain('use aptos_framework::timestamp as ts;');
    });
  });

  describe('Struct Generation', () => {
    it('should generate struct with abilities', () => {
      const struct: MoveStruct = {
        name: 'TestStruct',
        abilities: ['key', 'store'],
        fields: [
          { name: 'value', type: { kind: 'primitive', name: 'u64' } },
        ],
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('struct TestStruct has key, store');
      expect(code).toContain('value: u64');
    });

    it('should generate struct with event attribute', () => {
      const struct: MoveStruct = {
        name: 'Transfer',
        abilities: ['drop', 'store'],
        fields: [
          { name: 'from', type: { kind: 'primitive', name: 'address' } },
          { name: 'to', type: { kind: 'primitive', name: 'address' } },
          { name: 'amount', type: { kind: 'primitive', name: 'u256' } },
        ],
        isEvent: true,
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('#[event]');
      expect(code).toContain('struct Transfer');
    });

    it('should generate struct with generic type parameters', () => {
      const struct: MoveStruct = {
        name: 'Container',
        abilities: ['store'],
        typeParams: [
          { name: 'T', constraints: ['store', 'drop'] },
        ],
        fields: [
          { name: 'item', type: { kind: 'generic', name: 'T' } },
        ],
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('struct Container<T: store + drop>');
    });

    it('should generate struct with phantom type parameter', () => {
      const struct: MoveStruct = {
        name: 'Coin',
        abilities: ['store'],
        typeParams: [
          { name: 'CoinType', isPhantom: true },
        ],
        fields: [
          { name: 'value', type: { kind: 'primitive', name: 'u64' } },
        ],
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('phantom CoinType');
    });
  });

  describe('Enum Generation (Move 2.0)', () => {
    it('should generate simple enum', () => {
      const enumDef: MoveEnum = {
        name: 'Status',
        abilities: ['copy', 'drop', 'store'],
        variants: [
          { name: 'Pending' },
          { name: 'Active' },
          { name: 'Completed' },
        ],
      };
      const module = createModule({ enums: [enumDef] });
      const code = generateMoveCode(module);

      expect(code).toContain('enum Status has copy, drop, store');
      expect(code).toContain('Pending');
      expect(code).toContain('Active');
      expect(code).toContain('Completed');
    });

    it('should generate enum with field variants', () => {
      const enumDef: MoveEnum = {
        name: 'Option',
        abilities: ['copy', 'drop', 'store'],
        typeParams: [{ name: 'T' }],
        variants: [
          { name: 'None' },
          { name: 'Some', fields: [{ name: 'value', type: { kind: 'generic', name: 'T' } }] },
        ],
      };
      const module = createModule({ enums: [enumDef] });
      const code = generateMoveCode(module);

      expect(code).toContain('enum Option<T>');
      expect(code).toContain('None');
      expect(code).toContain('Some { value: T }');
    });
  });

  describe('Constant Generation', () => {
    it('should generate integer constant', () => {
      const constant: MoveConstant = {
        name: 'MAX_VALUE',
        type: { kind: 'primitive', name: 'u64' },
        value: { kind: 'literal', type: 'number', value: 1000, suffix: 'u64' },
      };
      const module = createModule({ constants: [constant] });
      const code = generateMoveCode(module);

      expect(code).toContain('const MAX_VALUE: u64 = 1000u64;');
    });

    it('should generate address constant', () => {
      const constant: MoveConstant = {
        name: 'ZERO_ADDRESS',
        type: { kind: 'primitive', name: 'address' },
        value: { kind: 'literal', type: 'address', value: '@0x0' },
      };
      const module = createModule({ constants: [constant] });
      const code = generateMoveCode(module);

      expect(code).toContain('const ZERO_ADDRESS: address = @0x0;');
    });
  });

  describe('Function Generation', () => {
    it('should generate public entry function', () => {
      const func: MoveFunction = {
        name: 'do_something',
        visibility: 'public',
        isEntry: true,
        params: [
          { name: 'account', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } },
        ],
        body: [],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('public entry fun do_something');
      expect(code).toContain('account: &signer');
    });

    it('should generate view function', () => {
      const func: MoveFunction = {
        name: 'get_value',
        visibility: 'public',
        isView: true,
        params: [],
        returnType: { kind: 'primitive', name: 'u64' },
        body: [
          {
            kind: 'return',
            value: { kind: 'literal', type: 'number', value: 42, suffix: 'u64' },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('#[view]');
      expect(code).toContain('public fun get_value(): u64');
    });

    it('should generate function with acquires', () => {
      const func: MoveFunction = {
        name: 'modify_state',
        visibility: 'public',
        isEntry: true,
        params: [
          { name: 'account', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'signer' } } },
        ],
        acquires: ['State', 'Config'],
        body: [],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('acquires State, Config');
    });

    it('should generate private function', () => {
      const func: MoveFunction = {
        name: 'internal_helper',
        visibility: 'private',
        params: [],
        returnType: { kind: 'primitive', name: 'bool' },
        body: [
          { kind: 'return', value: { kind: 'literal', type: 'bool', value: true } },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('fun internal_helper(): bool');
      expect(code).not.toContain('public fun internal_helper');
    });
  });

  describe('Statement Generation', () => {
    it('should generate let statement', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          { kind: 'let', pattern: 'x', type: { kind: 'primitive', name: 'u64' }, value: { kind: 'literal', type: 'number', value: 10 } },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('let x: u64 = 10');
    });

    it('should generate mutable let statement', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          { kind: 'let', pattern: 'x', mutable: true, value: { kind: 'literal', type: 'number', value: 0 } },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('let mut x');
    });

    it('should generate if statement', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [{ name: 'x', type: { kind: 'primitive', name: 'u64' } }],
        body: [
          {
            kind: 'if',
            condition: { kind: 'binary', operator: '>', left: { kind: 'identifier', name: 'x' }, right: { kind: 'literal', type: 'number', value: 10 } },
            thenBlock: [{ kind: 'return', value: { kind: 'literal', type: 'bool', value: true } }],
            elseBlock: [{ kind: 'return', value: { kind: 'literal', type: 'bool', value: false } }],
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('if (');
      expect(code).toContain('} else {');
    });

    it('should generate while loop', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'while',
            condition: { kind: 'literal', type: 'bool', value: true },
            body: [{ kind: 'expression', expression: { kind: 'break' } }],
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('while (true)');
      expect(code).toContain('break');
    });

    it('should generate for loop (Move 2.0)', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'for',
            iterator: 'i',
            iterable: {
              kind: 'call',
              function: 'range',
              args: [
                { kind: 'literal', type: 'number', value: 0 },
                { kind: 'literal', type: 'number', value: 10 },
              ],
            },
            body: [],
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('for (i in 0..10)');
    });

    it('should generate abort statement', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          { kind: 'abort', code: { kind: 'literal', type: 'number', value: 1 } },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('abort 1');
    });
  });

  describe('Expression Generation', () => {
    it('should generate binary expression with parentheses', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'return',
            value: { kind: 'binary', operator: '+', left: { kind: 'identifier', name: 'a' }, right: { kind: 'identifier', name: 'b' } },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('(a + b)');
    });

    it('should generate function call', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'expression',
            expression: {
              kind: 'call',
              function: 'do_something',
              args: [{ kind: 'identifier', name: 'x' }],
            },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('do_something(x)');
    });

    it('should generate module-qualified function call', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'expression',
            expression: {
              kind: 'call',
              module: 'signer',
              function: 'address_of',
              args: [{ kind: 'identifier', name: 'account' }],
            },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('signer::address_of(account)');
    });

    it('should generate struct construction', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'return',
            value: {
              kind: 'struct',
              name: 'Point',
              fields: [
                { name: 'x', value: { kind: 'literal', type: 'number', value: 10 } },
                { name: 'y', value: { kind: 'literal', type: 'number', value: 20 } },
              ],
            },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('Point { x: 10, y: 20 }');
    });

    it('should generate borrow expression', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'let',
            pattern: 'ref',
            value: { kind: 'borrow', mutable: false, value: { kind: 'identifier', name: 'x' } },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('&x');
    });

    it('should generate mutable borrow expression', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'let',
            pattern: 'ref',
            value: { kind: 'borrow', mutable: true, value: { kind: 'identifier', name: 'x' } },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('&mut x');
    });

    it('should generate dereference expression', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'let',
            pattern: 'val',
            value: { kind: 'dereference', value: { kind: 'identifier', name: 'ref' } },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('*ref');
    });

    it('should generate vector literal', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'private',
        params: [],
        body: [
          {
            kind: 'return',
            value: {
              kind: 'vector',
              elements: [
                { kind: 'literal', type: 'number', value: 1 },
                { kind: 'literal', type: 'number', value: 2 },
                { kind: 'literal', type: 'number', value: 3 },
              ],
            },
          },
        ],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('vector[1, 2, 3]');
    });
  });

  describe('Type Generation', () => {
    it('should generate primitive types', () => {
      const struct: MoveStruct = {
        name: 'AllTypes',
        abilities: ['copy', 'drop'],
        fields: [
          { name: 'a', type: { kind: 'primitive', name: 'u8' } },
          { name: 'b', type: { kind: 'primitive', name: 'u64' } },
          { name: 'c', type: { kind: 'primitive', name: 'u128' } },
          { name: 'd', type: { kind: 'primitive', name: 'u256' } },
          { name: 'e', type: { kind: 'primitive', name: 'bool' } },
          { name: 'f', type: { kind: 'primitive', name: 'address' } },
        ],
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('a: u8');
      expect(code).toContain('b: u64');
      expect(code).toContain('c: u128');
      expect(code).toContain('d: u256');
      expect(code).toContain('e: bool');
      expect(code).toContain('f: address');
    });

    it('should generate vector type', () => {
      const struct: MoveStruct = {
        name: 'VectorTypes',
        abilities: ['copy', 'drop'],
        fields: [
          { name: 'items', type: { kind: 'vector', elementType: { kind: 'primitive', name: 'u64' } } },
        ],
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('items: vector<u64>');
    });

    it('should generate reference types', () => {
      const func: MoveFunction = {
        name: 'test',
        visibility: 'public',
        params: [
          { name: 'immutable_ref', type: { kind: 'reference', mutable: false, innerType: { kind: 'primitive', name: 'u64' } } },
          { name: 'mutable_ref', type: { kind: 'reference', mutable: true, innerType: { kind: 'primitive', name: 'u64' } } },
        ],
        body: [],
      };
      const module = createModule({ functions: [func] });
      const code = generateMoveCode(module);

      expect(code).toContain('immutable_ref: &u64');
      expect(code).toContain('mutable_ref: &mut u64');
    });

    it('should generate struct type with module', () => {
      const struct: MoveStruct = {
        name: 'Container',
        abilities: ['store'],
        fields: [
          { name: 'table', type: { kind: 'struct', module: 'aptos_std::table', name: 'Table', typeArgs: [{ kind: 'primitive', name: 'address' }, { kind: 'primitive', name: 'u64' }] } },
        ],
      };
      const module = createModule({ structs: [struct] });
      const code = generateMoveCode(module);

      expect(code).toContain('table: aptos_std::table::Table<address, u64>');
    });
  });
});

describe('Move.toml Generator', () => {
  it('should generate basic Move.toml', () => {
    const toml = generateMoveToml('my_package', '0x1');

    expect(toml).toContain('[package]');
    expect(toml).toContain('name = "my_package"');
    expect(toml).toContain('[addresses]');
    expect(toml).toContain('my_package = "0x1"');
    expect(toml).toContain('[dependencies]');
    expect(toml).toContain('AptosFramework');
  });

  it('should include token objects dependency when requested', () => {
    const toml = generateMoveToml('nft_package', '0x1', { includeTokenObjects: true });

    expect(toml).toContain('AptosTokenObjects');
    expect(toml).toContain('aptos_token_objects = "0x4"');
  });
});
