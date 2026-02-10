module 0x1::l_b_router {

    use std::signer;
    use aptos_framework::account;
    use std::string;
    use transpiler::evm_compat;
    use aptos_framework::timestamp;
    use std::vector;
    use std::u256;
    use 0x1::token_helper;
    use 0x1::liquidity_configurations;
    use 0x1::packed_uint128_math;

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

    struct LBRouterState has key {
        factory2_2: address,
        factory2_1: address,
        factory_v1: address,
        legacy_factory: address,
        legacy_router: address,
        wnative: address,
        signer_cap: account::SignerCapability
    }

    public entry fun initialize(deployer: &signer, factory2_2: address, factory_v1: address, legacy_factory: address, legacy_router: address, factory2_1: address, wnative: address) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"l_b_router");
        move_to(&resource_signer, LBRouterState { factory2_2: factory2_2, factory2_1: factory2_1, factory_v1: factory_v1, legacy_factory: legacy_factory, legacy_router: legacy_router, wnative: wnative, signer_cap: signer_cap });
    }

    public entry fun receive(account: &signer) {
        string::utf8(b"UNSUPPORTED: receive() has no Move equivalent");
    }

    #[view]
    public fun get_factory(): address acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let _lb_factory = @0x0;
        return state.factory2_2
    }

    #[view]
    public fun get_factory_v2_1(): address acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let _lb_factory = @0x0;
        return state.factory2_1
    }

    #[view]
    public fun get_legacy_factory(): address acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let _legacy_l_bfactory = @0x0;
        return state.legacy_factory
    }

    #[view]
    public fun get_v1_factory(): address acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let _factory_v1 = @0x0;
        return state.factory_v1
    }

    #[view]
    public fun get_legacy_router(): address acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let _legacy_router = @0x0;
        return state.legacy_router
    }

    #[view]
    public fun get_w_n_a_t_i_v_e(): address acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let _wnative = @0x0;
        return state.wnative
    }

    public fun get_id_from_price(pair: address, price: u256): u32 {
        return get_id_from_price(pair, price)
    }

    public fun get_price_from_id(pair: address, id: u32): u256 {
        return get_price_from_id(pair, id)
    }

    public fun get_swap_in(pair: address, amount_out: u128, swap_for_y: bool): (u128, u128, u128) {
        let amount_in = 0u128;
        let amount_out_left = 0u128;
        let fee = 0u128;
        (amount_in, amount_out_left, fee) = get_swap_in(pair, amount_out, swap_for_y);
        return (amount_in, amount_out_left, fee)
    }

    public fun get_swap_out(pair: address, amount_in: u128, swap_for_y: bool): (u128, u128, u128) {
        let amount_in_left = 0u128;
        let amount_out = 0u128;
        let fee = 0u128;
        (amount_in_left, amount_out, fee) = get_swap_out(pair, amount_in, swap_for_y);
        return (amount_in_left, amount_out, fee)
    }

    public fun create_l_b_pair(account: &signer, token_x: address, token_y: address, active_id: u32, bin_step: u16): address {
        let pair = @0x0;
        pair = (create_l_b_pair(state.factory2_2, token_x, token_y, active_id, bin_step) as address);
        return pair
    }

    public fun add_liquidity(account: &signer, liquidity_parameters: LiquidityParameters): (u256, u256, u256, u256, vector<u256>, vector<u256>) {
        let amount_x_added = 0u256;
        let amount_y_added = 0u256;
        let amount_x_left = 0u256;
        let amount_y_left = 0u256;
        let deposit_ids = vector::empty();
        let liquidity_minted = vector::empty();
        let lb_pair: address = i_l_b_pair(get_l_b_pair_information(liquidity_parameters.token_x, liquidity_parameters.token_y, liquidity_parameters.bin_step, V2_2));
        if ((liquidity_parameters.token_x != get_token_x(lb_pair))) {
            abort E_L_B_ROUTER_WRONG_TOKEN_ORDER
        };
        safe_transfer_from(liquidity_parameters.token_x, signer::address_of(account), evm_compat::to_address(lb_pair), liquidity_parameters.amount_x);
        safe_transfer_from(liquidity_parameters.token_y, signer::address_of(account), evm_compat::to_address(lb_pair), liquidity_parameters.amount_y);
        (amount_x_added, amount_y_added, amount_x_left, amount_y_left, deposit_ids, liquidity_minted) = add_liquidity(liquidity_parameters, lb_pair);
        return (amount_x_added, amount_y_added, amount_x_left, amount_y_left, deposit_ids, liquidity_minted)
    }

    public fun add_liquidity_n_a_t_i_v_e(account: &signer, liquidity_parameters: LiquidityParameters): (u256, u256, u256, u256, vector<u256>, vector<u256>) acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amount_x_added = 0u256;
        let amount_y_added = 0u256;
        let amount_x_left = 0u256;
        let amount_y_left = 0u256;
        let deposit_ids = vector::empty();
        let liquidity_minted = vector::empty();
        let _l_b_pair: address = i_l_b_pair(get_l_b_pair_information(liquidity_parameters.token_x, liquidity_parameters.token_y, liquidity_parameters.bin_step, V2_2));
        if ((liquidity_parameters.token_x != get_token_x(_l_b_pair))) {
            abort E_L_B_ROUTER_WRONG_TOKEN_ORDER
        };
        if (((liquidity_parameters.token_x == state.wnative) && (liquidity_parameters.amount_x == 0u256))) {
            safe_transfer_from(liquidity_parameters.token_y, signer::address_of(account), evm_compat::to_address(_l_b_pair), liquidity_parameters.amount_y);
            w_native_deposit_and_transfer(evm_compat::to_address(_l_b_pair), 0u256);
        } else {
            if (((liquidity_parameters.token_y == state.wnative) && (liquidity_parameters.amount_y == 0u256))) {
                safe_transfer_from(liquidity_parameters.token_x, signer::address_of(account), evm_compat::to_address(_l_b_pair), liquidity_parameters.amount_x);
                w_native_deposit_and_transfer(evm_compat::to_address(_l_b_pair), 0u256);
            } else {
                abort E_L_B_ROUTER_WRONG_NATIVE_LIQUIDITY_PARAMETERS
            };
        };
        (amount_x_added, amount_y_added, amount_x_left, amount_y_left, deposit_ids, liquidity_minted) = add_liquidity(liquidity_parameters, _l_b_pair);
        return (amount_x_added, amount_y_added, amount_x_left, amount_y_left, deposit_ids, liquidity_minted)
    }

    public fun remove_liquidity(account: &signer, token_x: address, token_y: address, bin_step: u16, amount_x_min: u256, amount_y_min: u256, ids: vector<u256>, amounts: vector<u256>, to: address, deadline: u256): (u256, u256) {
        let amount_x = 0u256;
        let amount_y = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        let _l_b_pair: address = i_l_b_pair(get_l_b_pair_information(token_x, token_y, bin_step, V2_2));
        let is_wrong_order: bool = (token_x != get_token_x(_l_b_pair));
        if (is_wrong_order) {
            (amount_x_min, amount_y_min) = (amount_y_min, amount_x_min);
        };
        (amount_x, amount_y) = remove_liquidity(_l_b_pair, amount_x_min, amount_y_min, ids, amounts, to);
        if (is_wrong_order) {
            (amount_x, amount_y) = (amount_y, amount_x);
        };
        return (amount_x, amount_y)
    }

    public fun remove_liquidity_n_a_t_i_v_e(account: &signer, token: address, bin_step: u16, amount_token_min: u256, amount_n_a_t_i_v_e_min: u256, ids: vector<u256>, amounts: vector<u256>, to: address, deadline: u256): (u256, u256) acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amount_token = 0u256;
        let amount_n_a_t_i_v_e = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        let lb_pair: address = i_l_b_pair(get_l_b_pair_information(token, IERC20(state.wnative), bin_step, V2_2));
        let is_n_a_t_i_v_e_token_y: bool = (IERC20(state.wnative) == get_token_y(lb_pair));
        if (!is_n_a_t_i_v_e_token_y) {
            (amount_token_min, amount_n_a_t_i_v_e_min) = (amount_n_a_t_i_v_e_min, amount_token_min);
        };
        let (amount_x, amount_y) = remove_liquidity(lb_pair, amount_token_min, amount_n_a_t_i_v_e_min, ids, amounts, @0x1);
        (amount_token, amount_n_a_t_i_v_e) = if (is_n_a_t_i_v_e_token_y) (amount_x, amount_y) else (amount_y, amount_x);
        safe_transfer(token, to, amount_token);
        w_native_withdraw_and_transfer(to, amount_n_a_t_i_v_e);
        return (amount_token, amount_n_a_t_i_v_e)
    }

    public fun swap_exact_tokens_for_tokens(account: &signer, amount_in: u256, amount_out_min: u256, path: Path, to: address, deadline: u256): u256 {
        let amount_out = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        safe_transfer_from(*vector::borrow(&path.token_path, 0u64), signer::address_of(account), *vector::borrow(&pairs, 0u64), amount_in);
        amount_out = swap_exact_tokens_for_tokens(amount_in, pairs, path.versions, path.token_path, to);
        if ((amount_out_min > amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        return amount_out
    }

    public fun swap_exact_tokens_for_n_a_t_i_v_e(account: &signer, amount_in: u256, amount_out_min_n_a_t_i_v_e: u256, path: Path, to: address, deadline: u256): u256 acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amount_out = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if ((*vector::borrow(&path.token_path, (vector::length(&path.pair_bin_steps) as u64)) != IERC20(state.wnative))) {
            abort E_L_B_ROUTER_INVALID_TOKEN_PATH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        safe_transfer_from(*vector::borrow(&path.token_path, 0u64), signer::address_of(account), *vector::borrow(&pairs, 0u64), amount_in);
        amount_out = swap_exact_tokens_for_tokens(amount_in, pairs, path.versions, path.token_path, @0x1);
        if ((amount_out_min_n_a_t_i_v_e > amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        w_native_withdraw_and_transfer(to, amount_out);
        return amount_out
    }

    public fun swap_exact_n_a_t_i_v_e_for_tokens(account: &signer, amount_out_min: u256, path: Path, to: address, deadline: u256): u256 acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amount_out = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if ((*vector::borrow(&path.token_path, 0u64) != IERC20(state.wnative))) {
            abort E_L_B_ROUTER_INVALID_TOKEN_PATH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        w_native_deposit_and_transfer(*vector::borrow(&pairs, 0u64), 0u256);
        amount_out = swap_exact_tokens_for_tokens(0u256, pairs, path.versions, path.token_path, to);
        if ((amount_out_min > amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        return amount_out
    }

    public fun swap_tokens_for_exact_tokens(account: &signer, amount_out: u256, amount_in_max: u256, path: Path, to: address, deadline: u256): vector<u256> {
        let amounts_in = vector::empty();
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        amounts_in = get_amounts_in(path.versions, pairs, path.token_path, amount_out);
        if ((*vector::borrow(&amounts_in, 0u64) > amount_in_max)) {
            abort E_L_B_ROUTER_MAX_AMOUNT_IN_EXCEEDED
        };
        safe_transfer_from(*vector::borrow(&path.token_path, 0u64), signer::address_of(account), *vector::borrow(&pairs, 0u64), *vector::borrow(&amounts_in, 0u64));
        let amount_out_real: u256 = swap_tokens_for_exact_tokens(pairs, path.versions, path.token_path, amounts_in, to);
        if ((amount_out_real < amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        return amounts_in
    }

    public fun swap_tokens_for_exact_n_a_t_i_v_e(account: &signer, amount_n_a_t_i_v_e_out: u256, amount_in_max: u256, path: Path, to: address, deadline: u256): vector<u256> acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amounts_in = vector::empty();
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if ((*vector::borrow(&path.token_path, (vector::length(&path.pair_bin_steps) as u64)) != IERC20(state.wnative))) {
            abort E_L_B_ROUTER_INVALID_TOKEN_PATH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        amounts_in = get_amounts_in(path.versions, pairs, path.token_path, amount_n_a_t_i_v_e_out);
        if ((*vector::borrow(&amounts_in, 0u64) > amount_in_max)) {
            abort E_L_B_ROUTER_MAX_AMOUNT_IN_EXCEEDED
        };
        safe_transfer_from(*vector::borrow(&path.token_path, 0u64), signer::address_of(account), *vector::borrow(&pairs, 0u64), *vector::borrow(&amounts_in, 0u64));
        let amount_out_real: u256 = swap_tokens_for_exact_tokens(pairs, path.versions, path.token_path, amounts_in, @0x1);
        if ((amount_out_real < amount_n_a_t_i_v_e_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        w_native_withdraw_and_transfer(to, amount_out_real);
        return amounts_in
    }

    public fun swap_n_a_t_i_v_e_for_exact_tokens(account: &signer, amount_out: u256, path: Path, to: address, deadline: u256): vector<u256> acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amounts_in = vector::empty();
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if ((*vector::borrow(&path.token_path, 0u64) != IERC20(state.wnative))) {
            abort E_L_B_ROUTER_INVALID_TOKEN_PATH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        amounts_in = get_amounts_in(path.versions, pairs, path.token_path, amount_out);
        if ((*vector::borrow(&amounts_in, 0u64) > 0u256)) {
            abort E_L_B_ROUTER_MAX_AMOUNT_IN_EXCEEDED
        };
        w_native_deposit_and_transfer(*vector::borrow(&pairs, 0u64), *vector::borrow(&amounts_in, 0u64));
        let amount_out_real: u256 = swap_tokens_for_exact_tokens(pairs, path.versions, path.token_path, amounts_in, to);
        if ((amount_out_real < amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        if ((0u256 > *vector::borrow(&amounts_in, 0u64))) {
            safe_transfer_native(signer::address_of(account), (0u256 - *vector::borrow(&amounts_in, 0u64)));
        };
        return amounts_in
    }

    public fun swap_exact_tokens_for_tokens_supporting_fee_on_transfer_tokens(account: &signer, amount_in: u256, amount_out_min: u256, path: Path, to: address, deadline: u256): u256 {
        let amount_out = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        let target_token: address = *vector::borrow(&path.token_path, (vector::length(&pairs) as u64));
        let balance_before: u256 = balance_of(target_token, to);
        safe_transfer_from(*vector::borrow(&path.token_path, 0u64), signer::address_of(account), *vector::borrow(&pairs, 0u64), amount_in);
        swap_supporting_fee_on_transfer_tokens(pairs, path.versions, path.token_path, to);
        amount_out = (balance_of(target_token, to) - balance_before);
        if ((amount_out_min > amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        return amount_out
    }

    public fun swap_exact_tokens_for_n_a_t_i_v_e_supporting_fee_on_transfer_tokens(account: &signer, amount_in: u256, amount_out_min_n_a_t_i_v_e: u256, path: Path, to: address, deadline: u256): u256 acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amount_out = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if ((*vector::borrow(&path.token_path, (vector::length(&path.pair_bin_steps) as u64)) != IERC20(state.wnative))) {
            abort E_L_B_ROUTER_INVALID_TOKEN_PATH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        let balance_before: u256 = balance_of(state.wnative, @0x1);
        safe_transfer_from(*vector::borrow(&path.token_path, 0u64), signer::address_of(account), *vector::borrow(&pairs, 0u64), amount_in);
        swap_supporting_fee_on_transfer_tokens(pairs, path.versions, path.token_path, @0x1);
        amount_out = (balance_of(state.wnative, @0x1) - balance_before);
        if ((amount_out_min_n_a_t_i_v_e > amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        w_native_withdraw_and_transfer(to, amount_out);
        return amount_out
    }

    public fun swap_exact_n_a_t_i_v_e_for_tokens_supporting_fee_on_transfer_tokens(account: &signer, amount_out_min: u256, path: Path, to: address, deadline: u256): u256 acquires LBRouterState {
        let state = borrow_global<LBRouterState>(@0x1);
        let amount_out = 0u256;
        if (((timestamp::now_seconds() as u256) > deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if ((((vector::length(&path.pair_bin_steps) == 0) || (vector::length(&path.versions) != vector::length(&path.pair_bin_steps))) || ((vector::length(&path.pair_bin_steps) + 1) != vector::length(&path.token_path)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if ((*vector::borrow(&path.token_path, 0u64) != IERC20(state.wnative))) {
            abort E_L_B_ROUTER_INVALID_TOKEN_PATH
        };
        let pairs: vector<address> = get_pairs(path.pair_bin_steps, path.versions, path.token_path);
        let target_token: address = *vector::borrow(&path.token_path, (vector::length(&pairs) as u64));
        let balance_before: u256 = balance_of(target_token, to);
        w_native_deposit_and_transfer(*vector::borrow(&pairs, 0u64), 0u256);
        swap_supporting_fee_on_transfer_tokens(pairs, path.versions, path.token_path, to);
        amount_out = (balance_of(target_token, to) - balance_before);
        if ((amount_out_min > amount_out)) {
            abort E_L_B_ROUTER_INSUFFICIENT_AMOUNT_OUT
        };
        return amount_out
    }

    public entry fun sweep(account: &signer, token: address, to: address, amount: u256) acquires LBRouterState {
        let state = borrow_global_mut<LBRouterState>(@0x1);
        if ((signer::address_of(account) != owner(ownable(evm_compat::to_address(state.factory2_2))))) {
            abort E_L_B_ROUTER_NOT_FACTORY_OWNER
        };
        if ((evm_compat::to_address(token) == @0x0)) {
            amount = if ((amount == u256::MAX)) @0x1.balance else amount;
            safe_transfer_native(to, amount);
        } else {
            amount = if ((amount == u256::MAX)) balance_of(token, @0x1) else amount;
            token_helper::safe_transfer(token, to, amount);
        };
    }

    public entry fun sweep_l_b_token(account: &signer, lb_token: address, to: address, ids: vector<u256>, amounts: vector<u256>) acquires LBRouterState {
        let state = borrow_global_mut<LBRouterState>(@0x1);
        if ((signer::address_of(account) != owner(ownable(evm_compat::to_address(state.factory2_2))))) {
            abort E_L_B_ROUTER_NOT_FACTORY_OWNER
        };
        batch_transfer_from(lb_token, @0x1, to, ids, amounts);
    }

    fun add_liquidity(liq: LiquidityParameters, pair: address): (u256, u256, u256, u256, vector<u256>, vector<u256>) {
        let amount_x_added = 0u256;
        let amount_y_added = 0u256;
        let amount_x_left = 0u256;
        let amount_y_left = 0u256;
        let deposit_ids = vector::empty();
        let liquidity_minted = vector::empty();
        if (((timestamp::now_seconds() as u256) > liq.deadline)) {
            abort E_L_B_ROUTER_DEADLINE_EXCEEDED
        };
        if (((vector::length(&liq.delta_ids) != vector::length(&liq.distribution_x)) || (vector::length(&liq.delta_ids) != vector::length(&liq.distribution_y)))) {
            abort E_L_B_ROUTER_LENGTHS_MISMATCH
        };
        if (((liq.active_id_desired > 115792089237316195423570985008687907853269984665640564039457584007913129639935u256) || (liq.id_slippage > 115792089237316195423570985008687907853269984665640564039457584007913129639935u256))) {
            abort E_L_B_ROUTER_ID_DESIRED_OVERFLOWS
        };
        let liquidity_configs: vector<u256> = unknown(vector::length(&liq.delta_ids));
        deposit_ids = unknown(vector::length(&liq.delta_ids));
        let active_id: u256 = get_active_id(pair);
        if ((((liq.active_id_desired + liq.id_slippage) < active_id) || ((active_id + liq.id_slippage) < liq.active_id_desired))) {
            abort E_L_B_ROUTER_ID_SLIPPAGE_CAUGHT
        };
        let i: u256;
        while ((i < (vector::length(&liquidity_configs) as u256))) {
            let id: i256 = ((active_id as i256) + *vector::borrow(&liq.delta_ids, (i as u64)));
            if (((id < 0) || ((id as u256) > 115792089237316195423570985008687907853269984665640564039457584007913129639935u256))) {
                abort E_L_B_ROUTER_ID_OVERFLOWS
            };
            *vector::borrow_mut(&mut deposit_ids, (i as u64)) = (id as u256);
            *vector::borrow_mut(&mut liquidity_configs, (i as u64)) = liquidity_configurations::encode_params((*vector::borrow(&liq.distribution_x, (i as u64)) as u64), (*vector::borrow(&liq.distribution_y, (i as u64)) as u64), ((id as u256) & 16777215));
            i = (i + 1);
        }
        let amounts_received: u256;
        let amounts_left: u256;
        (amounts_received, amounts_left, liquidity_minted) = mint(pair, liq.to, liquidity_configs, liq.refund_to);
        let amounts_added: u256 = (amounts_received - amounts_left);
        amount_x_added = packed_uint128_math::decode_x(amounts_added);
        amount_y_added = packed_uint128_math::decode_y(amounts_added);
        if (((amount_x_added < liq.amount_x_min) || (amount_y_added < liq.amount_y_min))) {
            abort E_L_B_ROUTER_AMOUNT_SLIPPAGE_CAUGHT
        };
        amount_x_left = packed_uint128_math::decode_x(amounts_left);
        amount_y_left = packed_uint128_math::decode_y(amounts_left);
        return (amount_x_added, amount_y_added, amount_x_left, amount_y_left, deposit_ids, liquidity_minted)
    }

    fun get_amounts_in(versions: vector<Version>, pairs: vector<address>, token_path: vector<address>, amount_out: u256): vector<u256> {
        let amounts_in = vector::empty();
        amounts_in = unknown(vector::length(&token_path));
        *vector::borrow_mut(&mut amounts_in, (vector::length(&pairs) as u64)) = amount_out;
        let i: u256 = vector::length(&pairs);
        while ((i != 0)) {
            let token: address = *vector::borrow(&token_path, ((i - 1) as u64));
            let version: Version = *vector::borrow(&versions, ((i - 1) as u64));
            let pair: address = *vector::borrow(&pairs, ((i - 1) as u64));
            if ((version == V1)) {
                let (reserve_in, reserve_out, 2) = get_reserves(i_joe_pair(pair));
                if ((token > *vector::borrow(&token_path, (i as u64)))) {
                    (reserve_in, reserve_out) = (reserve_out, reserve_in);
                };
                let amount_out_: u256 = *vector::borrow(&amounts_in, (i as u64));
                *vector::borrow_mut(&mut amounts_in, ((i - 1) as u64)) = (get_amount_in(amount_out_, reserve_in, reserve_out) as u128);
            } else {
                if ((version == V2)) {
                    (*vector::borrow(&amounts_in, ((i - 1) as u64)), _1) = get_swap_in(state.legacy_router, i_l_b_legacy_pair(pair), (*vector::borrow(&amounts_in, (i as u64)) as u128), (token_x(i_l_b_legacy_pair(pair)) == token));
                } else {
                    (*vector::borrow(&amounts_in, ((i - 1) as u64)), _1, _2) = get_swap_in(i_l_b_pair(pair), (*vector::borrow(&amounts_in, (i as u64)) as u128), (get_token_x(i_l_b_pair(pair)) == token));
                };
            };
            i = (i - 1);
        }
        return amounts_in
    }

    fun remove_liquidity(account: &signer, pair: address, amount_x_min: u256, amount_y_min: u256, ids: vector<u256>, amounts: vector<u256>, to: address): (u256, u256) {
        let amount_x = 0u256;
        let amount_y = 0u256;
        let amounts_burned: vector<u256> = burn(pair, signer::address_of(account), to, ids, amounts);
        let i: u256;
        while ((i < (vector::length(&amounts_burned) as u256))) {
            amount_x += packed_uint128_math::decode_x(*vector::borrow(&amounts_burned, (i as u64)));
            amount_y += packed_uint128_math::decode_y(*vector::borrow(&amounts_burned, (i as u64)));
            i = (i + 1);
        }
        if (((amount_x < amount_x_min) || (amount_y < amount_y_min))) {
            abort E_L_B_ROUTER_AMOUNT_SLIPPAGE_CAUGHT
        };
        return (amount_x, amount_y)
    }

    fun swap_exact_tokens_for_tokens(amount_in: u256, pairs: vector<address>, versions: vector<Version>, token_path: vector<address>, to: address): u256 {
        let amount_out = 0u256;
        let token: address;
        let version: Version;
        let recipient: address;
        let pair: address;
        let token_next: address = *vector::borrow(&token_path, 0u64);
        amount_out = amount_in;
        let i: u256;
        while ((i < (vector::length(&pairs) as u256))) {
            pair = *vector::borrow(&pairs, (i as u64));
            version = *vector::borrow(&versions, (i as u64));
            token = token_next;
            token_next = *vector::borrow(&token_path, ((i + 1) as u64));
            recipient = if (((i + 1) == (vector::length(&pairs) as u256))) to else *vector::borrow(&pairs, ((i + 1) as u64));
            if ((version == V1)) {
                let (reserve0, reserve1, 2) = get_reserves(i_joe_pair(pair));
                if ((token < token_next)) {
                    amount_out = get_amount_out(amount_out, reserve0, reserve1);
                    swap(i_joe_pair(pair), 0, amount_out, recipient, string::utf8(b""));
                } else {
                    amount_out = get_amount_out(amount_out, reserve1, reserve0);
                    swap(i_joe_pair(pair), amount_out, 0, recipient, string::utf8(b""));
                };
            } else {
                if ((version == V2)) {
                    let swap_for_y: bool = (token_next == token_y(i_l_b_legacy_pair(pair)));
                    let (amount_x_out, amount_y_out) = swap(i_l_b_legacy_pair(pair), swap_for_y, recipient);
                    if (swap_for_y) {
                        amount_out = amount_y_out;
                    } else {
                        amount_out = amount_x_out;
                    };
                } else {
                    let swap_for_y: bool = (token_next == get_token_y(i_l_b_pair(pair)));
                    let (amount_x_out, amount_y_out) = packed_uint128_math::decode(swap(i_l_b_pair(pair), swap_for_y, recipient));
                    if (swap_for_y) {
                        amount_out = amount_y_out;
                    } else {
                        amount_out = amount_x_out;
                    };
                };
            };
            i = (i + 1);
        }
        return amount_out
    }

    fun swap_tokens_for_exact_tokens(pairs: vector<address>, versions: vector<Version>, token_path: vector<address>, amounts_in: vector<u256>, to: address): u256 {
        let amount_out = 0u256;
        let token: address;
        let recipient: address;
        let pair: address;
        let version: Version;
        let token_next: address = *vector::borrow(&token_path, 0u64);
        let i: u256;
        while ((i < (vector::length(&pairs) as u256))) {
            pair = *vector::borrow(&pairs, (i as u64));
            version = *vector::borrow(&versions, (i as u64));
            token = token_next;
            token_next = *vector::borrow(&token_path, ((i + 1) as u64));
            recipient = if (((i + 1) == (vector::length(&pairs) as u256))) to else *vector::borrow(&pairs, ((i + 1) as u64));
            if ((version == V1)) {
                amount_out = *vector::borrow(&amounts_in, ((i + 1) as u64));
                if ((token < token_next)) {
                    swap(i_joe_pair(pair), 0, amount_out, recipient, string::utf8(b""));
                } else {
                    swap(i_joe_pair(pair), amount_out, 0, recipient, string::utf8(b""));
                };
            } else {
                if ((version == V2)) {
                    let swap_for_y: bool = (token_next == token_y(i_l_b_legacy_pair(pair)));
                    let (amount_x_out, amount_y_out) = swap(i_l_b_legacy_pair(pair), swap_for_y, recipient);
                    if (swap_for_y) {
                        amount_out = amount_y_out;
                    } else {
                        amount_out = amount_x_out;
                    };
                } else {
                    let swap_for_y: bool = (token_next == get_token_y(i_l_b_pair(pair)));
                    let (amount_x_out, amount_y_out) = packed_uint128_math::decode(swap(i_l_b_pair(pair), swap_for_y, recipient));
                    if (swap_for_y) {
                        amount_out = amount_y_out;
                    } else {
                        amount_out = amount_x_out;
                    };
                };
            };
            i = (i + 1);
        }
        return amount_out
    }

    fun swap_supporting_fee_on_transfer_tokens(pairs: vector<address>, versions: vector<Version>, token_path: vector<address>, to: address) {
        let token: address;
        let version: Version;
        let recipient: address;
        let pair: address;
        let token_next: address = *vector::borrow(&token_path, 0u64);
        let i: u256;
        while ((i < (vector::length(&pairs) as u256))) {
            pair = *vector::borrow(&pairs, (i as u64));
            version = *vector::borrow(&versions, (i as u64));
            token = token_next;
            token_next = *vector::borrow(&token_path, ((i + 1) as u64));
            recipient = if (((i + 1) == (vector::length(&pairs) as u256))) to else *vector::borrow(&pairs, ((i + 1) as u64));
            if ((version == V1)) {
                let (reserve0, reserve1, 2) = get_reserves(i_joe_pair(pair));
                if ((token < token_next)) {
                    let amount_in: u256 = (balance_of(token, pair) - reserve0);
                    let amount_out: u256 = get_amount_out(amount_in, reserve0, reserve1);
                    swap(i_joe_pair(pair), 0, amount_out, recipient, string::utf8(b""));
                } else {
                    let amount_in: u256 = (balance_of(token, pair) - reserve1);
                    let amount_out: u256 = get_amount_out(amount_in, reserve1, reserve0);
                    swap(i_joe_pair(pair), amount_out, 0, recipient, string::utf8(b""));
                };
            } else {
                if ((version == V2)) {
                    swap(i_l_b_legacy_pair(pair), (token_next == token_y(i_l_b_legacy_pair(pair))), recipient);
                } else {
                    swap(i_l_b_pair(pair), (token_next == get_token_y(i_l_b_pair(pair))), recipient);
                };
            };
            i = (i + 1);
        }
    }

    fun get_l_b_pair_information(token_x: address, token_y: address, bin_step: u256, version: Version): address {
        let lb_pair = @0x0;
        if ((version == V2)) {
            lb_pair = (evm_compat::to_address(get_l_b_pair_information(state.legacy_factory, token_x, token_y, bin_step).l_b_pair) as address);
        } else {
            if ((version == V2_1)) {
                lb_pair = (evm_compat::to_address(get_l_b_pair_information(state.factory2_1, token_x, token_y, bin_step).l_b_pair) as address);
            } else {
                lb_pair = (evm_compat::to_address(get_l_b_pair_information(state.factory2_2, token_x, token_y, bin_step).l_b_pair) as address);
            };
        };
        if ((lb_pair == @0x0)) {
            abort E_L_B_ROUTER_PAIR_NOT_CREATED
        };
        return lb_pair
    }

    fun get_pair(token_x: address, token_y: address, bin_step: u256, version: Version): address {
        let pair = @0x0;
        if ((version == V1)) {
            pair = (get_pair(state.factory_v1, evm_compat::to_address(token_x), evm_compat::to_address(token_y)) as address);
            if ((pair == @0x0)) {
                abort E_L_B_ROUTER_PAIR_NOT_CREATED
            };
        } else {
            pair = (evm_compat::to_address(get_l_b_pair_information(token_x, token_y, bin_step, version)) as address);
        };
        return pair
    }

    fun get_pairs(pair_bin_steps: vector<u256>, versions: vector<Version>, token_path: vector<address>): vector<address> {
        let pairs = vector::empty();
        pairs = unknown(vector::length(&pair_bin_steps));
        let token: address;
        let token_next: address = *vector::borrow(&token_path, 0u64);
        let i: u256;
        while ((i < (vector::length(&pairs) as u256))) {
            token = token_next;
            token_next = *vector::borrow(&token_path, ((i + 1) as u64));
            *vector::borrow_mut(&mut pairs, (i as u64)) = get_pair(token, token_next, *vector::borrow(&pair_bin_steps, (i as u64)), *vector::borrow(&versions, (i as u64)));
            i = (i + 1);
        }
        return pairs
    }

    fun safe_transfer(token: address, to: address, amount: u256) {
        if ((amount == 0)) {
            return
        };
        token_helper::safe_transfer(token, to, amount);
    }

    fun safe_transfer_from(token: address, from: address, to: address, amount: u256) {
        if ((amount == 0)) {
            return
        };
        token_helper::safe_transfer_from(token, from, to, amount);
    }

    fun safe_transfer_native(to: address, amount: u256) {
        if ((amount == 0)) {
            return
        };
        let (success, 1) = unknown(string::utf8(b""));
        if (!success) {
            abort E_L_B_ROUTER_FAILED_TO_SEND_N_A_T_I_V_E
        };
    }

    fun w_native_deposit_and_transfer(to: address, amount: u256) {
        if ((amount == 0)) {
            return
        };
        unknown();
        token_helper::safe_transfer(IERC20(state.wnative), to, amount);
    }

    fun w_native_withdraw_and_transfer(to: address, amount: u256) {
        if ((amount == 0)) {
            return
        };
        withdraw(state.wnative, amount);
        safe_transfer_native(to, amount);
    }
}