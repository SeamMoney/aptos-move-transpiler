import { transpile } from '../src/transpiler.js';

const solidity = `
  pragma solidity ^0.8.20;
  contract Counter {
    uint256 public count;

    function increment() public {
      count += 1;
    }

    function decrement() public {
      count -= 1;
    }

    function getCount() public view returns (uint256) {
      return count;
    }
  }
`;

const result = transpile(solidity, {
  moduleAddress: '0x1',
  packageName: 'counter',
  generateToml: true,
});

console.log('Success:', result.success);
console.log('Errors:', result.errors);
console.log('\nGenerated code:');
console.log(result.modules[0]?.code);
