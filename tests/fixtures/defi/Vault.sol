// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Yield Vault - Yearn V2 Style
 * Tests: Share calculations, deposits, withdrawals, strategies, fees
 */
contract Vault {
    // Vault token (shares)
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    // Underlying asset
    address public asset;

    // Share accounting
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Vault configuration
    uint256 public depositLimit;
    uint256 public totalDebt; // Total borrowed by strategies
    uint256 public lastReport; // Timestamp of last harvest
    uint256 public lockedProfit; // Profit locked for gradual release
    uint256 public lockedProfitDegradation; // Rate of profit release

    // Fees (in basis points, 10000 = 100%)
    uint256 public performanceFee = 1000; // 10%
    uint256 public managementFee = 200; // 2%
    uint256 public constant MAX_BPS = 10000;

    // Roles
    address public governance;
    address public management;
    address public guardian;

    // Strategy management
    struct StrategyParams {
        uint256 activation; // Block when strategy was added
        uint256 debtRatio; // Maximum share of total assets (in BPS)
        uint256 minDebtPerHarvest;
        uint256 maxDebtPerHarvest;
        uint256 lastReport;
        uint256 totalDebt;
        uint256 totalGain;
        uint256 totalLoss;
    }

    mapping(address => StrategyParams) public strategies;
    address[] public withdrawalQueue;
    uint256 public debtRatio; // Sum of all strategy debt ratios

    // Emergency state
    bool public emergencyShutdown;

    // Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event StrategyAdded(address indexed strategy, uint256 debtRatio);
    event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 totalGain, uint256 totalLoss);
    event EmergencyShutdown(bool active);

    // Errors
    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error DepositLimitExceeded();
    error InsufficientBalance();
    error StrategyAlreadyActive();
    error StrategyNotActive();
    error EmergencyShutdownActive();
    error InvalidDebtRatio();

    modifier onlyGovernance() {
        require(msg.sender == governance, "Unauthorized");
        _;
    }

    modifier onlyManagement() {
        require(msg.sender == management || msg.sender == governance, "Unauthorized");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian || msg.sender == governance, "Unauthorized");
        _;
    }

    modifier notShutdown() {
        require(!emergencyShutdown, "Emergency shutdown active");
        _;
    }

    constructor(
        address _asset,
        string memory _name,
        string memory _symbol
    ) {
        asset = _asset;
        name = _name;
        symbol = _symbol;
        governance = msg.sender;
        management = msg.sender;
        guardian = msg.sender;
        depositLimit = type(uint256).max;
        lockedProfitDegradation = 46e18 / uint256(6 hours); // 6 hour release
        lastReport = block.timestamp;
    }

    // ERC20 functions

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        return _transfer(from, to, amount);
    }

    // ERC4626-style vault functions

    /**
     * Total assets under management
     */
    function totalAssets() public view returns (uint256) {
        return _totalAssets();
    }

    /**
     * Convert assets to shares
     */
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            return assets;
        }
        return (assets * _totalSupply) / _totalAssets();
    }

    /**
     * Convert shares to assets
     */
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            return shares;
        }
        return (shares * _totalAssets()) / _totalSupply;
    }

    /**
     * Maximum deposit for a user
     */
    function maxDeposit(address) public view returns (uint256) {
        if (emergencyShutdown) {
            return 0;
        }
        uint256 total = _totalAssets();
        if (total >= depositLimit) {
            return 0;
        }
        return depositLimit - total;
    }

    /**
     * Preview deposit
     */
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /**
     * Preview withdrawal
     */
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            return assets;
        }
        uint256 shares = (assets * _totalSupply + _totalAssets() - 1) / _totalAssets();
        return shares;
    }

    /**
     * Deposit assets for shares
     */
    function deposit(uint256 assets, address receiver) external notShutdown returns (uint256 shares) {
        require(assets > 0, "Zero amount");
        require(assets <= maxDeposit(receiver), "Deposit limit exceeded");

        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares");

        // Transfer assets in (simplified)
        // IERC20(asset).transferFrom(msg.sender, address(this), assets);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * Mint exact shares
     */
    function mint(uint256 shares, address receiver) external notShutdown returns (uint256 assets) {
        require(shares > 0, "Zero amount");

        assets = convertToAssets(shares);
        require(assets <= maxDeposit(receiver), "Deposit limit exceeded");

        // Transfer assets in (simplified)
        // IERC20(asset).transferFrom(msg.sender, address(this), assets);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * Withdraw assets
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares) {
        shares = previewWithdraw(assets);

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                allowance[owner][msg.sender] = allowed - shares;
            }
        }

        _burn(owner, shares);

        // Withdraw from strategies if needed
        _withdrawFromStrategies(assets);

        // Transfer assets out (simplified)
        // IERC20(asset).transfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * Redeem shares for assets
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets) {
        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                allowance[owner][msg.sender] = allowed - shares;
            }
        }

        assets = convertToAssets(shares);
        require(assets > 0, "Zero assets");

        _burn(owner, shares);

        _withdrawFromStrategies(assets);

        // Transfer assets out (simplified)
        // IERC20(asset).transfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // Strategy management

    /**
     * Add a new strategy
     */
    function addStrategy(
        address strategy,
        uint256 _debtRatio,
        uint256 minDebtPerHarvest,
        uint256 maxDebtPerHarvest
    ) external onlyGovernance {
        require(strategies[strategy].activation == 0, "Strategy already active");
        require(debtRatio + _debtRatio <= MAX_BPS, "Invalid debt ratio");

        strategies[strategy] = StrategyParams({
            activation: block.timestamp,
            debtRatio: _debtRatio,
            minDebtPerHarvest: minDebtPerHarvest,
            maxDebtPerHarvest: maxDebtPerHarvest,
            lastReport: block.timestamp,
            totalDebt: 0,
            totalGain: 0,
            totalLoss: 0
        });

        debtRatio += _debtRatio;
        withdrawalQueue.push(strategy);

        emit StrategyAdded(strategy, _debtRatio);
    }

    /**
     * Report strategy returns (called by strategy)
     */
    function report(uint256 gain, uint256 loss) external returns (uint256 debt) {
        StrategyParams storage params = strategies[msg.sender];
        require(params.activation > 0, "Strategy not active");

        // Calculate credit/debit
        uint256 totalAvailable = _totalAssets();
        uint256 credit = (totalAvailable * params.debtRatio) / MAX_BPS;

        if (credit > params.totalDebt) {
            debt = credit - params.totalDebt;
        }

        // Update strategy params
        if (gain > 0) {
            params.totalGain += gain;
            lockedProfit += gain;
        }

        if (loss > 0) {
            params.totalLoss += loss;
            if (params.totalDebt >= loss) {
                params.totalDebt -= loss;
                totalDebt -= loss;
            }
        }

        params.lastReport = block.timestamp;
        lastReport = block.timestamp;

        emit StrategyReported(msg.sender, gain, loss, params.totalGain, params.totalLoss);
    }

    // Emergency functions

    /**
     * Activate emergency shutdown
     */
    function setEmergencyShutdown(bool active) external onlyGuardian {
        emergencyShutdown = active;
        emit EmergencyShutdown(active);
    }

    // Internal functions

    function _totalAssets() internal view returns (uint256) {
        // Vault balance + total debt to strategies - locked profit still releasing
        uint256 _lockedProfit = _calculateLockedProfit();
        return totalDebt + _freeAssets() - _lockedProfit;
    }

    function _freeAssets() internal view returns (uint256) {
        // In real implementation: IERC20(asset).balanceOf(address(this))
        return 0; // Simplified
    }

    function _calculateLockedProfit() internal view returns (uint256) {
        uint256 lockedFundsRatio = (block.timestamp - lastReport) * lockedProfitDegradation;

        if (lockedFundsRatio >= 1e18) {
            return 0;
        }

        return lockedProfit - (lockedProfit * lockedFundsRatio) / 1e18;
    }

    function _withdrawFromStrategies(uint256 amount) internal {
        // In real implementation, iterate through withdrawal queue
        // and withdraw from strategies as needed
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
