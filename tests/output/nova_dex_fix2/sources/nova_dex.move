module 0x1::nova_dex {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_std::bcs;
    use aptos_std::aptos_hash;
    use transpiler::evm_compat;

    // Error codes
    const PRECISION: u256 = 1000000000000000000u256;
    const MINIMUM_LIQUIDITY: u256 = 1000u256;
    const FEE_NUMERATOR: u256 = 3u256;
    const FEE_DENOMINATOR: u256 = 1000u256;
    const GOVERNANCE_QUORUM_BPS: u16 = 5000u16;
    const MAX_FLASH_FEE_BPS: u8 = 50u8;
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
    const E_POOL_NOT_ACTIVE: u64 = 256u64;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 257u64;
    const E_INSUFFICIENT_INPUT: u64 = 258u64;
    const E_ZERO_AMOUNT: u64 = 259u64;
    const E_FLASH_LOAN_NOT_REPAID: u64 = 260u64;
    const E_ZERO_TREASURY: u64 = 261u64;
    const E_ZERO_RESERVES: u64 = 262u64;
    const E_ZERO_INPUT: u64 = 263u64;
    const E_INSUFFICIENT_POSITION: u64 = 264u64;
    const E_MUST_BE_STAKER: u64 = 265u64;
    const E_VOTING_ENDED: u64 = 266u64;
    const E_NO_VOTING_POWER: u64 = 267u64;
    const E_VOTING_NOT_ENDED: u64 = 268u64;
    const E_ALREADY_EXECUTED: u64 = 269u64;
    const E_QUORUM_NOT_REACHED: u64 = 270u64;
    const E_NOT_PASSED: u64 = 271u64;
    const E_EXCEEDS_RESERVE: u64 = 272u64;
    const E_ZERO_RESERVE: u64 = 273u64;

    struct NovaDEXState has key {
        owner: address,
        treasury: address,
        pool_count: u256,
        proposal_count: u256,
        total_staked: u256,
        reward_per_token_stored: u256,
        last_update_time: u256,
        reward_rate: u256,
        pools: aptos_std::table::Table<u256, Pool>,
        staked_balance: aptos_std::table::Table<address, u256>,
        user_reward_per_token_paid: aptos_std::table::Table<address, u256>,
        rewards: aptos_std::table::Table<address, u256>,
        proposals: aptos_std::table::Table<u256, Proposal>,
        user_positions: aptos_std::table::Table<u256, aptos_std::table::Table<address, UserPosition>>,
        allowances: aptos_std::table::Table<u256, aptos_std::table::Table<address, u256>>,
        reentrancy_status: u8,
        signer_cap: account::SignerCapability
    }

    struct Pool has copy, drop, store {
        reserve0: u256,
        reserve1: u256,
        total_liquidity: u256,
        cumulative_volume: u256,
        fee_override_bps: u16,
        active: bool
    }

    struct UserPosition has copy, drop, store {
        liquidity: u256,
        reward_debt: u256,
        pending_rewards: u256
    }

    struct Proposal has copy, drop, store {
        description_hash: u256,
        for_votes: u256,
        against_votes: u256,
        deadline: u256,
        executed: bool
    }

    #[event]
    struct PoolCreated has drop, store {
        pool_id: u256,
        initial_reserve0: u256,
        initial_reserve1: u256
    }

    #[event]
    struct Swap has drop, store {
        pool_id: u256,
        sender: address,
        amount_in: u256,
        amount_out: u256
    }

    #[event]
    struct LiquidityAdded has drop, store {
        pool_id: u256,
        provider: address,
        amount0: u256,
        amount1: u256
    }

    #[event]
    struct LiquidityRemoved has drop, store {
        pool_id: u256,
        provider: address,
        liquidity: u256
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
    struct ProposalCreated has drop, store {
        proposal_id: u256,
        description_hash: u256
    }

    #[event]
    struct FlashLoan has drop, store {
        borrower: address,
        pool_id: u256,
        amount: u256,
        fee: u256
    }

    public entry fun initialize(deployer: &signer, treasury: address) {
        let (_resource_signer, signer_cap) = account::create_resource_account(deployer, b"nova_dex");
        assert!((treasury != @0x0), E_ZERO_TREASURY);
        move_to(deployer, NovaDEXState { owner: signer::address_of(deployer), treasury: treasury, pool_count: 0, proposal_count: 0, total_staked: 0, reward_per_token_stored: 0, last_update_time: 0, reward_rate: 0, pools: table::new(), staked_balance: table::new(), user_reward_per_token_paid: table::new(), rewards: table::new(), proposals: table::new(), user_positions: table::new(), allowances: table::new(), reentrancy_status: 1u8, signer_cap: signer_cap });
    }

    public fun create_pool(account: &signer, initial_reserve0: u256, initial_reserve1: u256, fee_override_bps: u16): u256 acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let pool_id = 0u256;
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        assert!(((initial_reserve0 > 0) && (initial_reserve1 > 0)), E_ZERO_RESERVES);
        pool_id = state.pool_count;
        state.pool_count += 1;
        *table::borrow_mut_with_default(&mut state.pools, pool_id, Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false }) = Pool { reserve0: initial_reserve0, reserve1: initial_reserve1, total_liquidity: sqrt((initial_reserve0 * initial_reserve1)), cumulative_volume: 0, fee_override_bps: fee_override_bps, active: true };
        event::emit(PoolCreated { pool_id: pool_id, initial_reserve0: initial_reserve0, initial_reserve1: initial_reserve1 });
        return pool_id
    }

    public fun swap(account: &signer, pool_id: u256, amount_in: u256, zero_for_one: bool): u256 acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let amount_out = 0u256;
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        assert!((amount_in > 0), E_ZERO_INPUT);
        let pool: Pool = *table::borrow_with_default(&state.pools, pool_id, &Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false });
        assert!(pool.active, E_PAUSED);
        let fee_amount: u256 = (((amount_in * (pool.fee_override_bps as u256))) / FEE_DENOMINATOR);
        let amount_in_after_fee: u256 = (amount_in - fee_amount);
        if (zero_for_one) {
            amount_out = get_amount_out(amount_in_after_fee, pool.reserve0, pool.reserve1);
            pool.reserve0 += amount_in_after_fee;
            pool.reserve1 -= amount_out;
        } else {
            amount_out = get_amount_out(amount_in_after_fee, pool.reserve1, pool.reserve0);
            pool.reserve1 += amount_in_after_fee;
            pool.reserve0 -= amount_out;
        };
        pool.cumulative_volume += amount_in;
        *table::borrow_mut_with_default(&mut state.pools, pool_id, Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false }) = pool;
        event::emit(Swap { pool_id: pool_id, sender: signer::address_of(account), amount_in: amount_in, amount_out: amount_out });
        table::upsert(&mut state.pools, pool_id, pool);
        state.reentrancy_status = 1u8;
        return amount_out
    }

    public fun add_liquidity(account: &signer, pool_id: u256, amount0: u256, amount1: u256): u256 acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let liquidity = 0u256;
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        let pool: Pool = *table::borrow_with_default(&state.pools, pool_id, &Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false });
        assert!(pool.active, E_PAUSED);
        if ((pool.total_liquidity == 0)) {
            liquidity = (sqrt((amount0 * amount1)) - MINIMUM_LIQUIDITY);
        } else {
            liquidity = min((((amount0 * pool.total_liquidity)) / pool.reserve0), (((amount1 * pool.total_liquidity)) / pool.reserve1));
        };
        assert!((liquidity > 0), E_INSUFFICIENT_LIQUIDITY);
        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.total_liquidity += liquidity;
        *table::borrow_mut_with_default(&mut state.pools, pool_id, Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false }) = pool;
        let pos: UserPosition = *table::borrow_with_default(table::borrow(&state.user_positions, pool_id), signer::address_of(account), &UserPosition { liquidity: 0u256, reward_debt: 0u256, pending_rewards: 0u256 });
        pos.liquidity += liquidity;
        if (!table::contains(&state.user_positions, pool_id)) {
            table::add(&mut state.user_positions, pool_id, table::new());
        };
        *table::borrow_mut(&mut *table::borrow_mut(&mut state.user_positions, pool_id), signer::address_of(account)) = pos;
        event::emit(LiquidityAdded { pool_id: pool_id, provider: signer::address_of(account), amount0: amount0, amount1: amount1 });
        table::upsert(&mut state.pools, pool_id, pool);
        table::upsert(table::borrow_mut(&mut state.user_positions, pool_id), signer::address_of(account), pos);
        state.reentrancy_status = 1u8;
        return liquidity
    }

    public fun remove_liquidity(account: &signer, pool_id: u256, liquidity: u256): (u256, u256) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let amount0 = 0u256;
        let amount1 = 0u256;
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        let pool: Pool = *table::borrow_with_default(&state.pools, pool_id, &Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false });
        assert!(pool.active, E_PAUSED);
        let pos: UserPosition = *table::borrow_with_default(table::borrow(&state.user_positions, pool_id), signer::address_of(account), &UserPosition { liquidity: 0u256, reward_debt: 0u256, pending_rewards: 0u256 });
        assert!((pos.liquidity >= liquidity), E_INSUFFICIENT_POSITION);
        amount0 = (((liquidity * pool.reserve0)) / pool.total_liquidity);
        amount1 = (((liquidity * pool.reserve1)) / pool.total_liquidity);
        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.total_liquidity -= liquidity;
        *table::borrow_mut_with_default(&mut state.pools, pool_id, Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false }) = pool;
        pos.liquidity -= liquidity;
        if (!table::contains(&state.user_positions, pool_id)) {
            table::add(&mut state.user_positions, pool_id, table::new());
        };
        *table::borrow_mut(&mut *table::borrow_mut(&mut state.user_positions, pool_id), signer::address_of(account)) = pos;
        event::emit(LiquidityRemoved { pool_id: pool_id, provider: signer::address_of(account), liquidity: liquidity });
        table::upsert(&mut state.pools, pool_id, pool);
        table::upsert(table::borrow_mut(&mut state.user_positions, pool_id), signer::address_of(account), pos);
        state.reentrancy_status = 1u8;
        return (amount0, amount1)
    }

    public entry fun stake(account: &signer, amount: u256) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        if ((state.total_staked > 0)) {
            state.reward_per_token_stored = (state.reward_per_token_stored + (((((((timestamp::now_seconds() as u256) - state.last_update_time)) * state.reward_rate) * PRECISION) / state.total_staked)));
        };
        state.last_update_time = (timestamp::now_seconds() as u256);
        if ((signer::address_of(account) != @0x0)) {
            let earned: u256 = ((((*table::borrow_with_default(&state.staked_balance, signer::address_of(account), &0u256) * ((state.reward_per_token_stored - *table::borrow_with_default(&state.user_reward_per_token_paid, signer::address_of(account), &0u256)))) / PRECISION)) + *table::borrow_with_default(&state.rewards, signer::address_of(account), &0u256));
            *table::borrow_mut_with_default(&mut state.rewards, signer::address_of(account), 0u256) = earned;
            *table::borrow_mut_with_default(&mut state.user_reward_per_token_paid, signer::address_of(account), 0u256) = state.reward_per_token_stored;
        };
        assert!((amount > 0), E_INVALID_AMOUNT);
        state.total_staked += amount;
        *table::borrow_mut_with_default(&mut state.staked_balance, signer::address_of(account), 0u256) += amount;
        event::emit(Staked { user: signer::address_of(account), amount: amount });
    }

    public entry fun withdraw(account: &signer, amount: u256) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        if ((state.total_staked > 0)) {
            state.reward_per_token_stored = (state.reward_per_token_stored + (((((((timestamp::now_seconds() as u256) - state.last_update_time)) * state.reward_rate) * PRECISION) / state.total_staked)));
        };
        state.last_update_time = (timestamp::now_seconds() as u256);
        if ((signer::address_of(account) != @0x0)) {
            let earned: u256 = ((((*table::borrow_with_default(&state.staked_balance, signer::address_of(account), &0u256) * ((state.reward_per_token_stored - *table::borrow_with_default(&state.user_reward_per_token_paid, signer::address_of(account), &0u256)))) / PRECISION)) + *table::borrow_with_default(&state.rewards, signer::address_of(account), &0u256));
            *table::borrow_mut_with_default(&mut state.rewards, signer::address_of(account), 0u256) = earned;
            *table::borrow_mut_with_default(&mut state.user_reward_per_token_paid, signer::address_of(account), 0u256) = state.reward_per_token_stored;
        };
        assert!((amount > 0), E_INVALID_AMOUNT);
        state.total_staked -= amount;
        *table::borrow_mut_with_default(&mut state.staked_balance, signer::address_of(account), 0u256) -= amount;
        event::emit(Withdrawn { user: signer::address_of(account), amount: amount });
    }

    public entry fun claim_reward(account: &signer) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        if ((state.total_staked > 0)) {
            state.reward_per_token_stored = (state.reward_per_token_stored + (((((((timestamp::now_seconds() as u256) - state.last_update_time)) * state.reward_rate) * PRECISION) / state.total_staked)));
        };
        state.last_update_time = (timestamp::now_seconds() as u256);
        if ((signer::address_of(account) != @0x0)) {
            let earned: u256 = ((((*table::borrow_with_default(&state.staked_balance, signer::address_of(account), &0u256) * ((state.reward_per_token_stored - *table::borrow_with_default(&state.user_reward_per_token_paid, signer::address_of(account), &0u256)))) / PRECISION)) + *table::borrow_with_default(&state.rewards, signer::address_of(account), &0u256));
            *table::borrow_mut_with_default(&mut state.rewards, signer::address_of(account), 0u256) = earned;
            *table::borrow_mut_with_default(&mut state.user_reward_per_token_paid, signer::address_of(account), 0u256) = state.reward_per_token_stored;
        };
        let reward: u256 = *table::borrow_with_default(&state.rewards, signer::address_of(account), &0u256);
        if ((reward > 0)) {
            *table::borrow_mut_with_default(&mut state.rewards, signer::address_of(account), 0u256) = 0;
            event::emit(RewardPaid { user: signer::address_of(account), reward: reward });
        };
    }

    public fun create_proposal(account: &signer, description: std::string::String): u256 acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let proposal_id = 0u256;
        assert!((*table::borrow_with_default(&state.staked_balance, signer::address_of(account), &0u256) > 0), E_MUST_BE_STAKER);
        proposal_id = state.proposal_count;
        state.proposal_count += 1;
        let desc_hash: u256 = evm_compat::bytes_to_u256(aptos_hash::keccak256(bcs::to_bytes(&description)));
        *table::borrow_mut_with_default(&mut state.proposals, proposal_id, Proposal { description_hash: 0u256, for_votes: 0u256, against_votes: 0u256, deadline: 0u256, executed: false }) = Proposal { description_hash: desc_hash, for_votes: 0, against_votes: 0, deadline: ((timestamp::now_seconds() as u256) + 7), executed: false };
        event::emit(ProposalCreated { proposal_id: proposal_id, description_hash: desc_hash });
        return proposal_id
    }

    public entry fun vote(account: &signer, proposal_id: u256, support: bool) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let proposal: Proposal = *table::borrow_with_default(&state.proposals, proposal_id, &Proposal { description_hash: 0u256, for_votes: 0u256, against_votes: 0u256, deadline: 0u256, executed: false });
        assert!(((timestamp::now_seconds() as u256) < proposal.deadline), E_VOTING_ENDED);
        let weight: u256 = *table::borrow_with_default(&state.staked_balance, signer::address_of(account), &0u256);
        assert!((weight > 0), E_NO_VOTING_POWER);
        if (support) {
            proposal.for_votes += weight;
        } else {
            proposal.against_votes += weight;
        };
        *table::borrow_mut_with_default(&mut state.proposals, proposal_id, Proposal { description_hash: 0u256, for_votes: 0u256, against_votes: 0u256, deadline: 0u256, executed: false }) = proposal;
        table::upsert(&mut state.proposals, proposal_id, proposal);
    }

    public entry fun execute_proposal(account: &signer, proposal_id: u256) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        let proposal: Proposal = *table::borrow_with_default(&state.proposals, proposal_id, &Proposal { description_hash: 0u256, for_votes: 0u256, against_votes: 0u256, deadline: 0u256, executed: false });
        assert!(((timestamp::now_seconds() as u256) >= proposal.deadline), E_VOTING_NOT_ENDED);
        assert!(!proposal.executed, E_ALREADY_EXECUTED);
        let total_votes: u256 = (proposal.for_votes + proposal.against_votes);
        assert!(((total_votes * 10000) >= (state.total_staked * (GOVERNANCE_QUORUM_BPS as u256))), E_QUORUM_NOT_REACHED);
        assert!((proposal.for_votes > proposal.against_votes), E_NOT_PASSED);
        proposal.executed = true;
        *table::borrow_mut_with_default(&mut state.proposals, proposal_id, Proposal { description_hash: 0u256, for_votes: 0u256, against_votes: 0u256, deadline: 0u256, executed: false }) = proposal;
        table::upsert(&mut state.proposals, proposal_id, proposal);
    }

    public entry fun flash_loan(account: &signer, pool_id: u256, amount: u256, is_token0: bool) acquires NovaDEXState {
        let state = borrow_global_mut<NovaDEXState>(@0x1);
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        let pool: Pool = *table::borrow_with_default(&state.pools, pool_id, &Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false });
        assert!(pool.active, E_PAUSED);
        let reserve_before: u256;
        if (is_token0) {
            reserve_before = pool.reserve0;
            assert!((amount <= reserve_before), E_EXCEEDS_RESERVE);
        } else {
            reserve_before = pool.reserve1;
            assert!((amount <= reserve_before), E_EXCEEDS_RESERVE);
        };
        let fee: u256 = (((amount * (MAX_FLASH_FEE_BPS as u256))) / 10000);
        let pool_after: Pool = *table::borrow_with_default(&state.pools, pool_id, &Pool { reserve0: 0u256, reserve1: 0u256, total_liquidity: 0u256, cumulative_volume: 0u256, fee_override_bps: 0u16, active: false });
        if (is_token0) {
            assert!((pool_after.reserve0 >= (reserve_before + fee)), E_FLASH_LOAN_NOT_REPAID);
        } else {
            assert!((pool_after.reserve1 >= (reserve_before + fee)), E_FLASH_LOAN_NOT_REPAID);
        };
        event::emit(FlashLoan { borrower: signer::address_of(account), pool_id: pool_id, amount: amount, fee: fee });
        state.reentrancy_status = 1u8;
    }

    public fun get_amount_out(amount_in: u256, reserve_in: u256, reserve_out: u256): u256 {
        assert!((amount_in > 0), E_ZERO_INPUT);
        assert!(((reserve_in > 0) && (reserve_out > 0)), E_ZERO_RESERVE);
        let amount_in_with_fee: u256 = (amount_in * ((FEE_DENOMINATOR - FEE_NUMERATOR)));
        let numerator: u256 = (amount_in_with_fee * reserve_out);
        let denominator: u256 = (((reserve_in * FEE_DENOMINATOR)) + amount_in_with_fee);
        return (numerator / denominator)
    }

    public fun compute_fees_owed(volume: u256, fee_rate: u256, duration: u256): u256 {
        return ((((volume * fee_rate) * duration)) / ((PRECISION * FEE_DENOMINATOR)))
    }

    public fun get_pool_value(reserve0: u256, reserve1: u256, price0: u256, price1: u256): u256 {
        return ((((reserve0 * price0) + (reserve1 * price1))) / PRECISION)
    }

    #[view]
    public fun reward_per_token(): u256 acquires NovaDEXState {
        let state = borrow_global<NovaDEXState>(@0x1);
        if ((state.total_staked == 0)) {
            return state.reward_per_token_stored
        };
        return (state.reward_per_token_stored + (((((((timestamp::now_seconds() as u256) - state.last_update_time)) * state.reward_rate) * PRECISION) / state.total_staked)))
    }

    #[view]
    public fun earned(account: address): u256 acquires NovaDEXState {
        let state = borrow_global<NovaDEXState>(@0x1);
        let current_reward_per_token: u256;
        if ((state.total_staked == 0)) {
            current_reward_per_token = state.reward_per_token_stored;
        } else {
            current_reward_per_token = (state.reward_per_token_stored + (((((((timestamp::now_seconds() as u256) - state.last_update_time)) * state.reward_rate) * PRECISION) / state.total_staked)));
        };
        return ((((*table::borrow_with_default(&state.staked_balance, account, &0u256) * ((current_reward_per_token - *table::borrow_with_default(&state.user_reward_per_token_paid, account, &0u256)))) / PRECISION)) + *table::borrow_with_default(&state.rewards, account, &0u256))
    }

    public(package) fun sqrt(y: u256): u256 {
        let z = 0u256;
        if ((y > 3)) {
            z = y;
            let x: u256 = ((y / 2) + 1);
            while ((x < z)) {
                z = x;
                x = ((((y / x) + x)) / 2);
            }
        } else {
            if ((y != 0)) {
                z = 1;
            };
        };
        return z
    }

    public(package) fun min(a: u256, b: u256): u256 {
        return (if ((a < b)) a else b)
    }
}