module 0x1::l_b_pair {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use aptos_framework::timestamp;
    use aptos_framework::event;
    use transpiler::evm_compat;
    use aptos_std::bcs;
    use std::vector;
    use 0x1::pair_parameter_helper;
    use 0x1::packed_uint128_math;
    use 0x1::oracle_helper;
    use 0x1::sample_math;
    use 0x1::price_helper;
    use 0x1::uint256x256_math;
    use 0x1::fee_helper;
    use 0x1::bin_helper;
    use 0x1::hooks;
    use 0x1::safe_cast;
    use 0x1::l_b_token;

    // Error codes
    const _M_A_X_T_O_T_A_L_F_E_E: u256 = 100000000000000000u256;
    const MAX_SAMPLE_LIFETIME: u256 = 120u256;
    const SCALE_OFFSET: u8 = 128u8;
    const CALLBACK_SUCCESS: u256 = 35999145600493609714228594312006990784747406012369540695634741508663724398019u256;
    const PRECISION: u256 = 1000000000000000000u256;
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
    const E_MODIFIER_INITIALIZER: u64 = 256u64;
    const E_MODIFIER_NOT_ADDRESS_ZERO_OR_THIS: u64 = 257u64;
    const E_MODIFIER_CHECK_APPROVAL: u64 = 258u64;

    struct LBPairState has key {
        implementation: address,
        factory: address,
        parameters: u256,
        reserves: u256,
        protocol_fees: u256,
        bins: aptos_std::table::Table<u256, u256>,
        tree: TreeUint24,
        oracle: Oracle,
        hooks_parameters: u256,
        signer_cap: account::SignerCapability
    }

    public entry fun initialize(deployer: &signer, factory_: address) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"l_b_pair");
        disable_initializers();
        move_to(&resource_signer, LBPairState { implementation: /* unsupported expression */, factory: factory_, parameters: 0, reserves: 0, protocol_fees: 0, bins: table::new(), tree: 0, oracle: 0, hooks_parameters: 0, signer_cap: signer_cap });
    }

    public entry fun initialize(account: &signer, base_factor: u16, filter_period: u16, decay_period: u16, reduction_factor: u16, variable_fee_control: u32, protocol_share: u16, max_volatility_accumulator: u32, active_id: u32) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        only_factory(state);
        assert!(true, E_MODIFIER_INITIALIZER);
        __reentrancy_guard_init();
        set_static_fee_parameters(pair_parameter_helper::update_id_reference(pair_parameter_helper::set_active_id(state.parameters, active_id)), base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator, state);
    }

    #[view]
    public fun get_factory(): address acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let _factory = @0x0;
        return state.factory
    }

    public fun get_token_x(): address {
        let _token_x = @0x0;
        return token_x()
    }

    public fun get_token_y(): address {
        let _token_y = @0x0;
        return token_y()
    }

    public fun get_bin_step(): u16 {
        return bin_step()
    }

    #[view]
    public fun get_reserves(): (u128, u128) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let reserve_x = 0u128;
        let reserve_y = 0u128;
        (reserve_x, reserve_y) = packed_uint128_math::decode((state.reserves - state.protocol_fees));
        return (reserve_x, reserve_y)
    }

    #[view]
    public fun get_active_id(): u32 acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let active_id = 0u32;
        active_id = (pair_parameter_helper::get_active_id(state.parameters) as u32);
        return active_id
    }

    #[view]
    public fun get_bin(id: u32): (u128, u128) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let bin_reserve_x = 0u128;
        let bin_reserve_y = 0u128;
        (bin_reserve_x, bin_reserve_y) = packed_uint128_math::decode(*table::borrow_with_default(&state.bins, id, &0u256));
        return (bin_reserve_x, bin_reserve_y)
    }

    public fun get_next_non_empty_bin(swap_for_y: bool, id: u32): u32 {
        let next_id = 0u32;
        next_id = (get_next_non_empty_bin(swap_for_y, id, state) as u32);
        return next_id
    }

    #[view]
    public fun get_protocol_fees(): (u128, u128) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let protocol_fee_x = 0u128;
        let protocol_fee_y = 0u128;
        (protocol_fee_x, protocol_fee_y) = packed_uint128_math::decode(state.protocol_fees);
        return (protocol_fee_x, protocol_fee_y)
    }

    #[view]
    public fun get_static_fee_parameters(): (u16, u16, u16, u16, u32, u16, u32) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let base_factor = 0u16;
        let filter_period = 0u16;
        let decay_period = 0u16;
        let reduction_factor = 0u16;
        let variable_fee_control = 0u32;
        let protocol_share = 0u16;
        let max_volatility_accumulator = 0u32;
        let parameters: u256 = state.parameters;
        base_factor = (pair_parameter_helper::get_base_factor(parameters) as u16);
        filter_period = (pair_parameter_helper::get_filter_period(parameters) as u16);
        decay_period = (pair_parameter_helper::get_decay_period(parameters) as u16);
        reduction_factor = (pair_parameter_helper::get_reduction_factor(parameters) as u16);
        variable_fee_control = (pair_parameter_helper::get_variable_fee_control(parameters) as u32);
        protocol_share = (pair_parameter_helper::get_protocol_share(parameters) as u16);
        max_volatility_accumulator = (pair_parameter_helper::get_max_volatility_accumulator(parameters) as u32);
        return (base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator)
    }

    #[view]
    public fun get_l_b_hooks_parameters(): u256 acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        return state.hooks_parameters
    }

    #[view]
    public fun get_variable_fee_parameters(): (u32, u32, u32, u64) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let volatility_accumulator = 0u32;
        let volatility_reference = 0u32;
        let id_reference = 0u32;
        let time_of_last_update = 0u64;
        let parameters: u256 = state.parameters;
        volatility_accumulator = (pair_parameter_helper::get_volatility_accumulator(parameters) as u32);
        volatility_reference = (pair_parameter_helper::get_volatility_reference(parameters) as u32);
        id_reference = (pair_parameter_helper::get_id_reference(parameters) as u32);
        time_of_last_update = (pair_parameter_helper::get_time_of_last_update(parameters) as u64);
        return (volatility_accumulator, volatility_reference, id_reference, time_of_last_update)
    }

    #[view]
    public fun get_oracle_parameters(): (u8, u16, u16, u64, u64) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let sample_lifetime = 0u8;
        let size = 0u16;
        let active_size = 0u16;
        let last_updated = 0u64;
        let first_timestamp = 0u64;
        let parameters: u256 = state.parameters;
        sample_lifetime = (MAX_SAMPLE_LIFETIME as u8);
        let oracle_id: u16 = pair_parameter_helper::get_oracle_id(parameters);
        if ((oracle_id > 0)) {
            let sample: u256;
            (sample, active_size) = oracle_helper::get_active_sample_and_size(state.oracle, oracle_id);
            size = (sample_math::get_oracle_length(sample) as u16);
            last_updated = (sample_math::get_sample_last_update(sample) as u64);
            if ((last_updated == 0)) {
                active_size = (0 as u16);
            };
            if ((active_size > 0)) {
                sample = oracle_helper::get_sample(state.oracle, (1 + ((oracle_id % active_size))));
                first_timestamp = (sample_math::get_sample_last_update(sample) as u64);
            };
        };
        return (sample_lifetime, size, active_size, last_updated, first_timestamp)
    }

    #[view]
    public fun get_oracle_sample_at(lookup_timestamp: u64): (u64, u64, u64) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let cumulative_id = 0u64;
        let cumulative_volatility = 0u64;
        let cumulative_bin_crossed = 0u64;
        let parameters: u256 = state.parameters;
        let oracle_id: u16 = pair_parameter_helper::get_oracle_id(parameters);
        if (((oracle_id == 0) || ((lookup_timestamp as u256) > (timestamp::now_seconds() as u256)))) {
            return (0, 0, 0)
        };
        let time_of_last_update: u64;
        (time_of_last_update, cumulative_id, cumulative_volatility, cumulative_bin_crossed) = oracle_helper::get_sample_at(state.oracle, oracle_id, lookup_timestamp);
        if ((time_of_last_update < lookup_timestamp)) {
            parameters = pair_parameter_helper::update_volatility_parameters(parameters, pair_parameter_helper::get_active_id(parameters), lookup_timestamp);
            let delta_time: u64 = (lookup_timestamp - time_of_last_update);
            cumulative_id += (((pair_parameter_helper::get_active_id(parameters) as u64) * delta_time) as u64);
            cumulative_volatility += (((pair_parameter_helper::get_volatility_accumulator(parameters) as u64) * delta_time) as u64);
        };
        return (cumulative_id, cumulative_volatility, cumulative_bin_crossed)
    }

    public fun get_price_from_id(id: u32): u256 {
        let price = 0u256;
        price = price_helper::get_price_from_id(id, bin_step());
        return price
    }

    public fun get_id_from_price(price: u256): u32 {
        let id = 0u32;
        id = (price_helper::get_id_from_price(price, bin_step()) as u32);
        return id
    }

    #[view]
    public fun get_swap_in(amount_out: u128, swap_for_y: bool): (u128, u128, u128) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let amount_in = 0u128;
        let amount_out_left = 0u128;
        let fee = 0u128;
        amount_out_left = (amount_out as u128);
        let parameters: u256 = state.parameters;
        let bin_step: u16 = bin_step();
        let id: u32 = pair_parameter_helper::get_active_id(parameters);
        parameters = pair_parameter_helper::update_references(parameters, (timestamp::now_seconds() as u256));
        while (true) {
            let bin_reserves: u128 = packed_uint128_math::decode(*table::borrow_with_default(&state.bins, id, &0u256), !swap_for_y);
            if ((bin_reserves > 0)) {
                let price: u256 = price_helper::get_price_from_id(id, bin_step);
                let amount_out_of_bin: u128 = if ((bin_reserves > amount_out_left)) amount_out_left else bin_reserves;
                parameters = pair_parameter_helper::update_volatility_accumulator(parameters, id);
                let amount_in_without_fee: u128 = (if (swap_for_y) uint256x256_math::shift_div_round_up((amount_out_of_bin as u256), SCALE_OFFSET, price) else uint256x256_math::mul_shift_round_up((amount_out_of_bin as u256), price, SCALE_OFFSET) as u128);
                let total_fee: u128 = pair_parameter_helper::get_total_fee(parameters, bin_step);
                let fee_amount: u128 = fee_helper::get_fee_amount(amount_in_without_fee, total_fee);
                amount_in += (amount_in_without_fee + fee_amount);
                amount_out_left -= amount_out_of_bin;
                fee += fee_amount;
            };
            if ((amount_out_left == 0)) {
                break;
            } else {
                let next_id: u32 = get_next_non_empty_bin(swap_for_y, id, state);
                if (((next_id == 0) || (next_id == 16777215))) {
                    break;
                };
                id = next_id;
            };
        }
        return (amount_in, amount_out_left, fee)
    }

    #[view]
    public fun get_swap_out(amount_in: u128, swap_for_y: bool): (u128, u128, u128) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        let amount_in_left = 0u128;
        let amount_out = 0u128;
        let fee = 0u128;
        let amounts_in_left: u256 = packed_uint128_math::encode(amount_in, swap_for_y);
        let parameters: u256 = state.parameters;
        let bin_step: u16 = bin_step();
        let id: u32 = pair_parameter_helper::get_active_id(parameters);
        parameters = pair_parameter_helper::update_references(parameters, (timestamp::now_seconds() as u256));
        while (true) {
            let bin_reserves: u256 = *table::borrow_with_default(&state.bins, id, &0u256);
            if (!bin_helper::is_empty(bin_reserves, !swap_for_y)) {
                parameters = pair_parameter_helper::update_volatility_accumulator(parameters, id);
                let (amounts_in_with_fees, amounts_out_of_bin, total_fees) = bin_helper::get_amounts(bin_reserves, parameters, bin_step, swap_for_y, id, amounts_in_left);
                if ((amounts_in_with_fees > 0)) {
                    amounts_in_left = (amounts_in_left - amounts_in_with_fees);
                    amount_out += packed_uint128_math::decode(amounts_out_of_bin, !swap_for_y);
                    fee += packed_uint128_math::decode(total_fees, swap_for_y);
                };
            };
            if ((amounts_in_left == 0)) {
                break;
            } else {
                let next_id: u32 = get_next_non_empty_bin(swap_for_y, id, state);
                if (((next_id == 0) || (next_id == 16777215))) {
                    break;
                };
                id = next_id;
            };
        }
        amount_in_left = (packed_uint128_math::decode(amounts_in_left, swap_for_y) as u128);
        return (amount_in_left, amount_out, fee)
    }

    public fun swap(account: &signer, swap_for_y: bool, to: address): u256 acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        let amounts_out = 0u256;
        non_reentrant_before();
        let hooks_parameters: u256 = state.hooks_parameters;
        let reserves: u256 = state.reserves;
        let protocol_fees: u256 = state.protocol_fees;
        let amounts_left: u256 = if (swap_for_y) bin_helper::received_x(reserves, token_x()) else bin_helper::received_y(reserves, token_y());
        if ((amounts_left == 0)) {
            abort E_L_B_PAIR_INSUFFICIENT_AMOUNT_IN
        };
        let swap_for_y_: bool = swap_for_y;
        hooks::before_swap(hooks_parameters, signer::address_of(account), to, swap_for_y_, amounts_left);
        reserves = (reserves + amounts_left);
        let parameters: u256 = state.parameters;
        let bin_step: u16 = bin_step();
        let active_id: u32 = pair_parameter_helper::get_active_id(parameters);
        parameters = pair_parameter_helper::update_references(parameters, (timestamp::now_seconds() as u256));
        while (true) {
            let bin_reserves: u256 = *table::borrow_with_default(&state.bins, active_id, &0u256);
            if (!bin_helper::is_empty(bin_reserves, !swap_for_y_)) {
                parameters = pair_parameter_helper::update_volatility_accumulator(parameters, active_id);
                let (amounts_in_with_fees, amounts_out_of_bin, total_fees) = bin_helper::get_amounts(bin_reserves, parameters, bin_step, swap_for_y_, active_id, amounts_left);
                if ((amounts_in_with_fees > 0)) {
                    amounts_left = (amounts_left - amounts_in_with_fees);
                    amounts_out = (amounts_out + amounts_out_of_bin);
                    let p_fees: u256 = packed_uint128_math::scalar_mul_div_basis_point_round_down(total_fees, pair_parameter_helper::get_protocol_share(parameters));
                    if ((p_fees > 0)) {
                        protocol_fees = (protocol_fees + p_fees);
                        amounts_in_with_fees = (amounts_in_with_fees - p_fees);
                    };
                    *table::borrow_mut_with_default(&mut state.bins, active_id, 0u256) = ((bin_reserves + amounts_in_with_fees) - amounts_out_of_bin);
                    event::emit(Swap { arg0: signer::address_of(account), arg1: to, arg2: active_id, arg3: amounts_in_with_fees, arg4: amounts_out_of_bin, arg5: pair_parameter_helper::get_volatility_accumulator(parameters), arg6: total_fees, arg7: p_fees });
                };
            };
            if ((amounts_left == 0)) {
                break;
            } else {
                let next_id: u32 = get_next_non_empty_bin(swap_for_y_, active_id, state);
                if (((next_id == 0) || (next_id == 16777215))) {
                    abort E_L_B_PAIR_OUT_OF_LIQUIDITY
                };
                active_id = next_id;
            };
        }
        if ((amounts_out == 0)) {
            abort E_L_B_PAIR_INSUFFICIENT_AMOUNT_OUT
        };
        state.reserves = (reserves - amounts_out);
        state.protocol_fees = protocol_fees;
        parameters = oracle_helper::update(state.oracle, parameters, active_id);
        state.parameters = pair_parameter_helper::set_active_id(parameters, active_id);
        if (swap_for_y_) {
            bin_helper::transfer_y(amounts_out, token_y(), to);
        } else {
            bin_helper::transfer_x(amounts_out, token_x(), to);
        };
        non_reentrant_after();
        hooks::after_swap(hooks_parameters, signer::address_of(account), to, swap_for_y_, amounts_out);
        return amounts_out
    }

    public entry fun flash_loan(account: &signer, receiver: address, amounts: u256, data: vector<u8>) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        non_reentrant_before();
        if ((amounts == 0)) {
            abort E_L_B_PAIR_ZERO_BORROW_AMOUNT
        };
        let hooks_parameters: u256 = state.hooks_parameters;
        let reserves_before: u256 = state.reserves;
        let total_fees: u256 = get_flash_loan_fees(amounts, state);
        hooks::before_flash_loan(hooks_parameters, signer::address_of(account), evm_compat::to_address(receiver), amounts);
        bin_helper::transfer(amounts, token_x(), token_y(), evm_compat::to_address(receiver));
        let (success, r_data) = call(evm_compat::to_address(receiver), vector::empty<u8>());
        if (((!success || (vector::length(&r_data) != 32)) || (bcs::from_bytes(r_data) != CALLBACK_SUCCESS))) {
            abort E_L_B_PAIR_FLASH_LOAN_CALLBACK_FAILED
        };
        let balances_after: u256 = bin_helper::received((0 as u256), token_x(), token_y());
        if (packed_uint128_math::lt(balances_after, (reserves_before + total_fees))) {
            abort E_L_B_PAIR_FLASH_LOAN_INSUFFICIENT_AMOUNT
        };
        let fees_received: u256 = (balances_after - reserves_before);
        state.reserves = balances_after;
        state.protocol_fees = (state.protocol_fees + fees_received);
        event::emit(FlashLoan { arg0: signer::address_of(account), arg1: receiver, arg2: pair_parameter_helper::get_active_id(state.parameters), arg3: amounts, arg4: fees_received, arg5: fees_received });
        non_reentrant_after();
        hooks::after_flash_loan(hooks_parameters, signer::address_of(account), evm_compat::to_address(receiver), total_fees, fees_received);
    }

    public fun mint(account: &signer, to: address, liquidity_configs: vector<u256>, refund_to: address): (u256, u256, vector<u256>) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        let amounts_received = 0u256;
        let amounts_left = 0u256;
        let liquidity_minted = vector::empty();
        assert!(true, E_MODIFIER_NOT_ADDRESS_ZERO_OR_THIS);
        non_reentrant_before();
        if ((vector::length(&liquidity_configs) == 0)) {
            abort E_L_B_PAIR_EMPTY_MARKET_CONFIGS
        };
        let hooks_parameters: u256 = state.hooks_parameters;
        let arrays: MintArrays = mint_arrays(unknown(vector::length(&liquidity_configs)), unknown(vector::length(&liquidity_configs)), unknown(vector::length(&liquidity_configs)));
        let reserves: u256 = state.reserves;
        amounts_received = bin_helper::received(reserves, token_x(), token_y());
        hooks::before_mint(hooks_parameters, signer::address_of(account), to, liquidity_configs, amounts_received);
        amounts_left = mint_bins(liquidity_configs, amounts_received, to, arrays, state);
        state.reserves = (reserves + (amounts_received - amounts_left));
        liquidity_minted = arrays.liquidity_minted;
        event::emit(TransferBatch { arg0: signer::address_of(account), arg1: @0x0, arg2: to, arg3: arrays.ids, arg4: liquidity_minted });
        event::emit(DepositedToBins { arg0: signer::address_of(account), arg1: to, arg2: arrays.ids, arg3: arrays.amounts });
        if ((amounts_left > 0)) {
            bin_helper::transfer(amounts_left, token_x(), token_y(), refund_to);
        };
        non_reentrant_after();
        hooks::after_mint(hooks_parameters, signer::address_of(account), to, liquidity_configs, (amounts_received - amounts_left));
        return (amounts_received, amounts_left, liquidity_minted)
    }

    public fun burn(account: &signer, from: address, to: address, ids: vector<u256>, amounts_to_burn: vector<u256>): vector<u256> acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        let amounts = vector::empty();
        assert!(true, E_MODIFIER_CHECK_APPROVAL);
        non_reentrant_before();
        if (((vector::length(&ids) == 0) || (vector::length(&ids) != vector::length(&amounts_to_burn)))) {
            abort E_L_B_PAIR_INVALID_INPUT
        };
        let hooks_parameters: u256 = state.hooks_parameters;
        hooks::before_burn(hooks_parameters, signer::address_of(account), from, to, ids, amounts_to_burn);
        let from_: address = from;
        amounts = unknown(vector::length(&ids));
        let amounts_out: u256;
        let i: u256;
        while ((i < (vector::length(&ids) as u256))) {
            let id: u32 = safe_cast::safe24(*vector::borrow(&ids, (i as u64)));
            let amount_to_burn: u256 = *vector::borrow(&amounts_to_burn, (i as u64));
            if ((amount_to_burn == 0)) {
                abort E_L_B_PAIR_ZERO_AMOUNT
            };
            let bin_reserves: u256 = *table::borrow_with_default(&state.bins, id, &0u256);
            let supply: u256 = total_supply(id);
            burn(from_, id, amount_to_burn);
            let amounts_out_from_bin: u256 = bin_helper::get_amount_out_of_bin(bin_reserves, amount_to_burn, supply);
            if ((amounts_out_from_bin == 0)) {
                abort E_L_B_PAIR_ZERO_AMOUNTS_OUT
            };
            bin_reserves = (bin_reserves - amounts_out_from_bin);
            if ((supply == amount_to_burn)) {
                vector::remove_value(&mut state.tree, &id);
            };
            *table::borrow_mut_with_default(&mut state.bins, id, 0u256) = bin_reserves;
            *vector::borrow_mut(&mut amounts, (i as u64)) = amounts_out_from_bin;
            amounts_out = (amounts_out + amounts_out_from_bin);
            i = (i + 1);
        }
        state.reserves = (state.reserves - amounts_out);
        event::emit(TransferBatch { arg0: signer::address_of(account), arg1: from_, arg2: @0x0, arg3: ids, arg4: amounts_to_burn });
        event::emit(WithdrawnFromBins { arg0: signer::address_of(account), arg1: to, arg2: ids, arg3: amounts });
        bin_helper::transfer(amounts_out, token_x(), token_y(), to);
        non_reentrant_after();
        hooks::after_burn(hooks_parameters, signer::address_of(account), from_, to, ids, amounts_to_burn);
        return amounts
    }

    public fun collect_protocol_fees(account: &signer): u256 acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        let collected_protocol_fees = 0u256;
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        if ((signer::address_of(account) != get_fee_recipient(state.factory))) {
            abort E_L_B_PAIR_ONLY_PROTOCOL_FEE_RECIPIENT
        };
        let protocol_fees: u256 = state.protocol_fees;
        let (x, y) = packed_uint128_math::decode(protocol_fees);
        let ones: u256 = packed_uint128_math::encode((if ((x > 0)) 1 else 0 as u128), (if ((y > 0)) 1 else 0 as u128));
        collected_protocol_fees = (protocol_fees - ones);
        if ((collected_protocol_fees != 0)) {
            state.protocol_fees = ones;
            state.reserves = (state.reserves - collected_protocol_fees);
            event::emit(CollectedProtocolFees { arg0: signer::address_of(account), arg1: collected_protocol_fees });
            bin_helper::transfer(collected_protocol_fees, token_x(), token_y(), signer::address_of(account));
        };
        return collected_protocol_fees
    }

    public entry fun increase_oracle_length(account: &signer, new_length: u16) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        let parameters: u256 = state.parameters;
        let oracle_id: u16 = pair_parameter_helper::get_oracle_id(parameters);
        if ((oracle_id == 0)) {
            oracle_id = 1;
            state.parameters = pair_parameter_helper::set_oracle_id(parameters, oracle_id);
        };
        oracle_helper::increase_length(state.oracle, oracle_id, new_length);
        event::emit(OracleLengthIncreased { arg0: signer::address_of(account), arg1: new_length });
        state.reentrancy_status = 1u8;
    }

    public entry fun set_static_fee_parameters(account: &signer, base_factor: u16, filter_period: u16, decay_period: u16, reduction_factor: u16, variable_fee_control: u32, protocol_share: u16, max_volatility_accumulator: u32) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        only_factory(state);
        set_static_fee_parameters(state.parameters, base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator, state);
        state.reentrancy_status = 1u8;
    }

    public entry fun set_hooks_parameters(account: &signer, hooks_parameters: u256, on_hooks_set_data: vector<u8>) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        only_factory(state);
        state.hooks_parameters = hooks_parameters;
        let hooks: address = i_l_b_hooks(hooks::get_hooks(hooks_parameters));
        event::emit(HooksParametersSet { arg0: signer::address_of(account), arg1: hooks_parameters });
        if (((evm_compat::to_address(hooks) != @0x0) && (get_l_b_pair(hooks) != @0x1))) {
            abort E_L_B_PAIR_INVALID_HOOKS
        };
        hooks::on_hooks_set(hooks_parameters, on_hooks_set_data);
        state.reentrancy_status = 1u8;
    }

    public entry fun force_decay(account: &signer) acquires LBPairState {
        let state = borrow_global_mut<LBPairState>(@0x1);
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        only_factory(state);
        let parameters: u256 = state.parameters;
        state.parameters = pair_parameter_helper::update_volatility_reference(pair_parameter_helper::update_id_reference(parameters));
        event::emit(ForcedDecay { arg0: signer::address_of(account), arg1: pair_parameter_helper::get_id_reference(parameters), arg2: pair_parameter_helper::get_volatility_reference(parameters) });
        state.reentrancy_status = 1u8;
    }

    public entry fun batch_transfer_from(account: &signer, from: address, to: address, ids: vector<u256>, amounts: vector<u256>) acquires LBPairState {
        let state = borrow_global<LBPairState>(@0x1);
        non_reentrant_before();
        let hooks_parameters: u256 = state.hooks_parameters;
        hooks::before_batch_transfer_from(hooks_parameters, signer::address_of(account), from, to, ids, amounts);
        l_b_token::batch_transfer_from(from, to, ids, amounts);
        non_reentrant_after();
        hooks::after_batch_transfer_from(hooks_parameters, signer::address_of(account), from, to, ids, amounts);
    }

    public(package) fun token_x(): address {
        return IERC20(get_arg_address(0))
    }

    public(package) fun token_y(): address {
        return IERC20(get_arg_address(20))
    }

    public(package) fun bin_step(): u16 {
        return get_arg_uint16(40)
    }

    public(package) fun get_next_non_empty_bin(swap_for_y: bool, id: u32): u32 {
        return if (swap_for_y) find_first_right(state.tree, id) else find_first_left(state.tree, id)
    }

    #[view]
    fun only_factory(account: address, state: &LBPairState) {
        if ((account != evm_compat::to_address(state.factory))) {
            abort E_L_B_PAIR_ONLY_FACTORY
        };
    }

    #[view]
    fun get_flash_loan_fees(amounts: u256, state: &LBPairState): u256 {
        let fee: u128 = (get_flash_loan_fee(state.factory) as u128);
        let (x, y) = packed_uint128_math::decode(amounts);
        let precision_sub_one: u256 = (PRECISION - 1);
        x = safe_cast::safe128(((((((x as u256) * fee) + precision_sub_one)) / PRECISION)));
        y = safe_cast::safe128(((((((y as u256) * fee) + precision_sub_one)) / PRECISION)));
        return packed_uint128_math::encode(x, y)
    }

    public(package) fun set_static_fee_parameters(account: &signer, parameters: u256, base_factor: u16, filter_period: u16, decay_period: u16, reduction_factor: u16, variable_fee_control: u32, protocol_share: u16, max_volatility_accumulator: u32, state: &mut LBPairState) {
        if ((((((((base_factor == 0) && (filter_period == 0)) && (decay_period == 0)) && (reduction_factor == 0)) && (variable_fee_control == 0)) && (protocol_share == 0)) && (max_volatility_accumulator == 0))) {
            abort E_L_B_PAIR_INVALID_STATIC_FEE_PARAMETERS
        };
        parameters = pair_parameter_helper::set_static_fee_parameters(parameters, base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator);
        let bin_step: u16 = bin_step();
        let max_parameters: u256 = pair_parameter_helper::set_volatility_accumulator(parameters, max_volatility_accumulator);
        let total_fee: u256 = (pair_parameter_helper::get_base_fee(max_parameters, bin_step) + pair_parameter_helper::get_variable_fee(max_parameters, bin_step));
        if ((total_fee > _M_A_X_T_O_T_A_L_F_E_E)) {
            abort E_L_B_PAIR_MAX_TOTAL_FEE_EXCEEDED
        };
        state.parameters = parameters;
        event::emit(StaticFeeParametersSet { arg0: signer::address_of(account), arg1: base_factor, arg2: filter_period, arg3: decay_period, arg4: reduction_factor, arg5: variable_fee_control, arg6: protocol_share, arg7: max_volatility_accumulator });
    }

    fun mint_bins(liquidity_configs: vector<u256>, amounts_received: u256, to: address, arrays: MintArrays, state: &mut LBPairState): u256 {
        let amounts_left = 0u256;
        let bin_step: u16 = bin_step();
        let parameters: u256 = state.parameters;
        let active_id: u32 = pair_parameter_helper::get_active_id(parameters);
        amounts_left = amounts_received;
        let i: u256;
        while ((i < (vector::length(&liquidity_configs) as u256))) {
            let (max_amounts_in_to_bin, id) = get_amounts_and_id(*vector::borrow(&liquidity_configs, (i as u64)), amounts_received);
            let (shares, amounts_in, amounts_in_to_bin) = update_bin(bin_step, active_id, id, max_amounts_in_to_bin, parameters, state);
            amounts_left = (amounts_left - amounts_in);
            *vector::borrow_mut(&mut arrays.ids, (i as u64)) = id;
            *vector::borrow_mut(&mut arrays.amounts, (i as u64)) = amounts_in_to_bin;
            *vector::borrow_mut(&mut arrays.liquidity_minted, (i as u64)) = shares;
            mint(to, id, shares);
            i = (i + 1);
        }
        return amounts_left
    }

    public(package) fun update_bin(account: &signer, bin_step: u16, active_id: u32, id: u32, max_amounts_in_to_bin: u256, parameters: u256, state: &mut LBPairState): (u256, u256, u256) {
        let shares = 0u256;
        let amounts_in = 0u256;
        let amounts_in_to_bin = 0u256;
        let bin_reserves: u256 = *table::borrow_with_default(&state.bins, id, &0u256);
        let price: u256 = price_helper::get_price_from_id(id, bin_step);
        let supply: u256 = total_supply(id);
        (shares, amounts_in) = bin_helper::get_shares_and_effective_amounts_in(bin_reserves, max_amounts_in_to_bin, price, supply);
        amounts_in_to_bin = amounts_in;
        if ((id == active_id)) {
            parameters = pair_parameter_helper::update_volatility_parameters(parameters, id, (timestamp::now_seconds() as u256));
            let fees: u256 = bin_helper::get_composition_fees(bin_reserves, parameters, bin_step, amounts_in, supply, shares);
            if ((fees != 0)) {
                let user_liquidity: u256 = bin_helper::get_liquidity((amounts_in - fees), price);
                let protocol_c_fees: u256 = packed_uint128_math::scalar_mul_div_basis_point_round_down(fees, pair_parameter_helper::get_protocol_share(parameters));
                if ((protocol_c_fees != 0)) {
                    amounts_in_to_bin = (amounts_in_to_bin - protocol_c_fees);
                    state.protocol_fees = (state.protocol_fees + protocol_c_fees);
                };
                let bin_liquidity: u256 = bin_helper::get_liquidity((bin_reserves + (fees - protocol_c_fees)), price);
                shares = uint256x256_math::mul_div_round_down(user_liquidity, supply, bin_liquidity);
                parameters = oracle_helper::update(state.oracle, parameters, id);
                state.parameters = parameters;
                event::emit(CompositionFees { arg0: signer::address_of(account), arg1: id, arg2: fees, arg3: protocol_c_fees });
            };
        } else {
            bin_helper::verify_amounts(amounts_in, active_id, id);
        };
        if (((shares == 0) || (amounts_in_to_bin == 0))) {
            abort E_L_B_PAIR_ZERO_SHARES
        };
        if ((supply == 0)) {
            (state.tree + id);
        };
        *table::borrow_mut_with_default(&mut state.bins, id, 0u256) = (bin_reserves + amounts_in_to_bin);
        return (shares, amounts_in, amounts_in_to_bin)
    }
}