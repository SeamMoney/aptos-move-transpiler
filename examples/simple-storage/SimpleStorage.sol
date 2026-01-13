// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title SimpleStorage
/// @notice A basic storage contract for demonstration
contract SimpleStorage {
    uint256 private storedValue;
    address public owner;

    event ValueChanged(address indexed sender, uint256 oldValue, uint256 newValue);

    constructor() {
        owner = msg.sender;
        storedValue = 0;
    }

    /// @notice Store a new value
    /// @param newValue The value to store
    function setValue(uint256 newValue) public {
        uint256 oldValue = storedValue;
        storedValue = newValue;
        emit ValueChanged(msg.sender, oldValue, newValue);
    }

    /// @notice Get the stored value
    /// @return The current stored value
    function getValue() public view returns (uint256) {
        return storedValue;
    }

    /// @notice Increment the stored value by 1
    function increment() public {
        storedValue += 1;
    }

    /// @notice Check if caller is the owner
    function isOwner() public view returns (bool) {
        return msg.sender == owner;
    }
}
