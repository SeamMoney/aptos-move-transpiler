// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Simple Flash Loan Pool (Aave-style)
 * Tests: callback patterns, reentrancy guards, fee calculations
 */
interface IFlashLoanReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

contract FlashLoanPool {
    // State variables
    mapping(address => uint256) public reserves;
    mapping(address => uint256) public totalBorrowed;

    uint256 public constant FLASH_LOAN_FEE = 9; // 0.09%
    uint256 public constant FEE_DENOMINATOR = 10000;

    // Reentrancy guard
    bool private locked;

    // Events
    event FlashLoan(
        address indexed receiver,
        address indexed asset,
        uint256 amount,
        uint256 premium
    );

    event Deposit(address indexed user, address indexed asset, uint256 amount);
    event Withdraw(address indexed user, address indexed asset, uint256 amount);

    // Reentrancy guard modifier
    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    /**
     * Deposit liquidity to the pool
     */
    function deposit(address asset, uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        reserves[asset] += amount;
        emit Deposit(msg.sender, asset, amount);
    }

    /**
     * Withdraw liquidity from the pool
     */
    function withdraw(address asset, uint256 amount) external nonReentrant {
        require(reserves[asset] >= amount, "Insufficient reserves");
        reserves[asset] -= amount;
        emit Withdraw(msg.sender, asset, amount);
    }

    /**
     * Execute a flash loan
     */
    function flashLoan(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params
    ) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(reserves[asset] >= amount, "Insufficient liquidity");

        uint256 premium = (amount * FLASH_LOAN_FEE) / FEE_DENOMINATOR;
        uint256 amountPlusPremium = amount + premium;

        // Track borrowed amount
        uint256 balanceBefore = reserves[asset];
        totalBorrowed[asset] += amount;

        // Transfer tokens to receiver (simulated)
        reserves[asset] -= amount;

        // Execute callback
        require(
            IFlashLoanReceiver(receiver).executeOperation(
                asset,
                amount,
                premium,
                msg.sender,
                params
            ),
            "Flash loan callback failed"
        );

        // Verify repayment
        require(
            reserves[asset] >= balanceBefore + premium,
            "Flash loan not repaid"
        );

        totalBorrowed[asset] -= amount;

        emit FlashLoan(receiver, asset, amount, premium);
    }

    /**
     * Repay flash loan (called by receiver)
     */
    function repayFlashLoan(address asset, uint256 amount) external {
        reserves[asset] += amount;
    }

    /**
     * Get available liquidity
     */
    function getAvailableLiquidity(address asset) external view returns (uint256) {
        return reserves[asset];
    }

    /**
     * Calculate flash loan premium
     */
    function calculatePremium(uint256 amount) external pure returns (uint256) {
        return (amount * FLASH_LOAN_FEE) / FEE_DENOMINATOR;
    }
}
