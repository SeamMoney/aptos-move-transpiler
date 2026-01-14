import { parse } from '@solidity-parser/parser';
import { solidityStatementToIR } from '../src/transformer/expression-transformer.js';

const solidityCode = `
pragma solidity ^0.8.20;

contract Test {
    uint256 unlocked = 1;
    
    modifier lock() {
        require(unlocked == 1, "LOCKED");
        unlocked = 0;
        _;
        unlocked = 1;
    }
}
`;

const ast = parse(solidityCode);
const contract = (ast.children as any[]).find(c => c.type === 'ContractDefinition');
const modifierNode = contract.subNodes.find((n: any) => n.type === 'ModifierDefinition');

console.log('Modifier body statements:');
for (const stmt of modifierNode.body.statements) {
  console.log('AST type:', stmt.type);
  const ir = solidityStatementToIR(stmt);
  console.log('IR kind:', ir.kind);
  console.log(JSON.stringify(ir, null, 2));
  console.log('---');
}
