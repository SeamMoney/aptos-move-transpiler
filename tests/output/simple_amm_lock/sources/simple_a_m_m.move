module 0x1::simple_a_m_m {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use aptos_framework::event;
    use transpiler::evm_compat;

    // Error codes
    const FEE_NUMERATOR: u256 = 3u256;
    const FEE_DENOMINATOR: u256 = 1000u256;
    const MINIMUM_LIQUIDITY: u256 = 1000u256;
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
    const E_INSUFFICIENT_LIQUIDITY: u64 = 256u64;
    const E_INSUFFICIENT_INPUT_AMOUNT: u64 = 257u64;
    const E_INSUFFICIENT_OUTPUT_AMOUNT: u64 = 258u64;
    const E_INVALID_TO: u64 = 259u64;
    const E_INSUFFICIENT_LIQUIDITY_MINTED: u64 = 260u64;
    const E_INSUFFICIENT_LIQUIDITY_BURNED: u64 = 261u64;
    const E_K_INVARIANT: u64 = 262u64;

    struct SimpleAMMState has key {
        token0: address,
        token1: address,
        reserve0: u256,
        reserve1: u256,
        total_supply: u256,
        balance_of: aptos_std::table::Table<address, u256>,
        unlocked: u256,
        signer_cap: account::SignerCapability
    }

    #[event]
    struct Mint has drop, store {
        sender: address,
        amount0: u256,
        amount1: u256
    }

    #[event]
    struct Burn has drop, store {
        sender: address,
        amount0: u256,
        amount1: u256,
        to: address
    }

    #[event]
    struct Swap has drop, store {
        sender: address,
        amount0_in: u256,
        amount1_in: u256,
        amount0_out: u256,
        amount1_out: u256,
        to: address
    }

    #[event]
    struct Sync has drop, store {
        reserve0: u256,
        reserve1: u256
    }

    public entry fun initialize(deployer: &signer, token0: address, token1: address) {
        move_to(deployer, SimpleAMMState { token0: token0, token1: token1, reserve0: 0, reserve1: 0, total_supply: 0, balance_of: table::new(), unlocked: 0 });
    }

    public fun mint(account: &signer, to: address): u256 acquires SimpleAMMState {
        let state = borrow_global_mut<SimpleAMMState>(@0x1);
        let liquidity = 0u256;
        assert!((state.unlocked == 1u256), E_LOCKED);
        state.unlocked = 0u256;
        let (reserve0, reserve1) = get_reserves();
        let balance0: u256 = get_balance0(state);
        let balance1: u256 = get_balance1(state);
        let amount0: u256 = (balance0 - reserve0);
        let amount1: u256 = (balance1 - reserve1);
        let total_supply: u256 = state.total_supply;
        if ((total_supply == 0u256)) {
            liquidity = (sqrt((amount0 * amount1)) - MINIMUM_LIQUIDITY);
            *table::borrow_mut_with_default(&mut state.balance_of, @0x0, 0u256) = MINIMUM_LIQUIDITY;
            state.total_supply = MINIMUM_LIQUIDITY;
        } else {
            liquidity = min((((amount0 * total_supply)) / reserve0), (((amount1 * total_supply)) / reserve1));
        };
        assert!((liquidity > 0u256), E_INSUFFICIENT_LIQUIDITY_MINTED);
        *table::borrow_mut_with_default(&mut state.balance_of, to, 0u256) += liquidity;
        state.total_supply += liquidity;
        update(balance0, balance1, state);
        event::emit(Mint { sender: signer::address_of(account), amount0: amount0, amount1: amount1 });
        liquidity
    }

    public fun burn(account: &signer, to: address): (u256, u256) acquires SimpleAMMState {
        let state = borrow_global_mut<SimpleAMMState>(@0x1);
        let amount0 = 0u256;
        let amount1 = 0u256;
        assert!((state.unlocked == 1u256), E_LOCKED);
        state.unlocked = 0u256;
        let balance0: u256 = get_balance0(state);
        let balance1: u256 = get_balance1(state);
        let liquidity: u256 = *table::borrow_with_default(&state.balance_of, @0x1, &0u256);
        let total_supply: u256 = state.total_supply;
        amount0 = (((liquidity * balance0)) / total_supply);
        amount1 = (((liquidity * balance1)) / total_supply);
        assert!(((amount0 > 0u256) && (amount1 > 0u256)), E_INSUFFICIENT_LIQUIDITY_BURNED);
        *table::borrow_mut_with_default(&mut state.balance_of, @0x1, 0u256) -= liquidity;
        state.total_supply -= liquidity;
        update((balance0 - amount0), (balance1 - amount1), state);
        event::emit(Burn { sender: signer::address_of(account), amount0: amount0, amount1: amount1, to: to });
        (amount0, amount1)
    }

    public entry fun swap(account: &signer, amount0_out: u256, amount1_out: u256, to: address) acquires SimpleAMMState {
        let state = borrow_global_mut<SimpleAMMState>(@0x1);
        assert!((state.unlocked == 1u256), E_LOCKED);
        state.unlocked = 0u256;
        assert!(((amount0_out > 0u256) || (amount1_out > 0u256)), E_INVALID_AMOUNT);
        let (reserve0, reserve1) = get_reserves();
        assert!(((amount0_out < reserve0) && (amount1_out < reserve1)), E_INSUFFICIENT_LIQUIDITY);
        assert!(((to != state.token0) && (to != state.token1)), E_INVALID_TO);
        let balance0: u256 = (get_balance0(state) - amount0_out);
        let balance1: u256 = (get_balance1(state) - amount1_out);
        let amount0_in: u256 = if ((balance0 > (reserve0 - amount0_out))) (balance0 - ((reserve0 - amount0_out))) else 0u256;
        let amount1_in: u256 = if ((balance1 > (reserve1 - amount1_out))) (balance1 - ((reserve1 - amount1_out))) else 0u256;
        assert!(((amount0_in > 0u256) || (amount1_in > 0u256)), E_INVALID_AMOUNT);
        let balance0_adjusted: u256 = (((balance0 * FEE_DENOMINATOR)) - ((amount0_in * FEE_NUMERATOR)));
        let balance1_adjusted: u256 = (((balance1 * FEE_DENOMINATOR)) - ((amount1_in * FEE_NUMERATOR)));
        assert!(((balance0_adjusted * balance1_adjusted) >= ((reserve0 * reserve1) * (evm_compat::exp_u256(FEE_DENOMINATOR, 2u256)))), E_K_INVARIANT);
        update(balance0, balance1, state);
        event::emit(Swap { sender: signer::address_of(account), amount0_in: amount0_in, amount1_in: amount1_in, amount0_out: amount0_out, amount1_out: amount1_out, to: to });
        state.unlocked = 1u256;
    }

    #[view]
    public fun get_amount_out(amount_in: u256, reserve_in: u256, reserve_out: u256): u256 {
        let amount_out = 0u256;
        assert!((amount_in > 0u256), E_INVALID_AMOUNT);
        assert!(((reserve_in > 0u256) && (reserve_out > 0u256)), E_INSUFFICIENT_LIQUIDITY);
        let amount_in_with_fee: u256 = (amount_in * ((FEE_DENOMINATOR - FEE_NUMERATOR)));
        let numerator: u256 = (amount_in_with_fee * reserve_out);
        let denominator: u256 = (((reserve_in * FEE_DENOMINATOR)) + amount_in_with_fee);
        amount_out = (numerator / denominator);
        amount_out
    }

    #[view]
    public fun get_amount_in(amount_out: u256, reserve_in: u256, reserve_out: u256): u256 {
        let amount_in = 0u256;
        assert!((amount_out > 0u256), E_INVALID_AMOUNT);
        assert!(((reserve_in > 0u256) && (reserve_out > 0u256)), E_INSUFFICIENT_LIQUIDITY);
        let numerator: u256 = ((reserve_in * amount_out) * FEE_DENOMINATOR);
        let denominator: u256 = (((reserve_out - amount_out)) * ((FEE_DENOMINATOR - FEE_NUMERATOR)));
        amount_in = (((numerator / denominator)) + 1u256);
        amount_in
    }

    #[view]
    public fun get_reserves(): (u256, u256) acquires SimpleAMMState {
        let state = borrow_global<SimpleAMMState>(@0x1);
        (state.reserve0, state.reserve1)
    }

    fun update(balance0: u256, balance1: u256, state: &mut SimpleAMMState) {
        state.reserve0 = balance0;
        state.reserve1 = balance1;
        event::emit(Sync { reserve0: state.reserve0, reserve1: state.reserve1 });
    }

    #[view]
    public(package) fun get_balance0(state: &SimpleAMMState): u256 {
        state.reserve0
    }

    #[view]
    public(package) fun get_balance1(state: &SimpleAMMState): u256 {
        state.reserve1
    }

    #[view]
    public(package) fun sqrt(y: u256): u256 {
        let z = 0u256;
        if ((y > 3u256)) {
            z = y;
            let x: u256 = ((y / 2u256) + 1u256);
            while ((x < z)) {
                z = x;
                x = ((((y / x) + x)) / 2u256);
            }
        } else {
            if ((y != 0u256)) {
                z = 1u256;
            };
        };
        z
    }

    #[view]
    public(package) fun min(a: u256, b: u256): u256 {
        if ((a < b)) a else b
    }
}