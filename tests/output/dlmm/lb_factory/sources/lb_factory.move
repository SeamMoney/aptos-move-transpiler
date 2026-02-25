module 0x1::lb_factory {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use aptos_framework::event;
    use std::vector;
    use transpiler::evm_compat;
    use aptos_std::bcs;
    use aptos_std::aptos_hash;
    use 0x1::pair_parameter_helper;
    use 0x1::encoded;
    use 0x1::safe_cast;
    use 0x1::price_helper;
    use 0x1::immutable_clone;
    use 0x1::hooks;

    // Error codes
    const LB_HOOKS_MANAGER_ROLE: u256 = 0u256;
    const _OFFSET_IS_PRESET_OPEN: u256 = 255u256;
    const _MIN_BIN_STEP: u256 = 1u256;
    const _MAX_FLASHLOAN_FEE: u256 = 100000000000000000u256;
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
    const E_LB_FACTORY_FLASH_LOAN_FEE_ABOVE_MAX: u64 = 256u64;
    const E_LB_FACTORY_BIN_STEP_HAS_NO_PRESET: u64 = 257u64;
    const E_LB_FACTORY_LB_PAIR_SAFETY_CHECK_FAILED: u64 = 258u64;
    const E_LB_FACTORY_SAME_IMPLEMENTATION: u64 = 259u64;
    const E_LB_FACTORY_PRESET_IS_LOCKED_FOR_USERS: u64 = 260u64;
    const E_LB_FACTORY_QUOTE_ASSET_NOT_WHITELISTED: u64 = 261u64;
    const E_LB_FACTORY_IDENTICAL_ADDRESSES: u64 = 262u64;
    const E_LB_FACTORY_ADDRESS_ZERO: u64 = 263u64;
    const E_LB_FACTORY_LB_PAIR_ALREADY_EXISTS: u64 = 264u64;
    const E_LB_FACTORY_IMPLEMENTATION_NOT_SET: u64 = 265u64;
    const E_LB_FACTORY_LB_PAIR_DOES_NOT_EXIST: u64 = 266u64;
    const E_LB_FACTORY_LB_PAIR_IGNORED_IS_ALREADY_IN_THE_SAME_STATE: u64 = 267u64;
    const E_LB_FACTORY_BIN_STEP_TOO_LOW: u64 = 268u64;
    const E_LB_FACTORY_PRESET_OPEN_STATE_IS_ALREADY_IN_THE_SAME_STATE: u64 = 269u64;
    const E_LB_FACTORY_LB_PAIR_NOT_CREATED: u64 = 270u64;
    const E_LB_FACTORY_INVALID_HOOKS_PARAMETERS: u64 = 271u64;
    const E_LB_FACTORY_SAME_FLASH_LOAN_FEE: u64 = 272u64;
    const E_LB_FACTORY_QUOTE_ASSET_ALREADY_WHITELISTED: u64 = 273u64;
    const E_LB_FACTORY_SAME_FEE_RECIPIENT: u64 = 274u64;
    const E_LB_FACTORY_SAME_HOOKS_PARAMETERS: u64 = 275u64;
    const E_LB_FACTORY_CANNOT_GRANT_DEFAULT_ADMIN_ROLE: u64 = 276u64;

    struct LBFactoryState has key {
        fee_recipient: address,
        flash_loan_fee: u256,
        lb_pair_implementation: address,
        all_lb_pairs: vector<address>,
        lb_pairs_info: aptos_std::table::Table<address, aptos_std::table::Table<address, aptos_std::table::Table<u256, LBPairInformation>>>,
        presets: aptos_std::table::Table<u256, u256>,
        quote_asset_whitelist: vector<address>,
        available_lb_pair_bin_steps: aptos_std::table::Table<address, aptos_std::table::Table<address, vector<u256>>>,
        signer_cap: account::SignerCapability
    }

    public entry fun initialize(deployer: &signer, fee_recipient: address, initial_owner: address, flash_loan_fee: u256) {
        let (_resource_signer, signer_cap) = account::create_resource_account(deployer, b"lb_factory");
        if ((flash_loan_fee > _MAX_FLASHLOAN_FEE)) {
            abort E_LB_FACTORY_FLASH_LOAN_FEE_ABOVE_MAX
        };
        set_fee_recipient(fee_recipient, state);
        event::emit(FlashLoanFeeSet { arg0: 0, arg1: flash_loan_fee });
        move_to(deployer, LBFactoryState { fee_recipient: @0x0, flash_loan_fee: flash_loan_fee, lb_pair_implementation: @0x0, all_lb_pairs: vector::empty(), lb_pairs_info: table::new(), presets: table::new(), quote_asset_whitelist: vector::empty(), available_lb_pair_bin_steps: table::new(), signer_cap: signer_cap });
    }

    public fun get_min_bin_step(): u256 {
        let _min_bin_step = 0u256;
        return _MIN_BIN_STEP
    }

    #[view]
    public fun get_fee_recipient(): address acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _fee_recipient = @0x0;
        return state.fee_recipient
    }

    public fun get_max_flash_loan_fee(): u256 {
        let _max_fee = 0u256;
        return _MAX_FLASHLOAN_FEE
    }

    #[view]
    public fun get_flash_loan_fee(): u256 acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _flash_loan_fee = 0u256;
        return state.flash_loan_fee
    }

    #[view]
    public fun get_lb_pair_implementation(): address acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _lb_pair_implementation = @0x0;
        return state.lb_pair_implementation
    }

    #[view]
    public fun get_number_of_lb_pairs(): u256 acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _lb_pair_number = 0u256;
        return vector::length(&state.all_lb_pairs)
    }

    #[view]
    public fun get_lb_pair_at_index(index: u256): address acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _lb_pair = @0x0;
        return *vector::borrow(&state.all_lb_pairs, (index as u64))
    }

    #[view]
    public fun get_number_of_quote_assets(): u256 acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _number_of_quote_assets = 0u256;
        return vector::length(&state.quote_asset_whitelist)
    }

    #[view]
    public fun get_quote_asset_at_index(index: u256): address acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _asset = @0x0;
        return IERC20(*vector::borrow(&state.quote_asset_whitelist, (index as u64)))
    }

    #[view]
    public fun is_quote_asset(token: address): bool acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _is_quote = false;
        return vector::contains(&state.quote_asset_whitelist, &evm_compat::to_address(token))
    }

    public fun get_lb_pair_information(token_a: address, token_b: address, bin_step: u256): LBPairInformation {
        let _lb_pair_information = 0u256;
        return get_lb_pair_information(token_a, token_b, bin_step, state)
    }

    #[view]
    public fun get_preset(bin_step: u256): (u256, u256, u256, u256, u256, u256, u256, bool) acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let base_factor = 0u256;
        let filter_period = 0u256;
        let decay_period = 0u256;
        let reduction_factor = 0u256;
        let variable_fee_control = 0u256;
        let protocol_share = 0u256;
        let max_volatility_accumulator = 0u256;
        let is_open = false;
        if (!table::contains(&state.presets, bin_step)) {
            abort E_LB_FACTORY_BIN_STEP_HAS_NO_PRESET
        };
        let preset: u256 = (*table::borrow(&state.presets, bin_step) as u256);
        base_factor = pair_parameter_helper::get_base_factor(preset);
        filter_period = pair_parameter_helper::get_filter_period(preset);
        decay_period = pair_parameter_helper::get_decay_period(preset);
        reduction_factor = pair_parameter_helper::get_reduction_factor(preset);
        variable_fee_control = pair_parameter_helper::get_variable_fee_control(preset);
        protocol_share = pair_parameter_helper::get_protocol_share(preset);
        max_volatility_accumulator = pair_parameter_helper::get_max_volatility_accumulator(preset);
        is_open = (encoded::decode_bool(preset, _OFFSET_IS_PRESET_OPEN) != 0);
        return (base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator, is_open)
    }

    #[view]
    public fun get_all_bin_steps(): vector<u256> acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let _bin_step_with_preset = vector::empty();
        return state.presets
    }

    #[view]
    public fun get_open_bin_steps(): vector<u256> acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let open_bin_step = vector::empty();
        let length: u256 = table::length(&state.presets);
        if ((length > 0)) {
            open_bin_step = vector::empty<unknown>();
            let index: u256;
            let i: u256;
            while ((i < length)) {
                let (bin_step, preset) = *table::borrow(&state.presets, i);
                if (is_preset_open((preset as u256))) {
                    *vector::borrow_mut(&mut open_bin_step, (index as u64)) = bin_step;
                    index = (index + 1);
                };
                i = (i + 1);
            }
            if ((index < length)) {
                0;
            };
        };
        return open_bin_step
    }

    #[view]
    public fun get_all_lb_pairs(token_x: address, token_y: address): vector<LBPairInformation> acquires LBFactoryState {
        let state = borrow_global<LBFactoryState>(@0x1);
        let lb_pairs_available = vector::empty();
        let (token_a, token_b) = sort_tokens(token_x, token_y);
        let address_set: vector<u256> = *table::borrow_with_default(table::borrow(&state.available_lb_pair_bin_steps, token_a), token_b, &vector::empty());
        let length: u256 = vector::length(&address_set);
        if ((length > 0)) {
            lb_pairs_available = vector::empty<unknown>();
            let lb_pairs_info: aptos_std::table::Table<u256, LBPairInformation> = table::borrow(table::borrow(&state.lb_pairs_info, token_a), token_b);
            let i: u256 = 0;
            while ((i < length)) {
                let bin_step: u16 = safe_cast::safe16(*vector::borrow(&address_set, (i as u64)));
                *vector::borrow_mut(&mut lb_pairs_available, (i as u64)) = lb_pair_information(bin_step, (*table::borrow_with_default(&lb_pairs_info, bin_step, &0u256)).lb_pair, (*table::borrow_with_default(&lb_pairs_info, bin_step, &0u256)).created_by_owner, (*table::borrow_with_default(&lb_pairs_info, bin_step, &0u256)).ignored_for_routing);
                i = (i + 1);
            }
        };
        return lb_pairs_available
    }

    public entry fun set_lb_pair_implementation(account: &signer, new_lb_pair_implementation: address) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        if ((get_factory(ilb_pair(new_lb_pair_implementation)) != @0x1)) {
            abort E_LB_FACTORY_LB_PAIR_SAFETY_CHECK_FAILED
        };
        let old_lb_pair_implementation: address = state.lb_pair_implementation;
        if ((old_lb_pair_implementation == new_lb_pair_implementation)) {
            abort E_LB_FACTORY_SAME_IMPLEMENTATION
        };
        state.lb_pair_implementation = new_lb_pair_implementation;
        event::emit(LBPairImplementationSet { arg0: old_lb_pair_implementation, arg1: new_lb_pair_implementation });
    }

    public fun create_lb_pair(account: &signer, token_x: address, token_y: address, active_id: u32, bin_step: u16): address acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        let pair = @0x0;
        if (!table::contains(&state.presets, bin_step)) {
            abort E_LB_FACTORY_BIN_STEP_HAS_NO_PRESET
        };
        let preset: u256 = (*table::borrow(&state.presets, bin_step) as u256);
        let is_owner: bool = (signer::address_of(account) == owner());
        if ((!is_preset_open(preset) && !is_owner)) {
            abort E_LB_FACTORY_PRESET_IS_LOCKED_FOR_USERS
        };
        if (!vector::contains(&state.quote_asset_whitelist, &evm_compat::to_address(token_y))) {
            abort E_LB_FACTORY_QUOTE_ASSET_NOT_WHITELISTED
        };
        if ((token_x == token_y)) {
            abort E_LB_FACTORY_IDENTICAL_ADDRESSES
        };
        price_helper::get_price_from_id(active_id, bin_step);
        let (token_a, token_b) = sort_tokens(token_x, token_y);
        if ((evm_compat::to_address(token_a) == @0x0)) {
            abort E_LB_FACTORY_ADDRESS_ZERO
        };
        if ((evm_compat::to_address((*table::borrow_with_default(table::borrow(table::borrow(&state.lb_pairs_info, token_a), token_b), bin_step, &0u256)).lb_pair) != @0x0)) {
            abort E_LB_FACTORY_LB_PAIR_ALREADY_EXISTS
        };
        let implementation: address = state.lb_pair_implementation;
        if ((implementation == @0x0)) {
            abort E_LB_FACTORY_IMPLEMENTATION_NOT_SET
        };
        pair = (ilb_pair(immutable_clone::clone_deterministic(implementation, {
        let __bytes = bcs::to_bytes(&token_x);
        vector::append(&mut __bytes, bcs::to_bytes(&token_y));
        vector::append(&mut __bytes, bcs::to_bytes(&bin_step));
        __bytes
    }, evm_compat::bytes_to_u256(aptos_hash::keccak256({
        let __bytes = bcs::to_bytes(&token_a);
        vector::append(&mut __bytes, bcs::to_bytes(&token_b));
        vector::append(&mut __bytes, bcs::to_bytes(&bin_step));
        __bytes
    })))) as address);
        if (!table::contains(&state.lb_pairs_info, token_a)) {
            table::add(&mut state.lb_pairs_info, token_a, table::new());
        };
        *table::borrow_mut(&mut *table::borrow_mut(&mut *table::borrow_mut(&mut state.lb_pairs_info, token_a), token_b), bin_step) = lb_pair_information(bin_step, pair, is_owner, false);
        push(state.all_lb_pairs, pair);
        (*table::borrow_with_default(table::borrow(&state.available_lb_pair_bin_steps, token_a), token_b, &vector::empty()) + bin_step);
        event::emit(LBPairCreated { arg0: token_x, arg1: token_y, arg2: bin_step, arg3: pair, arg4: (vector::length(&state.all_lb_pairs) - 1) });
        initialize(pair, pair_parameter_helper::get_base_factor(preset), pair_parameter_helper::get_filter_period(preset), pair_parameter_helper::get_decay_period(preset), pair_parameter_helper::get_reduction_factor(preset), pair_parameter_helper::get_variable_fee_control(preset), pair_parameter_helper::get_protocol_share(preset), pair_parameter_helper::get_max_volatility_accumulator(preset), active_id);
        return pair
    }

    public entry fun set_lb_pair_ignored(account: &signer, token_x: address, token_y: address, bin_step: u16, ignored: bool) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        let (token_a, token_b) = sort_tokens(token_x, token_y);
        let pair_information: LBPairInformation = *table::borrow_with_default(table::borrow(table::borrow(&state.lb_pairs_info, token_a), token_b), bin_step, &0u256);
        if ((evm_compat::to_address(pair_information.lb_pair) == @0x0)) {
            abort E_LB_FACTORY_LB_PAIR_DOES_NOT_EXIST
        };
        if ((pair_information.ignored_for_routing == ignored)) {
            abort E_LB_FACTORY_LB_PAIR_IGNORED_IS_ALREADY_IN_THE_SAME_STATE
        };
        if (!table::contains(&state.lb_pairs_info, token_a)) {
            table::add(&mut state.lb_pairs_info, token_a, table::new());
        };
        (*table::borrow_mut(&mut *table::borrow_mut(&mut *table::borrow_mut(&mut state.lb_pairs_info, token_a), token_b), bin_step)).ignored_for_routing = ignored;
        event::emit(LBPairIgnoredStateChanged { arg0: pair_information.lb_pair, arg1: ignored });
    }

    public entry fun set_preset(account: &signer, bin_step: u16, base_factor: u16, filter_period: u16, decay_period: u16, reduction_factor: u16, variable_fee_control: u32, protocol_share: u16, max_volatility_accumulator: u32, is_open: bool) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        if (((bin_step as u256) < _MIN_BIN_STEP)) {
            abort E_LB_FACTORY_BIN_STEP_TOO_LOW
        };
        let preset: u256 = pair_parameter_helper::set_static_fee_parameters((0 as u256), base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator);
        if (is_open) {
            preset = encoded::set_bool(preset, true, _OFFSET_IS_PRESET_OPEN);
        };
        table::upsert(&mut state.presets, bin_step, (preset as u256));
        event::emit(PresetSet { arg0: bin_step, arg1: base_factor, arg2: filter_period, arg3: decay_period, arg4: reduction_factor, arg5: variable_fee_control, arg6: protocol_share, arg7: max_volatility_accumulator });
        event::emit(PresetOpenStateChanged { arg0: bin_step, arg1: is_open });
    }

    public entry fun set_preset_open_state(account: &signer, bin_step: u16, is_open: bool) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        if (!table::contains(&state.presets, bin_step)) {
            abort E_LB_FACTORY_BIN_STEP_HAS_NO_PRESET
        };
        let preset: u256 = (*table::borrow(&state.presets, bin_step) as u256);
        if ((encoded::decode_bool(preset, _OFFSET_IS_PRESET_OPEN) == is_open)) {
            abort E_LB_FACTORY_PRESET_OPEN_STATE_IS_ALREADY_IN_THE_SAME_STATE
        };
        table::upsert(&mut state.presets, bin_step, (encoded::set_bool(preset, is_open, _OFFSET_IS_PRESET_OPEN) as u256));
        event::emit(PresetOpenStateChanged { arg0: bin_step, arg1: is_open });
    }

    public entry fun remove_preset(account: &signer, bin_step: u16) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        if (!table::remove(&mut state.presets, bin_step)) {
            abort E_LB_FACTORY_BIN_STEP_HAS_NO_PRESET
        };
        event::emit(PresetRemoved { arg0: bin_step });
    }

    public entry fun set_fees_parameters_on_pair(account: &signer, token_x: address, token_y: address, bin_step: u16, base_factor: u16, filter_period: u16, decay_period: u16, reduction_factor: u16, variable_fee_control: u32, protocol_share: u16, max_volatility_accumulator: u32) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        let lb_pair: address = get_lb_pair_information(token_x, token_y, bin_step, state).lb_pair;
        if ((evm_compat::to_address(lb_pair) == @0x0)) {
            abort E_LB_FACTORY_LB_PAIR_NOT_CREATED
        };
        pair_parameter_helper::set_static_fee_parameters(lb_pair, base_factor, filter_period, decay_period, reduction_factor, variable_fee_control, protocol_share, max_volatility_accumulator);
    }

    public entry fun set_lb_hooks_parameters_on_pair(account: &signer, token_x: address, token_y: address, bin_step: u16, hooks_parameters: u256, on_hooks_set_data: vector<u8>) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!(table::contains(&state.roles, signer::address_of(account)), E_UNAUTHORIZED);
        if (((hooks::get_hooks(hooks_parameters) == @0x0) || (hooks::get_flags(hooks_parameters) == 0))) {
            abort E_LB_FACTORY_INVALID_HOOKS_PARAMETERS
        };
        set_lb_hooks_parameters_on_pair(token_x, token_y, bin_step, hooks_parameters, on_hooks_set_data);
    }

    public entry fun remove_lb_hooks_on_pair(account: &signer, token_x: address, token_y: address, bin_step: u16) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!(table::contains(&state.roles, signer::address_of(account)), E_UNAUTHORIZED);
        set_lb_hooks_parameters_on_pair(token_x, token_y, bin_step, 0, vector::empty<u8>());
    }

    public entry fun set_fee_recipient(account: &signer, fee_recipient: address) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        set_fee_recipient(fee_recipient, state);
    }

    public entry fun set_flash_loan_fee(account: &signer, flash_loan_fee: u256) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        let old_flash_loan_fee: u256 = state.flash_loan_fee;
        if ((old_flash_loan_fee == flash_loan_fee)) {
            abort E_LB_FACTORY_SAME_FLASH_LOAN_FEE
        };
        if ((flash_loan_fee > _MAX_FLASHLOAN_FEE)) {
            abort E_LB_FACTORY_FLASH_LOAN_FEE_ABOVE_MAX
        };
        state.flash_loan_fee = flash_loan_fee;
        event::emit(FlashLoanFeeSet { arg0: old_flash_loan_fee, arg1: flash_loan_fee });
    }

    public entry fun add_quote_asset(account: &signer, quote_asset: address) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        if (!(state.quote_asset_whitelist + evm_compat::to_address(quote_asset))) {
            abort E_LB_FACTORY_QUOTE_ASSET_ALREADY_WHITELISTED
        };
        event::emit(QuoteAssetAdded { arg0: quote_asset });
    }

    public entry fun remove_quote_asset(account: &signer, quote_asset: address) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        if (!vector::remove_value(&mut state.quote_asset_whitelist, &evm_compat::to_address(quote_asset))) {
            abort E_LB_FACTORY_QUOTE_ASSET_NOT_WHITELISTED
        };
        event::emit(QuoteAssetRemoved { arg0: quote_asset });
    }

    public(package) fun is_preset_open(preset: u256): bool {
        return encoded::decode_bool(preset, _OFFSET_IS_PRESET_OPEN)
    }

    public(package) fun set_fee_recipient(fee_recipient: address, state: &mut LBFactoryState) {
        if ((fee_recipient == @0x0)) {
            abort E_LB_FACTORY_ADDRESS_ZERO
        };
        let old_fee_recipient: address = state.fee_recipient;
        if ((old_fee_recipient == fee_recipient)) {
            abort E_LB_FACTORY_SAME_FEE_RECIPIENT
        };
        state.fee_recipient = fee_recipient;
        event::emit(FeeRecipientSet { arg0: old_fee_recipient, arg1: fee_recipient });
    }

    public entry fun force_decay(account: &signer, pair: address) acquires LBFactoryState {
        let state = borrow_global_mut<LBFactoryState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        force_decay(pair);
    }

    #[view]
    fun get_lb_pair_information(token_a: address, token_b: address, bin_step: u256, state: &LBFactoryState): LBPairInformation {
        (token_a, token_b) = sort_tokens(token_a, token_b);
        return *table::borrow_with_default(table::borrow(table::borrow(&state.lb_pairs_info, token_a), token_b), bin_step, &0u256)
    }

    fun sort_tokens(token_a: address, token_b: address): (address, address) {
        if ((token_a > token_b)) {
            (token_a, token_b) = (token_b, token_a);
        };
        return (token_a, token_b)
    }

    public(package) fun set_lb_hooks_parameters_on_pair(token_x: address, token_y: address, bin_step: u16, hooks_parameters: u256, on_hooks_set_data: vector<u8>) {
        let lb_pair: address = get_lb_pair_information(token_x, token_y, bin_step, state).lb_pair;
        if ((evm_compat::to_address(lb_pair) == @0x0)) {
            abort E_LB_FACTORY_LB_PAIR_NOT_CREATED
        };
        if ((get_lb_hooks_parameters(lb_pair) == hooks_parameters)) {
            abort E_LB_FACTORY_SAME_HOOKS_PARAMETERS
        };
        set_hooks_parameters(lb_pair, hooks_parameters, on_hooks_set_data);
    }

    public fun has_role(role: u256, account: address): bool {
        if ((role == DEFAULT_ADMIN_ROLE)) {
            return (account == owner())
        };
        return has_role(role, account)
    }

    public(package) fun grant_role(role: u256, account: address): bool {
        if ((role == DEFAULT_ADMIN_ROLE)) {
            abort E_LB_FACTORY_CANNOT_GRANT_DEFAULT_ADMIN_ROLE
        };
        return grant_role(role, account)
    }
}