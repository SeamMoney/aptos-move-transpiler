import { parse } from '@solidity-parser/parser';
import { solidityStatementToIR } from '../src/transformer/expression-transformer.js';

const solidityCode = `
pragma solidity ^0.8.20;

contract Test {
    function doSomething() external returns (uint256) {
        return 42;
    }
}
`;

const ast = parse(solidityCode);
const contract = (ast.children as any[]).find(c => c.type === 'ContractDefinition');
const funcNode = contract.subNodes.find((n: any) => n.type === 'FunctionDefinition');

console.log('Function body statements:');
for (const stmt of funcNode.body.statements) {
  console.log('AST type:', stmt.type);
  const ir = solidityStatementToIR(stmt);
  console.log('IR:', JSON.stringify(ir, null, 2));
  console.log('---');
}
