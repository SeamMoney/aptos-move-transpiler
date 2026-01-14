module 0x1::staking_rewards {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::event;
    use aptos_framework::timestamp;

    // Error codes
    const E_REVERT: u64 = 0u64;
    const E_REQUIRE_FAILED: u64 = 1u64;
    const E_ASSERT_FAILED: u64 = 1u64;
    const E_UNAUTHORIZED: u64 = 2u64;
    const E_INVALID_ARGUMENT: u64 = 3u64;
    const E_INSUFFICIENT_BALANCE: u64 = 4u64;
    const E_REENTRANCY: u64 = 5u64;
    const E_PAUSED: u64 = 6u64;
    const E_NOT_PAUSED: u64 = 7u64;
    const E_ALREADY_EXISTS: u64 = 8u64;
    const E_NOT_FOUND: u64 = 9u64;
    const E_EXPIRED: u64 = 10u64;
    const E_LOCKED: u64 = 11u64;
    const E_INVALID_ADDRESS: u64 = 12u64;
    const E_INVALID_AMOUNT: u64 = 13u64;
    const E_TRANSFER_FAILED: u64 = 14u64;
    const E_INSUFFICIENT_ALLOWANCE: u64 = 15u64;
    const E_OVERFLOW: u64 = 17u64;
    const E_UNDERFLOW: u64 = 18u64;
    const E_DIVISION_BY_ZERO: u64 = 18u64;
    const E_REWARD_PERIOD_NOT_FINISHED: u64 = 256u64;
    const E_INVALID_USER: u64 = 257u64;
    const E_CANNOT_RECOVER_STAKING_TOKEN: u64 = 258u64;
    const E_CANNOT_RECOVER_REWARDS_TOKEN: u64 = 259u64;

    struct StakingRewardsState has key {
        rewards_token: address,
        staking_token: address,
        total_staked: u256,
        staked_balance: aptos_std::table::Table<address, u256>,
        reward_rate: u256,
        rewards_duration: u256,
        period_finish: u256,
        last_update_time: u256,
        reward_per_token_stored: u256,
        user_reward_per_token_paid: aptos_std::table::Table<address, u256>,
        rewards: aptos_std::table::Table<address, u256>,
        owner: address,
        rewards_distributor: address
    }

    #[event]
    struct Staked has drop, store {
        user: address,
        amount: u256
    }

    #[event]
    struct Withdrawn has drop, store {
        user: address,
        amount: u256
    }

    #[event]
    struct RewardPaid has drop, store {
        user: address,
        reward: u256
    }

    #[event]
    struct RewardsDurationUpdated has drop, store {
        new_duration: u256
    }

    #[event]
    struct RewardAdded has drop, store {
        reward: u256
    }

    public entry fun initialize(deployer: &signer, staking_token: address, rewards_token: address) {
        move_to(deployer, StakingRewardsState { rewards_token: rewards_token, staking_token: staking_token, total_staked: 0, staked_balance: table::new(), reward_rate: 0, rewards_duration: 0, period_finish: 0, last_update_time: 0, reward_per_token_stored: 0, user_reward_per_token_paid: table::new(), rewards: table::new(), owner: signer::address_of(deployer), rewards_distributor: signer::address_of(deployer) });
    }

    #[view]
    public fun last_time_reward_applicable(): u256 acquires StakingRewardsState {
        let state = borrow_global<StakingRewardsState>(@0x1);
        if ((timestamp::now_seconds() < state.period_finish)) timestamp::now_seconds() else state.period_finish
    }

    #[view]
    public fun reward_per_token(): u256 acquires StakingRewardsState {
        let state = borrow_global<StakingRewardsState>(@0x1);
        if ((state.total_staked == 0u256)) {
            state.reward_per_token_stored
        };
        (state.reward_per_token_stored + ((((((last_time_reward_applicable() - state.last_update_time)) * state.reward_rate) * 1000000000000000000u256) / state.total_staked)))
    }

    #[view]
    public fun earned(account: address): u256 {
        ((((*table::borrow(&state.staked_balance, account) * ((reward_per_token() - *table::borrow(&state.user_reward_per_token_paid, account)))) / 1000000000000000000u256)) + *table::borrow(&state.rewards, account))
    }

    #[view]
    public fun get_reward_for_duration(): u256 acquires StakingRewardsState {
        let state = borrow_global<StakingRewardsState>(@0x1);
        (state.reward_rate * state.rewards_duration)
    }

    public entry fun stake(account: &signer, amount: u256) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        state.reward_per_token_stored = reward_per_token();
        state.last_update_time = last_time_reward_applicable();
        if ((account != @0x0)) {
            *table::borrow_mut(&mut state.rewards, account) = earned(account);
            *table::borrow_mut(&mut state.user_reward_per_token_paid, account) = state.reward_per_token_stored;
        };
        assert!((amount > 0u256), E_INVALID_AMOUNT);
        state.total_staked += amount;
        *table::borrow_mut(&mut state.staked_balance, signer::address_of(account)) += amount;
        event::emit(Staked { user: signer::address_of(account), amount: amount });
    }

    public entry fun stake_for(account: &signer, user: address, amount: u256) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        state.reward_per_token_stored = reward_per_token();
        state.last_update_time = last_time_reward_applicable();
        if ((account != @0x0)) {
            *table::borrow_mut(&mut state.rewards, account) = earned(account);
            *table::borrow_mut(&mut state.user_reward_per_token_paid, account) = state.reward_per_token_stored;
        };
        assert!((amount > 0u256), E_INVALID_AMOUNT);
        assert!((user != @0x0), E_INVALID_USER);
        state.total_staked += amount;
        *table::borrow_mut(&mut state.staked_balance, user) += amount;
        event::emit(Staked { user: user, amount: amount });
    }

    public entry fun withdraw(account: &signer, amount: u256) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        state.reward_per_token_stored = reward_per_token();
        state.last_update_time = last_time_reward_applicable();
        if ((account != @0x0)) {
            *table::borrow_mut(&mut state.rewards, account) = earned(account);
            *table::borrow_mut(&mut state.user_reward_per_token_paid, account) = state.reward_per_token_stored;
        };
        assert!((amount > 0u256), E_INVALID_AMOUNT);
        assert!((*table::borrow(&state.staked_balance, signer::address_of(account)) >= amount), E_INSUFFICIENT_BALANCE);
        state.total_staked -= amount;
        *table::borrow_mut(&mut state.staked_balance, signer::address_of(account)) -= amount;
        event::emit(Withdrawn { user: signer::address_of(account), amount: amount });
    }

    public entry fun get_reward(account: &signer) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        state.reward_per_token_stored = reward_per_token();
        state.last_update_time = last_time_reward_applicable();
        if ((account != @0x0)) {
            *table::borrow_mut(&mut state.rewards, account) = earned(account);
            *table::borrow_mut(&mut state.user_reward_per_token_paid, account) = state.reward_per_token_stored;
        };
        let reward: u256 = *table::borrow(&state.rewards, signer::address_of(account));
        if ((reward > 0u256)) {
            *table::borrow_mut(&mut state.rewards, signer::address_of(account)) = 0u256;
            event::emit(RewardPaid { user: signer::address_of(account), reward: reward });
        };
    }

    public entry fun exit(account: &signer) {
        withdraw(*table::borrow(&state.staked_balance, signer::address_of(account)));
        get_reward();
    }

    public entry fun notify_reward_amount(account: &signer, reward: u256) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        assert!(((signer::address_of(account) == state.rewards_distributor) || (signer::address_of(account) == state.owner)), E_UNAUTHORIZED);
        state.reward_per_token_stored = reward_per_token();
        state.last_update_time = last_time_reward_applicable();
        if ((account != @0x0)) {
            *table::borrow_mut(&mut state.rewards, account) = earned(account);
            *table::borrow_mut(&mut state.user_reward_per_token_paid, account) = state.reward_per_token_stored;
        };
        if ((timestamp::now_seconds() >= state.period_finish)) {
            state.reward_rate = (reward / state.rewards_duration);
        } else {
            let remaining: u256 = (state.period_finish - timestamp::now_seconds());
            let leftover: u256 = (remaining * state.reward_rate);
            state.reward_rate = (((reward + leftover)) / state.rewards_duration);
        };
        state.last_update_time = timestamp::now_seconds();
        state.period_finish = (timestamp::now_seconds() + state.rewards_duration);
        event::emit(RewardAdded { reward: reward });
    }

    public entry fun set_rewards_duration(account: &signer, rewards_duration: u256) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        assert!((timestamp::now_seconds() > state.period_finish), E_REWARD_PERIOD_NOT_FINISHED);
        state.rewards_duration = rewards_duration;
        event::emit(RewardsDurationUpdated { new_duration: rewards_duration });
    }

    public entry fun set_rewards_distributor(account: &signer, rewards_distributor: address) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        state.rewards_distributor = rewards_distributor;
    }

    public entry fun recover_e_r_c20(account: &signer, token_address: address, token_amount: u256) acquires StakingRewardsState {
        let state = borrow_global_mut<StakingRewardsState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        assert!((token_address != state.staking_token), E_CANNOT_RECOVER_STAKING_TOKEN);
        assert!((token_address != state.rewards_token), E_CANNOT_RECOVER_REWARDS_TOKEN);
    }
}