// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * NovaDEX - Complex DeFi AMM with Staking, Governance, and Flash Loans
 * Exercises all 6 compilation bugs:
 *   1. Pure functions referencing constants (PRECISION, MINIMUM_LIQUIDITY)
 *   2. Error codes from constructor (E_ZERO_TREASURY)
 *   3. keccak256 returning bytes32 → u256
 *   4. Nested mappings (mapping of mapping)
 *   5. Arithmetic type mismatches (uint256 - uint16, uint256 - uint8)
 *   6. Copy mutation (local struct from mapping, mutate fields, must write back)
 */
contract NovaDEX {
    // ─── Constants (Bug #1: must not count as "state") ───
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant FEE_NUMERATOR = 3;
    uint256 public constant FEE_DENOMINATOR = 1000;
    uint16 public constant GOVERNANCE_QUORUM_BPS = 5000; // 50%
    uint8 public constant MAX_FLASH_FEE_BPS = 50;

    // ─── Structs ───
    struct Pool {
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 cumulativeVolume;
        uint16 feeOverrideBps;
        bool active;
    }

    struct UserPosition {
        uint256 liquidity;
        uint256 rewardDebt;
        uint256 pendingRewards;
    }

    struct Proposal {
        bytes32 descriptionHash;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
    }

    // ─── State variables ───
    address public owner;
    address public treasury;
    uint256 public poolCount;
    uint256 public proposalCount;
    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;
    uint256 public rewardRate;

    // Reentrancy guard
    uint256 private reentrancyStatus;

    // Simple mappings
    mapping(uint256 => Pool) public pools;
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(uint256 => Proposal) public proposals;

    // Nested mappings (Bug #4)
    mapping(uint256 => mapping(address => UserPosition)) public userPositions;
    mapping(uint256 => mapping(address => uint256)) public allowances;

    // ─── Events ───
    event PoolCreated(uint256 indexed poolId, uint256 initialReserve0, uint256 initialReserve1);
    event Swap(uint256 indexed poolId, address indexed sender, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(uint256 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1);
    event LiquidityRemoved(uint256 indexed poolId, address indexed provider, uint256 liquidity);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event ProposalCreated(uint256 indexed proposalId, bytes32 descriptionHash);
    event FlashLoan(address indexed borrower, uint256 indexed poolId, uint256 amount, uint256 fee);

    // ─── Errors ───
    error Unauthorized();
    error PoolNotActive();
    error InsufficientLiquidity();
    error InsufficientInput();
    error ZeroAmount();
    error FlashLoanNotRepaid();

    // ─── Modifiers ───
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(reentrancyStatus != 2, "Reentrancy");
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    modifier updateReward(address account) {
        // Inline reward computation to avoid re-entrant borrow in Move
        if (totalStaked > 0) {
            rewardPerTokenStored = rewardPerTokenStored + (
                (block.timestamp - lastUpdateTime) * rewardRate * PRECISION / totalStaked
            );
        }
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
            uint256 _earned = (
                stakedBalance[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account]) / PRECISION
            ) + rewards[account];
            rewards[account] = _earned;
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ─── Constructor (Bug #2: error codes must be initialized) ───
    constructor(address _treasury) {
        require(_treasury != address(0), "Zero treasury");
        owner = msg.sender;
        treasury = _treasury;
        reentrancyStatus = 1;
    }

    // ─── Pool Management ───
    function createPool(
        uint256 initialReserve0,
        uint256 initialReserve1,
        uint16 feeOverrideBps
    ) external onlyOwner returns (uint256 poolId) {
        require(initialReserve0 > 0 && initialReserve1 > 0, "Zero reserves");

        poolId = poolCount;
        poolCount += 1;

        pools[poolId] = Pool({
            reserve0: initialReserve0,
            reserve1: initialReserve1,
            totalLiquidity: sqrt(initialReserve0 * initialReserve1),
            cumulativeVolume: 0,
            feeOverrideBps: feeOverrideBps,
            active: true
        });

        emit PoolCreated(poolId, initialReserve0, initialReserve1);
    }

    // ─── AMM Swap (Bug #5: arithmetic type mismatch + Bug #6: copy mutation) ───
    function swap(
        uint256 poolId,
        uint256 amountIn,
        bool zeroForOne
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Zero input");

        // Bug #6: local copy from mapping → must write back
        Pool memory pool = pools[poolId];
        require(pool.active, "Pool not active");

        // Bug #5: pool.feeOverrideBps is uint16, PRECISION is uint256
        uint256 feeAmount = (amountIn * pool.feeOverrideBps) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - feeAmount;

        if (zeroForOne) {
            amountOut = getAmountOut(amountInAfterFee, pool.reserve0, pool.reserve1);
            pool.reserve0 += amountInAfterFee;
            pool.reserve1 -= amountOut;
        } else {
            amountOut = getAmountOut(amountInAfterFee, pool.reserve1, pool.reserve0);
            pool.reserve1 += amountInAfterFee;
            pool.reserve0 -= amountOut;
        }

        pool.cumulativeVolume += amountIn;

        // Write back
        pools[poolId] = pool;

        emit Swap(poolId, msg.sender, amountIn, amountOut);
    }

    // ─── Liquidity (Bug #4: nested mapping + Bug #6: copy mutation) ───
    function addLiquidity(
        uint256 poolId,
        uint256 amount0,
        uint256 amount1
    ) external nonReentrant returns (uint256 liquidity) {
        Pool memory pool = pools[poolId];
        require(pool.active, "Pool not active");

        if (pool.totalLiquidity == 0) {
            liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
        } else {
            liquidity = min(
                (amount0 * pool.totalLiquidity) / pool.reserve0,
                (amount1 * pool.totalLiquidity) / pool.reserve1
            );
        }

        require(liquidity > 0, "Insufficient liquidity");

        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.totalLiquidity += liquidity;
        pools[poolId] = pool;

        // Bug #4: nested mapping write
        UserPosition memory pos = userPositions[poolId][msg.sender];
        pos.liquidity += liquidity;
        userPositions[poolId][msg.sender] = pos;

        emit LiquidityAdded(poolId, msg.sender, amount0, amount1);
    }

    function removeLiquidity(
        uint256 poolId,
        uint256 liquidity
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Pool memory pool = pools[poolId];
        require(pool.active, "Pool not active");

        UserPosition memory pos = userPositions[poolId][msg.sender];
        require(pos.liquidity >= liquidity, "Insufficient position");

        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;

        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.totalLiquidity -= liquidity;
        pools[poolId] = pool;

        pos.liquidity -= liquidity;
        userPositions[poolId][msg.sender] = pos;

        emit LiquidityRemoved(poolId, msg.sender, liquidity);
    }

    // ─── Staking ───
    function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Zero amount");
        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Zero amount");
        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            emit RewardPaid(msg.sender, reward);
        }
    }

    // ─── Governance (Bug #3: keccak256) ───
    function createProposal(string calldata description) external returns (uint256 proposalId) {
        require(stakedBalance[msg.sender] > 0, "Must be staker");

        proposalId = proposalCount;
        proposalCount += 1;

        // Bug #3: keccak256 returns bytes32 → stored as u256
        bytes32 descHash = keccak256(abi.encodePacked(description));

        proposals[proposalId] = Proposal({
            descriptionHash: descHash,
            forVotes: 0,
            againstVotes: 0,
            deadline: block.timestamp + 7 days,
            executed: false
        });

        emit ProposalCreated(proposalId, descHash);
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal memory proposal = proposals[proposalId];
        require(block.timestamp < proposal.deadline, "Voting ended");

        uint256 weight = stakedBalance[msg.sender];
        require(weight > 0, "No voting power");

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        proposals[proposalId] = proposal;
    }

    function executeProposal(uint256 proposalId) external {
        Proposal memory proposal = proposals[proposalId];
        require(block.timestamp >= proposal.deadline, "Voting not ended");
        require(!proposal.executed, "Already executed");

        // Bug #5: GOVERNANCE_QUORUM_BPS is uint16
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        require(totalVotes * 10000 >= totalStaked * GOVERNANCE_QUORUM_BPS, "Quorum not reached");
        require(proposal.forVotes > proposal.againstVotes, "Not passed");

        proposal.executed = true;
        proposals[proposalId] = proposal;
    }

    // ─── Flash Loans ───
    function flashLoan(
        uint256 poolId,
        uint256 amount,
        bool isToken0
    ) external nonReentrant {
        Pool memory pool = pools[poolId];
        require(pool.active, "Pool not active");

        uint256 reserveBefore;
        if (isToken0) {
            reserveBefore = pool.reserve0;
            require(amount <= reserveBefore, "Exceeds reserve");
        } else {
            reserveBefore = pool.reserve1;
            require(amount <= reserveBefore, "Exceeds reserve");
        }

        // Bug #5: MAX_FLASH_FEE_BPS is uint8
        uint256 fee = (amount * MAX_FLASH_FEE_BPS) / 10000;

        // After callback, check repayment
        // In real implementation, this would call borrower
        Pool memory poolAfter = pools[poolId];
        if (isToken0) {
            require(poolAfter.reserve0 >= reserveBefore + fee, "Flash loan not repaid");
        } else {
            require(poolAfter.reserve1 >= reserveBefore + fee, "Flash loan not repaid");
        }

        emit FlashLoan(msg.sender, poolId, amount, fee);
    }

    // ─── Pure/View Functions (Bug #1: reference constants, must not get state param) ───
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        require(amountIn > 0, "Zero input");
        require(reserveIn > 0 && reserveOut > 0, "Zero reserve");

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_NUMERATOR);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DENOMINATOR) + amountInWithFee;

        return numerator / denominator;
    }

    function computeFeesOwed(
        uint256 volume,
        uint256 feeRate,
        uint256 duration
    ) public pure returns (uint256) {
        return (volume * feeRate * duration) / (PRECISION * FEE_DENOMINATOR);
    }

    function getPoolValue(
        uint256 reserve0,
        uint256 reserve1,
        uint256 price0,
        uint256 price1
    ) public pure returns (uint256) {
        return (reserve0 * price0 + reserve1 * price1) / PRECISION;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + (
            (block.timestamp - lastUpdateTime) * rewardRate * PRECISION / totalStaked
        );
    }

    function earned(address account) public view returns (uint256) {
        uint256 currentRewardPerToken;
        if (totalStaked == 0) {
            currentRewardPerToken = rewardPerTokenStored;
        } else {
            currentRewardPerToken = rewardPerTokenStored + (
                (block.timestamp - lastUpdateTime) * rewardRate * PRECISION / totalStaked
            );
        }
        return (
            stakedBalance[account] * (currentRewardPerToken - userRewardPerTokenPaid[account]) / PRECISION
        ) + rewards[account];
    }

    // ─── Internal helpers ───
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
