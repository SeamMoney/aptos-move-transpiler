module 0x1::pair_parameter_helper {

    // Error codes
    const OFFSET_BASE_FACTOR: u256 = 0u256;
    const OFFSET_FILTER_PERIOD: u256 = 16u256;
    const OFFSET_DECAY_PERIOD: u256 = 28u256;
    const OFFSET_REDUCTION_FACTOR: u256 = 40u256;
    const OFFSET_VAR_FEE_CONTROL: u256 = 54u256;
    const OFFSET_PROTOCOL_SHARE: u256 = 78u256;
    const OFFSET_MAX_VOL_ACC: u256 = 92u256;
    const OFFSET_VOL_ACC: u256 = 112u256;
    const OFFSET_VOL_REF: u256 = 132u256;
    const OFFSET_ID_REF: u256 = 152u256;
    const OFFSET_TIME_LAST_UPDATE: u256 = 176u256;
    const OFFSET_ORACLE_ID: u256 = 216u256;
    const OFFSET_ACTIVE_ID: u256 = 232u256;
    const MASK_STATIC_PARAMETER: u256 = 0xffffffffffffffffffffffffffffu256;
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
    const E_PAIR_PARAMETERS_HELPER_INVALID_PARAMETER: u64 = 256u64;

    public(package) fun get_base_factor(params: u256): u16 {
        let base_factor = 0u16;
        base_factor = (decode_uint16(params, OFFSET_BASE_FACTOR) as u16);
        base_factor
    }

    public(package) fun get_filter_period(params: u256): u16 {
        let filter_period = 0u16;
        filter_period = (decode_uint12(params, OFFSET_FILTER_PERIOD) as u16);
        filter_period
    }

    public(package) fun get_decay_period(params: u256): u16 {
        let decay_period = 0u16;
        decay_period = (decode_uint12(params, OFFSET_DECAY_PERIOD) as u16);
        decay_period
    }

    public(package) fun get_reduction_factor(params: u256): u16 {
        let reduction_factor = 0u16;
        reduction_factor = (decode_uint14(params, OFFSET_REDUCTION_FACTOR) as u16);
        reduction_factor
    }

    public(package) fun get_variable_fee_control(params: u256): u32 {
        let variable_fee_control = 0u32;
        variable_fee_control = (decode_uint24(params, OFFSET_VAR_FEE_CONTROL) as u32);
        variable_fee_control
    }

    public(package) fun get_protocol_share(params: u256): u16 {
        let protocol_share = 0u16;
        protocol_share = (decode_uint14(params, OFFSET_PROTOCOL_SHARE) as u16);
        protocol_share
    }

    public(package) fun get_max_volatility_accumulator(params: u256): u32 {
        let max_volatility_accumulator = 0u32;
        max_volatility_accumulator = (decode_uint20(params, OFFSET_MAX_VOL_ACC) as u32);
        max_volatility_accumulator
    }

    public(package) fun get_volatility_accumulator(params: u256): u32 {
        let volatility_accumulator = 0u32;
        volatility_accumulator = (decode_uint20(params, OFFSET_VOL_ACC) as u32);
        volatility_accumulator
    }

    public(package) fun get_volatility_reference(params: u256): u32 {
        let volatility_reference = 0u32;
        volatility_reference = (decode_uint20(params, OFFSET_VOL_REF) as u32);
        volatility_reference
    }

    public(package) fun get_id_reference(params: u256): u32 {
        let id_reference = 0u32;
        id_reference = (decode_uint24(params, OFFSET_ID_REF) as u32);
        id_reference
    }

    public(package) fun get_time_of_last_update(params: u256): u64 {
        let time_oflast_update = 0u64;
        time_oflast_update = (decode_uint40(params, OFFSET_TIME_LAST_UPDATE) as u64);
        time_oflast_update
    }

    public(package) fun get_oracle_id(params: u256): u16 {
        let oracle_id = 0u16;
        oracle_id = (decode_uint16(params, OFFSET_ORACLE_ID) as u16);
        oracle_id
    }

    public(package) fun get_active_id(params: u256): u32 {
        let active_id = 0u32;
        active_id = (decode_uint24(params, OFFSET_ACTIVE_ID) as u32);
        active_id
    }

    public(package) fun get_delta_id(params: u256, active_id: u32): u32 {
        let id: u32 = get_active_id(params);
        if ((active_id > id)) (active_id - id) else (id - active_id)
    }

    public(package) fun get_base_fee(params: u256, bin_step: u16): u256 {
        (((get_base_factor(params) as u256) * bin_step) * 10000000000)
    }

    public(package) fun get_variable_fee(params: u256, bin_step: u16): u256 {
        let variable_fee = 0u256;
        let variable_fee_control: u256 = get_variable_fee_control(params);
        if ((variable_fee_control != 0)) {
            let prod: u256 = ((get_volatility_accumulator(params) as u256) * bin_step);
            variable_fee = (((((prod * prod) * variable_fee_control) + 99)) / 100);
        };
        variable_fee
    }

    public(package) fun get_total_fee(params: u256, bin_step: u16): u128 {
        safe128(((get_base_fee(params, bin_step) + get_variable_fee(params, bin_step))))
    }

    public(package) fun set_oracle_id(params: u256, oracle_id: u16): u256 {
        set(params, oracle_id, MASK_UINT16, OFFSET_ORACLE_ID)
    }

    public(package) fun set_volatility_reference(params: u256, vol_ref: u32): u256 {
        if ((vol_ref > MASK_UINT20)) {
            abort E_PAIR_PARAMETERS_HELPER_INVALID_PARAMETER
        };
        set(params, vol_ref, MASK_UINT20, OFFSET_VOL_REF)
    }

    public(package) fun set_volatility_accumulator(params: u256, vol_acc: u32): u256 {
        if ((vol_acc > MASK_UINT20)) {
            abort E_PAIR_PARAMETERS_HELPER_INVALID_PARAMETER
        };
        set(params, vol_acc, MASK_UINT20, OFFSET_VOL_ACC)
    }

    public(package) fun set_active_id(params: u256, active_id: u32): u256 {
        let new_params = 0u256;
        set(params, active_id, MASK_UINT24, OFFSET_ACTIVE_ID)
    }

    public(package) fun set_static_fee_parameters(params: u256, base_factor: u16, filter_period: u16, decay_period: u16, reduction_factor: u16, variable_fee_control: u32, protocol_share: u16, max_volatility_accumulator: u32): u256 {
        let new_params = 0u256;
        if ((((((filter_period > decay_period) || (decay_period > MASK_UINT12)) || (reduction_factor > BASIS_POINT_MAX)) || (protocol_share > MAX_PROTOCOL_SHARE)) || (max_volatility_accumulator > MASK_UINT20))) {
            abort E_PAIR_PARAMETERS_HELPER_INVALID_PARAMETER
        };
        new_params = set(new_params, base_factor, MASK_UINT16, OFFSET_BASE_FACTOR);
        new_params = set(new_params, filter_period, MASK_UINT12, OFFSET_FILTER_PERIOD);
        new_params = set(new_params, decay_period, MASK_UINT12, OFFSET_DECAY_PERIOD);
        new_params = set(new_params, reduction_factor, MASK_UINT14, OFFSET_REDUCTION_FACTOR);
        new_params = set(new_params, variable_fee_control, MASK_UINT24, OFFSET_VAR_FEE_CONTROL);
        new_params = set(new_params, protocol_share, MASK_UINT14, OFFSET_PROTOCOL_SHARE);
        new_params = set(new_params, max_volatility_accumulator, MASK_UINT20, OFFSET_MAX_VOL_ACC);
        set(params, (new_params as u256), MASK_STATIC_PARAMETER, 0)
    }

    public(package) fun update_id_reference(params: u256): u256 {
        let new_params = 0u256;
        let active_id: u32 = get_active_id(params);
        set(params, active_id, MASK_UINT24, OFFSET_ID_REF)
    }

    public(package) fun update_time_of_last_update(params: u256, timestamp: u256): u256 {
        let new_params = 0u256;
        let current_time: u64 = safe40(timestamp);
        set(params, current_time, MASK_UINT40, OFFSET_TIME_LAST_UPDATE)
    }

    public(package) fun update_volatility_reference(params: u256): u256 {
        let vol_acc: u256 = get_volatility_accumulator(params);
        let reduction_factor: u256 = get_reduction_factor(params);
        let vol_ref: u32;
        vol_ref = (((vol_acc * reduction_factor) / BASIS_POINT_MAX) & 16777215u32);
        set_volatility_reference(params, vol_ref)
    }

    public(package) fun update_volatility_accumulator(params: u256, active_id: u32): u256 {
        let id_reference: u256 = get_id_reference(params);
        let delta_id: u256;
        let vol_acc: u256;
        delta_id = if ((active_id > id_reference)) (active_id - id_reference) else (id_reference - active_id);
        vol_acc = (((get_volatility_reference(params) as u256) + (delta_id * BASIS_POINT_MAX)));
        let max_vol_acc: u256 = get_max_volatility_accumulator(params);
        vol_acc = if ((vol_acc > max_vol_acc)) max_vol_acc else vol_acc;
        set_volatility_accumulator(params, (vol_acc & 16777215u32))
    }

    public(package) fun update_references(params: u256, timestamp: u256): u256 {
        let dt: u256 = (timestamp - get_time_of_last_update(params));
        if ((dt >= get_filter_period(params))) {
            params = update_id_reference(params);
            params = if ((dt < get_decay_period(params))) update_volatility_reference(params) else set_volatility_reference(params, 0);
        };
        update_time_of_last_update(params, timestamp)
    }

    public(package) fun update_volatility_parameters(params: u256, active_id: u32, timestamp: u256): u256 {
        params = update_references(params, timestamp);
        update_volatility_accumulator(params, active_id)
    }
}