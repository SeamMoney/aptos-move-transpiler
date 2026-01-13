// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Simple Lending Protocol - Aave/Compound Style
 * Tests: Deposits, borrows, interest rates, liquidations, collateral
 */
contract SimpleLending {
    // Market state
    struct Market {
        bool isListed;
        uint256 collateralFactor; // Scaled by 1e18 (e.g., 0.75e18 = 75%)
        uint256 liquidationThreshold; // Scaled by 1e18
        uint256 liquidationBonus; // Scaled by 1e18 (e.g., 1.05e18 = 5% bonus)
        uint256 totalDeposits;
        uint256 totalBorrows;
        uint256 borrowIndex; // Accumulates interest
        uint256 lastUpdateBlock;
    }

    // User account state
    struct AccountLiquidity {
        uint256 totalCollateralValue;
        uint256 totalBorrowValue;
        uint256 availableBorrow;
        uint256 shortfall;
    }

    // User position per market
    struct UserPosition {
        uint256 depositBalance;
        uint256 borrowBalance;
        uint256 borrowIndex; // User's borrow index at time of borrow
    }

    // Interest rate model parameters
    uint256 public constant BASE_RATE = 2e16; // 2% base rate
    uint256 public constant MULTIPLIER = 10e16; // 10% slope
    uint256 public constant JUMP_MULTIPLIER = 200e16; // 200% jump slope
    uint256 public constant KINK = 80e16; // 80% utilization kink

    // Protocol state
    address public admin;
    mapping(address => Market) public markets;
    mapping(address => mapping(address => UserPosition)) public userPositions; // user => asset => position
    mapping(address => address[]) public userAssets; // user => list of assets

    // Price oracle (simplified)
    mapping(address => uint256) public assetPrices; // asset => price in USD (scaled by 1e18)

    // Events
    event MarketListed(address indexed asset, uint256 collateralFactor);
    event Deposit(address indexed user, address indexed asset, uint256 amount);
    event Withdraw(address indexed user, address indexed asset, uint256 amount);
    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed user, address indexed asset, uint256 amount);
    event Liquidate(
        address indexed liquidator,
        address indexed borrower,
        address indexed debtAsset,
        address collateralAsset,
        uint256 debtRepaid,
        uint256 collateralSeized
    );

    // Errors
    error MarketNotListed();
    error InsufficientCollateral();
    error InsufficientLiquidity();
    error NotLiquidatable();
    error Unauthorized();
    error InvalidAmount();

    modifier onlyAdmin() {
        require(msg.sender == admin, "Unauthorized");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /**
     * List a new market
     */
    function listMarket(
        address asset,
        uint256 collateralFactor,
        uint256 liquidationThreshold,
        uint256 liquidationBonus
    ) external onlyAdmin {
        require(!markets[asset].isListed, "Already listed");
        require(collateralFactor <= 1e18, "Invalid collateral factor");

        markets[asset] = Market({
            isListed: true,
            collateralFactor: collateralFactor,
            liquidationThreshold: liquidationThreshold,
            liquidationBonus: liquidationBonus,
            totalDeposits: 0,
            totalBorrows: 0,
            borrowIndex: 1e18,
            lastUpdateBlock: block.number
        });

        emit MarketListed(asset, collateralFactor);
    }

    /**
     * Set asset price (simplified oracle)
     */
    function setPrice(address asset, uint256 price) external onlyAdmin {
        assetPrices[asset] = price;
    }

    /**
     * Deposit assets as collateral
     */
    function deposit(address asset, uint256 amount) external {
        Market storage market = markets[asset];
        require(market.isListed, "Market not listed");
        require(amount > 0, "Invalid amount");

        // Accrue interest
        _accrueInterest(asset);

        // Update user position
        UserPosition storage position = userPositions[msg.sender][asset];
        if (position.depositBalance == 0) {
            userAssets[msg.sender].push(asset);
        }
        position.depositBalance += amount;

        // Update market totals
        market.totalDeposits += amount;

        emit Deposit(msg.sender, asset, amount);
    }

    /**
     * Withdraw deposited assets
     */
    function withdraw(address asset, uint256 amount) external {
        Market storage market = markets[asset];
        require(market.isListed, "Market not listed");

        _accrueInterest(asset);

        UserPosition storage position = userPositions[msg.sender][asset];
        require(position.depositBalance >= amount, "Insufficient balance");

        // Check if withdrawal would cause shortfall
        position.depositBalance -= amount;
        (,, , uint256 shortfall) = getAccountLiquidity(msg.sender);
        require(shortfall == 0, "Insufficient collateral");

        market.totalDeposits -= amount;

        emit Withdraw(msg.sender, asset, amount);
    }

    /**
     * Borrow assets against collateral
     */
    function borrow(address asset, uint256 amount) external {
        Market storage market = markets[asset];
        require(market.isListed, "Market not listed");
        require(amount > 0, "Invalid amount");

        _accrueInterest(asset);

        // Check liquidity
        (,, uint256 availableBorrow,) = getAccountLiquidity(msg.sender);
        uint256 borrowValue = (amount * assetPrices[asset]) / 1e18;
        require(borrowValue <= availableBorrow, "Insufficient collateral");

        // Update user position
        UserPosition storage position = userPositions[msg.sender][asset];
        position.borrowBalance += amount;
        position.borrowIndex = market.borrowIndex;

        // Update market totals
        market.totalBorrows += amount;

        emit Borrow(msg.sender, asset, amount);
    }

    /**
     * Repay borrowed assets
     */
    function repay(address asset, uint256 amount) external {
        Market storage market = markets[asset];
        require(market.isListed, "Market not listed");

        _accrueInterest(asset);

        UserPosition storage position = userPositions[msg.sender][asset];

        // Calculate actual repay amount (can't repay more than owed)
        uint256 borrowedWithInterest = _borrowBalanceWithInterest(msg.sender, asset);
        uint256 repayAmount = amount > borrowedWithInterest ? borrowedWithInterest : amount;

        position.borrowBalance = borrowedWithInterest - repayAmount;
        position.borrowIndex = market.borrowIndex;

        market.totalBorrows -= repayAmount;

        emit Repay(msg.sender, asset, repayAmount);
    }

    /**
     * Liquidate an undercollateralized position
     */
    function liquidate(
        address borrower,
        address debtAsset,
        address collateralAsset,
        uint256 debtToRepay
    ) external {
        require(borrower != msg.sender, "Cannot self-liquidate");

        _accrueInterest(debtAsset);
        _accrueInterest(collateralAsset);

        // Check if borrower is liquidatable
        (,,, uint256 shortfall) = getAccountLiquidity(borrower);
        require(shortfall > 0, "Not liquidatable");

        // Calculate collateral to seize
        Market storage collateralMarket = markets[collateralAsset];
        uint256 debtValue = (debtToRepay * assetPrices[debtAsset]) / 1e18;
        uint256 collateralToSeize = (debtValue * collateralMarket.liquidationBonus) / assetPrices[collateralAsset];

        // Update positions
        UserPosition storage borrowerDebt = userPositions[borrower][debtAsset];
        UserPosition storage borrowerCollateral = userPositions[borrower][collateralAsset];

        require(borrowerDebt.borrowBalance >= debtToRepay, "Repay exceeds debt");
        require(borrowerCollateral.depositBalance >= collateralToSeize, "Insufficient collateral to seize");

        borrowerDebt.borrowBalance -= debtToRepay;
        borrowerCollateral.depositBalance -= collateralToSeize;

        // Transfer seized collateral to liquidator
        userPositions[msg.sender][collateralAsset].depositBalance += collateralToSeize;

        markets[debtAsset].totalBorrows -= debtToRepay;

        emit Liquidate(msg.sender, borrower, debtAsset, collateralAsset, debtToRepay, collateralToSeize);
    }

    /**
     * Calculate account liquidity
     */
    function getAccountLiquidity(address user) public view returns (
        uint256 totalCollateralValue,
        uint256 totalBorrowValue,
        uint256 availableBorrow,
        uint256 shortfall
    ) {
        address[] storage assets = userAssets[user];

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            Market storage market = markets[asset];
            UserPosition storage position = userPositions[user][asset];

            // Add collateral value (adjusted by collateral factor)
            if (position.depositBalance > 0) {
                uint256 depositValue = (position.depositBalance * assetPrices[asset]) / 1e18;
                uint256 adjustedCollateral = (depositValue * market.collateralFactor) / 1e18;
                totalCollateralValue += adjustedCollateral;
            }

            // Add borrow value
            if (position.borrowBalance > 0) {
                uint256 borrowBalance = _borrowBalanceWithInterest(user, asset);
                uint256 borrowValue = (borrowBalance * assetPrices[asset]) / 1e18;
                totalBorrowValue += borrowValue;
            }
        }

        if (totalCollateralValue > totalBorrowValue) {
            availableBorrow = totalCollateralValue - totalBorrowValue;
            shortfall = 0;
        } else {
            availableBorrow = 0;
            shortfall = totalBorrowValue - totalCollateralValue;
        }
    }

    /**
     * Calculate borrow interest rate based on utilization
     */
    function getBorrowRate(address asset) public view returns (uint256) {
        Market storage market = markets[asset];

        if (market.totalDeposits == 0) {
            return BASE_RATE;
        }

        uint256 utilization = (market.totalBorrows * 1e18) / market.totalDeposits;

        if (utilization <= KINK) {
            return BASE_RATE + (utilization * MULTIPLIER) / 1e18;
        } else {
            uint256 normalRate = BASE_RATE + (KINK * MULTIPLIER) / 1e18;
            uint256 excessUtilization = utilization - KINK;
            return normalRate + (excessUtilization * JUMP_MULTIPLIER) / 1e18;
        }
    }

    /**
     * Calculate supply interest rate
     */
    function getSupplyRate(address asset) public view returns (uint256) {
        Market storage market = markets[asset];

        if (market.totalDeposits == 0) {
            return 0;
        }

        uint256 utilization = (market.totalBorrows * 1e18) / market.totalDeposits;
        uint256 borrowRate = getBorrowRate(asset);

        // Supply rate = borrow rate * utilization * (1 - reserve factor)
        // Simplified: no reserve factor
        return (borrowRate * utilization) / 1e18;
    }

    // Internal functions
    function _accrueInterest(address asset) internal {
        Market storage market = markets[asset];

        uint256 blockDelta = block.number - market.lastUpdateBlock;
        if (blockDelta == 0) {
            return;
        }

        uint256 borrowRate = getBorrowRate(asset);
        uint256 interestFactor = borrowRate * blockDelta;

        // Update borrow index
        uint256 interestAccumulated = (market.totalBorrows * interestFactor) / 1e18;
        market.totalBorrows += interestAccumulated;
        market.borrowIndex += (market.borrowIndex * interestFactor) / 1e18;
        market.lastUpdateBlock = block.number;
    }

    function _borrowBalanceWithInterest(address user, address asset) internal view returns (uint256) {
        UserPosition storage position = userPositions[user][asset];
        Market storage market = markets[asset];

        if (position.borrowBalance == 0) {
            return 0;
        }

        // Calculate accumulated interest
        uint256 principalTimesIndex = position.borrowBalance * market.borrowIndex;
        return principalTimesIndex / position.borrowIndex;
    }
}
