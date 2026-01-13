// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * OpenZeppelin-style Reentrancy Guard
 * Tests: state machine pattern, modifier handling
 */
contract ReentrancyGuard {
    // Reentrancy state
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private status;

    constructor() {
        status = NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(status != ENTERED, "ReentrancyGuard: reentrant call");
        status = ENTERED;
        _;
        status = NOT_ENTERED;
    }

    function _reentrancyGuardEntered() internal view returns (bool) {
        return status == ENTERED;
    }
}

/**
 * Secure Vault with Reentrancy Protection
 */
contract SecureVault is ReentrancyGuard {
    // Balances
    mapping(address => uint256) public balances;

    // Total deposited
    uint256 public totalDeposits;

    // Pause functionality
    bool public paused;
    address public owner;

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor() {
        owner = msg.sender;
        paused = false;
    }

    /**
     * Deposit ETH to vault
     */
    function deposit() external payable whenNotPaused nonReentrant {
        require(msg.value > 0, "Must deposit something");

        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    /**
     * Withdraw from vault with reentrancy protection
     * This is the critical function that could be exploited
     */
    function withdraw(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // Update state BEFORE external call (Checks-Effects-Interactions)
        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        // External call - potential reentrancy vector
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * Emergency withdrawal - owner can rescue stuck funds
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /**
     * Pause the contract
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * Unpause the contract
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * View user balance
     */
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /**
     * Check if currently in a reentrant call
     */
    function isReentrant() external view returns (bool) {
        return _reentrancyGuardEntered();
    }
}
