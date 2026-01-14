import { transpile } from '../src/transpiler.js';

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
    
    function doSomething() external lock returns (uint256) {
        return 42;
    }
}
`;

const result = transpile(solidityCode, {
  moduleAddress: '0x1',
  packageName: 'test',
  generateToml: true,
});

console.log('Generated code:');
console.log(result.modules[0]?.code);
