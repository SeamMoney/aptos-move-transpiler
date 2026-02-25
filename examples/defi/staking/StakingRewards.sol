// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Staking Rewards - Synthetix Style
 * Tests: Staking, rewards distribution, reward rate calculations
 */
contract StakingRewards {
    // Tokens
    address public rewardsToken;
    address public stakingToken;

    // Staking state
    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;

    // Rewards state
    uint256 public rewardRate; // Rewards per second
    uint256 public rewardsDuration = 7 days;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    // User rewards tracking
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // Access control
    address public owner;
    address public rewardsDistributor;

    // Events
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event RewardAdded(uint256 reward);

    // Errors
    error Unauthorized();
    error InvalidAmount();
    error RewardPeriodNotFinished();
    error InsufficientBalance();

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }

    modifier onlyRewardsDistributor() {
        require(msg.sender == rewardsDistributor || msg.sender == owner, "Unauthorized");
        _;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    constructor(address _stakingToken, address _rewardsToken) {
        owner = msg.sender;
        rewardsDistributor = msg.sender;
        stakingToken = _stakingToken;
        rewardsToken = _rewardsToken;
    }

    // View functions

    /**
     * Get the last time rewards are applicable
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /**
     * Calculate reward per token
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }

        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalStaked
        );
    }

    /**
     * Calculate earned rewards for an account
     */
    function earned(address account) public view returns (uint256) {
        return (
            stakedBalance[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18
        ) + rewards[account];
    }

    /**
     * Get total rewards for the duration
     */
    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    // Mutative functions

    /**
     * Stake tokens
     */
    function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Invalid amount");

        totalStaked += amount;
        stakedBalance[msg.sender] += amount;

        emit Staked(msg.sender, amount);
    }

    /**
     * Stake tokens on behalf of another user
     */
    function stakeFor(address user, uint256 amount) external updateReward(user) {
        require(amount > 0, "Invalid amount");
        require(user != address(0), "Invalid user");

        totalStaked += amount;
        stakedBalance[user] += amount;

        emit Staked(user, amount);
    }

    /**
     * Withdraw staked tokens
     */
    function withdraw(uint256 amount) public updateReward(msg.sender) {
        require(amount > 0, "Invalid amount");
        require(stakedBalance[msg.sender] >= amount, "Insufficient balance");

        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * Claim rewards
     */
    function getReward() public updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];

        if (reward > 0) {
            rewards[msg.sender] = 0;
            // In real implementation: IERC20(rewardsToken).transfer(msg.sender, reward)
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * Withdraw all and claim rewards
     */
    function exit() external {
        withdraw(stakedBalance[msg.sender]);
        getReward();
    }

    // Admin functions

    /**
     * Notify contract about new reward amount
     */
    function notifyRewardAmount(uint256 reward) external onlyRewardsDistributor updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Ensure reward rate is not too high
        // uint256 balance = IERC20(rewardsToken).balanceOf(address(this));
        // require(rewardRate <= balance / rewardsDuration, "Reward too high");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;

        emit RewardAdded(reward);
    }

    /**
     * Update rewards duration (only when period finished)
     */
    function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
        require(block.timestamp > periodFinish, "Reward period not finished");
        rewardsDuration = _rewardsDuration;
        emit RewardsDurationUpdated(_rewardsDuration);
    }

    /**
     * Set rewards distributor
     */
    function setRewardsDistributor(address _rewardsDistributor) external onlyOwner {
        rewardsDistributor = _rewardsDistributor;
    }

    /**
     * Recover accidentally sent tokens (not staking or rewards token)
     */
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != stakingToken, "Cannot recover staking token");
        require(tokenAddress != rewardsToken, "Cannot recover rewards token");
        // IERC20(tokenAddress).transfer(owner, tokenAmount);
    }
}
