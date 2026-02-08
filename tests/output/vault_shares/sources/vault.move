module 0x1::vault {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use std::vector;

    // Error codes
    const DECIMALS: u8 = 18u8;
    const MAX_BPS: u256 = 10000u256;
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
    const E_ZERO_ADDRESS: u64 = 256u64;
    const E_ZERO_AMOUNT: u64 = 257u64;
    const E_DEPOSIT_LIMIT_EXCEEDED: u64 = 258u64;
    const E_STRATEGY_ALREADY_ACTIVE: u64 = 259u64;
    const E_STRATEGY_NOT_ACTIVE: u64 = 260u64;
    const E_EMERGENCY_SHUTDOWN_ACTIVE: u64 = 261u64;
    const E_INVALID_DEBT_RATIO: u64 = 262u64;
    const E_ZERO_SHARES: u64 = 263u64;
    const E_ZERO_ASSETS: u64 = 264u64;

    struct VaultState has key {
        name: vector<u8>,
        symbol: vector<u8>,
        asset: address,
        total_supply: u256,
        balance_of: aptos_std::table::Table<address, u256>,
        allowance: aptos_std::table::Table<address, aptos_std::table::Table<address, u256>>,
        deposit_limit: u256,
        total_debt: u256,
        last_report: u256,
        locked_profit: u256,
        locked_profit_degradation: u256,
        performance_fee: u256,
        management_fee: u256,
        governance: address,
        management: address,
        guardian: address,
        strategies: aptos_std::table::Table<address, StrategyParams>,
        withdrawal_queue: vector<address>,
        debt_ratio: u256,
        emergency_shutdown: bool
    }

    struct StrategyParams has copy, drop, store {
        activation: u256,
        debt_ratio: u256,
        min_debt_per_harvest: u256,
        max_debt_per_harvest: u256,
        last_report: u256,
        total_debt: u256,
        total_gain: u256,
        total_loss: u256
    }

    #[event]
    struct Transfer has drop, store {
        from: address,
        to: address,
        value: u256
    }

    #[event]
    struct Approval has drop, store {
        owner: address,
        spender: address,
        value: u256
    }

    #[event]
    struct Deposit has drop, store {
        sender: address,
        owner: address,
        assets: u256,
        shares: u256
    }

    #[event]
    struct Withdraw has drop, store {
        sender: address,
        receiver: address,
        owner: address,
        assets: u256,
        shares: u256
    }

    #[event]
    struct StrategyAdded has drop, store {
        strategy: address,
        debt_ratio: u256
    }

    #[event]
    struct StrategyReported has drop, store {
        strategy: address,
        gain: u256,
        loss: u256,
        total_gain: u256,
        total_loss: u256
    }

    #[event]
    struct EmergencyShutdown has drop, store {
        active: bool
    }

    public entry fun initialize(deployer: &signer, asset: address, name: vector<u8>, symbol: vector<u8>) {
        move_to(deployer, VaultState { name: name, symbol: symbol, asset: asset, total_supply: 0, balance_of: table::new(), allowance: table::new(), deposit_limit: /* unsupported expression */, total_debt: 0, last_report: /* unsupported expression */, locked_profit: 0, locked_profit_degradation: (46000000000000000000u256 / /* unsupported expression */), performance_fee: 0, management_fee: 0, governance: signer::address_of(deployer), management: signer::address_of(deployer), guardian: signer::address_of(deployer), strategies: table::new(), withdrawal_queue: vector::empty(), debt_ratio: 0, emergency_shutdown: false });
    }

    public fun transfer(account: &signer, to: address, amount: u256): bool {
        transfer(signer::address_of(account), to, amount)
    }

    public fun approve(account: &signer, spender: address, amount: u256): bool acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.allowance, signer::address_of(account), 0u256), spender) = amount;
        event::emit(Approval { owner: signer::address_of(account), spender: spender, value: amount });
        true
    }

    public fun transfer_from(account: &signer, from: address, to: address, amount: u256): bool acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        if ((*table::borrow(&*table::borrow_with_default(&state.allowance, from, &0u256), signer::address_of(account)) != 115792089237316195423570985008687907853269984665640564039457584007913129639935u256)) {
            *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.allowance, from, 0u256), signer::address_of(account)) -= amount;
        };
        transfer(from, to, amount)
    }

    #[view]
    public fun total_assets(): u256 {
        total_assets()
    }

    #[view]
    public fun convert_to_shares(assets: u256): u256 {
        let total_supply: u256 = state.total_supply;
        if ((total_supply == 0u256)) {
            assets
        };
        (((assets * total_supply)) / total_assets())
    }

    #[view]
    public fun convert_to_assets(shares: u256): u256 {
        let total_supply: u256 = state.total_supply;
        if ((total_supply == 0u256)) {
            shares
        };
        (((shares * total_assets())) / total_supply)
    }

    #[view]
    public fun max_deposit(: address): u256 acquires VaultState {
        let state = borrow_global<VaultState>(@0x1);
        if (state.emergency_shutdown) {
            0u256
        };
        let total: u256 = total_assets();
        if ((total >= state.deposit_limit)) {
            0u256
        };
        (state.deposit_limit - total)
    }

    #[view]
    public fun preview_deposit(assets: u256): u256 {
        convert_to_shares(assets)
    }

    #[view]
    public fun preview_withdraw(assets: u256): u256 {
        let total_supply: u256 = state.total_supply;
        if ((total_supply == 0u256)) {
            assets
        };
        let shares: u256 = (((((assets * total_supply) + total_assets()) - 1u256)) / total_assets());
        shares
    }

    public fun deposit(account: &signer, assets: u256, receiver: address): u256 acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        let shares = 0u256;
        assert!(!state.emergency_shutdown, E_EMERGENCY_SHUTDOWN_ACTIVE);
        assert!((assets > 0u256), E_INVALID_AMOUNT);
        assert!((assets <= max_deposit(receiver)), E_DEPOSIT_LIMIT_EXCEEDED);
        shares = preview_deposit(assets);
        assert!((shares > 0u256), E_ZERO_SHARES);
        mint(receiver, shares);
        event::emit(Deposit { sender: signer::address_of(account), owner: receiver, assets: assets, shares: shares });
        shares
    }

    public fun mint(account: &signer, shares: u256, receiver: address): u256 acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        let assets = 0u256;
        assert!(!state.emergency_shutdown, E_EMERGENCY_SHUTDOWN_ACTIVE);
        assert!((shares > 0u256), E_INVALID_AMOUNT);
        assets = convert_to_assets(shares);
        assert!((assets <= max_deposit(receiver)), E_DEPOSIT_LIMIT_EXCEEDED);
        mint(receiver, shares);
        event::emit(Deposit { sender: signer::address_of(account), owner: receiver, assets: assets, shares: shares });
        assets
    }

    public fun withdraw(account: &signer, assets: u256, receiver: address, owner: address): u256 acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        let shares = 0u256;
        shares = preview_withdraw(assets);
        if ((signer::address_of(account) != owner)) {
            let allowed: u256 = *table::borrow(&*table::borrow_with_default(&state.allowance, owner, &0u256), signer::address_of(account));
            if ((allowed != 115792089237316195423570985008687907853269984665640564039457584007913129639935u256)) {
                *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.allowance, owner, 0u256), signer::address_of(account)) = (allowed - shares);
            };
        };
        burn(owner, shares);
        withdraw_from_strategies(assets);
        event::emit(Withdraw { sender: signer::address_of(account), receiver: receiver, owner: owner, assets: assets, shares: shares });
        shares
    }

    public fun redeem(account: &signer, shares: u256, receiver: address, owner: address): u256 acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        let assets = 0u256;
        if ((signer::address_of(account) != owner)) {
            let allowed: u256 = *table::borrow(&*table::borrow_with_default(&state.allowance, owner, &0u256), signer::address_of(account));
            if ((allowed != 115792089237316195423570985008687907853269984665640564039457584007913129639935u256)) {
                *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.allowance, owner, 0u256), signer::address_of(account)) = (allowed - shares);
            };
        };
        assets = convert_to_assets(shares);
        assert!((assets > 0u256), E_ZERO_ASSETS);
        burn(owner, shares);
        withdraw_from_strategies(assets);
        event::emit(Withdraw { sender: signer::address_of(account), receiver: receiver, owner: owner, assets: assets, shares: shares });
        assets
    }

    public entry fun add_strategy(account: &signer, strategy: address, debt_ratio: u256, min_debt_per_harvest: u256, max_debt_per_harvest: u256) acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        assert!((signer::address_of(account) == state.governance), E_UNAUTHORIZED);
        assert!((*table::borrow_with_default(&state.strategies, strategy, &0u256).activation == 0u256), E_STRATEGY_ALREADY_ACTIVE);
        assert!(((state.debt_ratio + debt_ratio) <= MAX_BPS), E_INVALID_DEBT_RATIO);
        *table::borrow_mut_with_default(&mut state.strategies, strategy, 0u256) = strategy_params(timestamp::now_seconds(), debt_ratio, min_debt_per_harvest, max_debt_per_harvest, timestamp::now_seconds(), 0u256, 0u256, 0u256);
        state.debt_ratio += debt_ratio;
        vector::push_back(&mut state.withdrawal_queue, strategy);
        event::emit(StrategyAdded { strategy: strategy, debt_ratio: debt_ratio });
    }

    public fun report(account: &signer, gain: u256, loss: u256): u256 acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        let debt = 0u256;
        let params: StrategyParams = *table::borrow_with_default(&state.strategies, signer::address_of(account), &0u256);
        assert!((params.activation > 0u256), E_PAUSED);
        let total_available: u256 = total_assets();
        let credit: u256 = (((total_available * params.debt_ratio)) / MAX_BPS);
        if ((credit > params.total_debt)) {
            debt = (credit - params.total_debt);
        };
        if ((gain > 0u256)) {
            params.total_gain += gain;
            state.locked_profit += gain;
        };
        if ((loss > 0u256)) {
            params.total_loss += loss;
            if ((params.total_debt >= loss)) {
                params.total_debt -= loss;
                state.total_debt -= loss;
            };
        };
        params.last_report = timestamp::now_seconds();
        state.last_report = timestamp::now_seconds();
        event::emit(StrategyReported { strategy: signer::address_of(account), gain: gain, loss: loss, total_gain: params.total_gain, total_loss: params.total_loss });
        debt
    }

    public entry fun set_emergency_shutdown(account: &signer, active: bool) acquires VaultState {
        let state = borrow_global_mut<VaultState>(@0x1);
        assert!(((signer::address_of(account) == state.guardian) || (signer::address_of(account) == state.governance)), E_UNAUTHORIZED);
        state.emergency_shutdown = active;
        event::emit(EmergencyShutdown { active: active });
    }

    #[view]
    public(package) fun total_assets(state: &VaultState): u256 {
        let locked_profit: u256 = calculate_locked_profit();
        ((state.total_debt + free_assets()) - locked_profit)
    }

    #[view]
    public(package) fun free_assets(): u256 {
        0u256
    }

    #[view]
    public(package) fun calculate_locked_profit(state: &VaultState): u256 {
        let locked_funds_ratio: u256 = (((timestamp::now_seconds() - state.last_report)) * state.locked_profit_degradation);
        if ((locked_funds_ratio >= 1000000000000000000u256)) {
            0u256
        };
        (state.locked_profit - (((state.locked_profit * locked_funds_ratio)) / 1000000000000000000u256))
    }

    public(package) fun withdraw_from_strategies(amount: u256) {
    }

    public(package) fun transfer(from: address, to: address, amount: u256, state: &mut VaultState): bool {
        *table::borrow_mut_with_default(&mut state.balance_of, from, 0u256) -= amount;
        *table::borrow_mut_with_default(&mut state.balance_of, to, 0u256) += amount;
        event::emit(Transfer { from: from, to: to, value: amount });
        true
    }

    public(package) fun mint(to: address, amount: u256, state: &mut VaultState) {
        state.total_supply += amount;
        *table::borrow_mut_with_default(&mut state.balance_of, to, 0u256) += amount;
        event::emit(Transfer { from: @0x0, to: to, value: amount });
    }

    public(package) fun burn(from: address, amount: u256, state: &mut VaultState) {
        *table::borrow_mut_with_default(&mut state.balance_of, from, 0u256) -= amount;
        state.total_supply -= amount;
        event::emit(Transfer { from: from, to: @0x0, value: amount });
    }
}