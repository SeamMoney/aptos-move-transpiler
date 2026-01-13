module 0x1::simple_lending {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::event;
    use aptos_framework::block;
    use std::vector;

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
    const E_MARKET_NOT_LISTED: u64 = 256u64;
    const E_INSUFFICIENT_COLLATERAL: u64 = 257u64;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 258u64;
    const E_NOT_LIQUIDATABLE: u64 = 259u64;
    const E_UNAUTHORIZED: u64 = 260u64;
    const E_INVALID_AMOUNT: u64 = 261u64;
    const E_ALREADY_LISTED: u64 = 262u64;
    const E_INVALID_COLLATERAL_FACTOR: u64 = 263u64;
    const E_CANNOT_SELFLIQUIDATE: u64 = 264u64;
    const E_REPAY_EXCEEDS_DEBT: u64 = 265u64;
    const E_INSUFFICIENT_COLLATERAL_TO_SEI: u64 = 266u64;

    struct SimpleLendingState has key {
        admin: address,
        markets: aptos_std::table::Table<address, Market>,
        user_positions: aptos_std::table::Table<address, aptos_std::table::Table<address, UserPosition>>,
        user_assets: aptos_std::table::Table<address, vector<address>>,
        asset_prices: aptos_std::table::Table<address, u256>
    }

    struct Market has copy, drop, store {
        is_listed: bool,
        collateral_factor: u256,
        liquidation_threshold: u256,
        liquidation_bonus: u256,
        total_deposits: u256,
        total_borrows: u256,
        borrow_index: u256,
        last_update_block: u256
    }

    struct AccountLiquidity has copy, drop, store {
        total_collateral_value: u256,
        total_borrow_value: u256,
        available_borrow: u256,
        shortfall: u256
    }

    struct UserPosition has copy, drop, store {
        deposit_balance: u256,
        borrow_balance: u256,
        borrow_index: u256
    }

    #[event]
    struct MarketListed has drop, store {
        asset: address,
        collateral_factor: u256
    }

    #[event]
    struct Deposit has drop, store {
        user: address,
        asset: address,
        amount: u256
    }

    #[event]
    struct Withdraw has drop, store {
        user: address,
        asset: address,
        amount: u256
    }

    #[event]
    struct Borrow has drop, store {
        user: address,
        asset: address,
        amount: u256
    }

    #[event]
    struct Repay has drop, store {
        user: address,
        asset: address,
        amount: u256
    }

    #[event]
    struct Liquidate has drop, store {
        liquidator: address,
        borrower: address,
        debt_asset: address,
        collateral_asset: address,
        debt_repaid: u256,
        collateral_seized: u256
    }

    fun init_module(deployer: &signer) {
        move_to(deployer, SimpleLendingState { admin: signer::address_of(deployer), markets: table::new(), user_positions: table::new(), user_assets: table::new(), asset_prices: table::new() });
    }

    public entry fun list_market(account: &signer, asset: address, collateral_factor: u256, liquidation_threshold: u256, liquidation_bonus: u256) acquires SimpleLendingState {
        assert!((signer::address_of(account) == state.admin), E_UNAUTHORIZED);

        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        assert!(!*table::borrow(&state.markets, asset).is_listed, E_ALREADY_LISTED);
        assert!((collateral_factor <= 1000000000000000000u256), E_INVALID_COLLATERAL_FACTOR);
        *table::borrow_mut(&mut state.markets, asset) = market(true, collateral_factor, liquidation_threshold, liquidation_bonus, 0u256, 0u256, 1000000000000000000u256, block::get_current_block_height());
        event::emit(MarketListed { asset: asset, collateral_factor: collateral_factor });
    }

    public entry fun set_price(account: &signer, asset: address, price: u256) acquires SimpleLendingState {
        assert!((signer::address_of(account) == state.admin), E_UNAUTHORIZED);

        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        *table::borrow_mut(&mut state.asset_prices, asset) = price;
    }

    public entry fun deposit(account: &signer, asset: address, amount: u256) acquires SimpleLendingState {
        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        assert!(market.is_listed, E_MARKET_NOT_LISTED);
        assert!((amount > 0u256), E_INVALID_AMOUNT);
        accrue_interest(asset);
        let position: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, signer::address_of(account)), asset);
        if ((position.deposit_balance == 0u256)) {
            {
                vector::push_back(&mut *table::borrow(&state.user_assets, signer::address_of(account)), asset);
            }
        }
        position.deposit_balance += amount;
        market.total_deposits += amount;
        event::emit(Deposit { user: signer::address_of(account), asset: asset, amount: amount });
    }

    public entry fun withdraw(account: &signer, asset: address, amount: u256) acquires SimpleLendingState {
        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        assert!(market.is_listed, E_MARKET_NOT_LISTED);
        accrue_interest(asset);
        let position: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, signer::address_of(account)), asset);
        assert!((position.deposit_balance >= amount), E_INSUFFICIENT_BALANCE);
        position.deposit_balance -= amount;
        let (, , , shortfall) = get_account_liquidity(signer::address_of(account));
        assert!((shortfall == 0u256), E_INSUFFICIENT_COLLATERAL);
        market.total_deposits -= amount;
        event::emit(Withdraw { user: signer::address_of(account), asset: asset, amount: amount });
    }

    public entry fun borrow(account: &signer, asset: address, amount: u256) acquires SimpleLendingState {
        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        assert!(market.is_listed, E_MARKET_NOT_LISTED);
        assert!((amount > 0u256), E_INVALID_AMOUNT);
        accrue_interest(asset);
        let (, , available_borrow, ) = get_account_liquidity(signer::address_of(account));
        let borrow_value: u256 = (((amount * *table::borrow(&state.asset_prices, asset))) / 1000000000000000000u256);
        assert!((borrow_value <= available_borrow), E_INSUFFICIENT_COLLATERAL);
        let position: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, signer::address_of(account)), asset);
        position.borrow_balance += amount;
        position.borrow_index = market.borrow_index;
        market.total_borrows += amount;
        event::emit(Borrow { user: signer::address_of(account), asset: asset, amount: amount });
    }

    public entry fun repay(account: &signer, asset: address, amount: u256) acquires SimpleLendingState {
        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        assert!(market.is_listed, E_MARKET_NOT_LISTED);
        accrue_interest(asset);
        let position: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, signer::address_of(account)), asset);
        let borrowed_with_interest: u256 = borrow_balance_with_interest(signer::address_of(account), asset);
        let repay_amount: u256 = if ((amount > borrowed_with_interest)) borrowed_with_interest else amount;
        position.borrow_balance = (borrowed_with_interest - repay_amount);
        position.borrow_index = market.borrow_index;
        market.total_borrows -= repay_amount;
        event::emit(Repay { user: signer::address_of(account), asset: asset, amount: repay_amount });
    }

    public entry fun liquidate(account: &signer, borrower: address, debt_asset: address, collateral_asset: address, debt_to_repay: u256) acquires SimpleLendingState {
        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        assert!((borrower != signer::address_of(account)), E_CANNOT_SELFLIQUIDATE);
        accrue_interest(debt_asset);
        accrue_interest(collateral_asset);
        let (, , , shortfall) = get_account_liquidity(borrower);
        assert!((shortfall > 0u256), E_NOT_LIQUIDATABLE);
        let collateral_market: Market = *table::borrow(&state.markets, collateral_asset);
        let debt_value: u256 = (((debt_to_repay * *table::borrow(&state.asset_prices, debt_asset))) / 1000000000000000000u256);
        let collateral_to_seize: u256 = (((debt_value * collateral_market.liquidation_bonus)) / *table::borrow(&state.asset_prices, collateral_asset));
        let borrower_debt: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, borrower), debt_asset);
        let borrower_collateral: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, borrower), collateral_asset);
        assert!((borrower_debt.borrow_balance >= debt_to_repay), E_REPAY_EXCEEDS_DEBT);
        assert!((borrower_collateral.deposit_balance >= collateral_to_seize), E_INSUFFICIENT_COLLATERAL_TO_SEI);
        borrower_debt.borrow_balance -= debt_to_repay;
        borrower_collateral.deposit_balance -= collateral_to_seize;
        *table::borrow(&*table::borrow(&state.user_positions, signer::address_of(account)), collateral_asset).deposit_balance += collateral_to_seize;
        *table::borrow(&state.markets, debt_asset).total_borrows -= debt_to_repay;
        event::emit(Liquidate { liquidator: signer::address_of(account), borrower: borrower, debt_asset: debt_asset, collateral_asset: collateral_asset, debt_repaid: debt_to_repay, collateral_seized: collateral_to_seize });
    }

    #[view]
    public fun get_account_liquidity(user: address): (u256, u256, u256, u256) acquires SimpleLendingState {
        let state = borrow_global<SimpleLendingState>(@0x1);
        let assets: vector<address> = *table::borrow(&state.user_assets, user);
        {
            let i: u256 = 0u256;
            while ((i < assets.length)) {
                {
                    let asset: address = *vector::borrow(&assets, i);
                    let market: Market = *table::borrow(&state.markets, asset);
                    let position: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, user), asset);
                    if ((position.deposit_balance > 0u256)) {
                        {
                            let deposit_value: u256 = (((position.deposit_balance * *table::borrow(&state.asset_prices, asset))) / 1000000000000000000u256);
                            let adjusted_collateral: u256 = (((deposit_value * market.collateral_factor)) / 1000000000000000000u256);
                            total_collateral_value += adjusted_collateral;
                        }
                    }
                    if ((position.borrow_balance > 0u256)) {
                        {
                            let borrow_balance: u256 = borrow_balance_with_interest(user, asset);
                            let borrow_value: u256 = (((borrow_balance * *table::borrow(&state.asset_prices, asset))) / 1000000000000000000u256);
                            total_borrow_value += borrow_value;
                        }
                    }
                }
                (i + 1);
            }
        }
        if ((total_collateral_value > total_borrow_value)) {
            {
                available_borrow = (total_collateral_value - total_borrow_value);
                shortfall = 0u256;
            }
        } else {
            {
                available_borrow = 0u256;
                shortfall = (total_borrow_value - total_collateral_value);
            }
        }
    }

    #[view]
    public fun get_borrow_rate(asset: address): u256 acquires SimpleLendingState {
        let state = borrow_global<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        if ((market.total_deposits == 0u256)) {
            {
                state.base_rate
            }
        }
        let utilization: u256 = (((market.total_borrows * 1000000000000000000u256)) / market.total_deposits);
        if ((utilization <= state.kink)) {
            {
                (state.base_rate + (((utilization * state.multiplier)) / 1000000000000000000u256))
            }
        } else {
            {
                let normal_rate: u256 = (state.base_rate + (((state.kink * state.multiplier)) / 1000000000000000000u256));
                let excess_utilization: u256 = (utilization - state.kink);
                (normal_rate + (((excess_utilization * state.jump_multiplier)) / 1000000000000000000u256))
            }
        }
    }

    #[view]
    public fun get_supply_rate(asset: address): u256 acquires SimpleLendingState {
        let state = borrow_global<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        if ((market.total_deposits == 0u256)) {
            {
                0u256
            }
        }
        let utilization: u256 = (((market.total_borrows * 1000000000000000000u256)) / market.total_deposits);
        let borrow_rate: u256 = get_borrow_rate(asset);
        (((borrow_rate * utilization)) / 1000000000000000000u256)
    }

    public(package) fun accrue_interest(account: &signer, asset: address) acquires SimpleLendingState {
        let state = borrow_global_mut<SimpleLendingState>(@0x1);
        let market: Market = *table::borrow(&state.markets, asset);
        let block_delta: u256 = (block::get_current_block_height() - market.last_update_block);
        if ((block_delta == 0u256)) {
            {
                return
            }
        }
        let borrow_rate: u256 = get_borrow_rate(asset);
        let interest_factor: u256 = (borrow_rate * block_delta);
        let interest_accumulated: u256 = (((market.total_borrows * interest_factor)) / 1000000000000000000u256);
        market.total_borrows += interest_accumulated;
        market.borrow_index += (((market.borrow_index * interest_factor)) / 1000000000000000000u256);
        market.last_update_block = block::get_current_block_height();
    }

    #[view]
    public(package) fun borrow_balance_with_interest(user: address, asset: address): u256 acquires SimpleLendingState {
        let state = borrow_global<SimpleLendingState>(@0x1);
        let position: UserPosition = *table::borrow(&*table::borrow(&state.user_positions, user), asset);
        let market: Market = *table::borrow(&state.markets, asset);
        if ((position.borrow_balance == 0u256)) {
            {
                0u256
            }
        }
        let principal_times_index: u256 = (position.borrow_balance * market.borrow_index);
        (principal_times_index / position.borrow_index)
    }
}