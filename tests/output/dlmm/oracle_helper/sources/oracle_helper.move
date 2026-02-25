module 0x1::oracle_helper {

    use std::vector;
    use aptos_framework::timestamp;
    use 0x1::sample_math;
    use 0x1::pair_parameter_helper;
    use 0x1::safe_cast;

    // Error codes
    const _MAX_SAMPLE_LIFETIME: u256 = 120u256;
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
    const E_ORACLE_HELPER_INVALID_ORACLE_ID: u64 = 256u64;
    const E_ORACLE_HELPER_NEW_LENGTH_TOO_SMALL: u64 = 257u64;
    const E_ORACLE_HELPER_LOOK_UP_TIMESTAMP_TOO_OLD: u64 = 258u64;

    struct Oracle has copy, drop, store {
        samples: vector<u256>
    }

    public(package) fun get_sample(oracle: Oracle, oracle_id: u16): u256 {
        let sample = 0u256;
        check_oracle_id(oracle_id);
        sample = *vector::borrow(&oracle.samples, ((oracle_id - 1) as u64));
        return sample
    }

    public(package) fun get_active_sample_and_size(oracle: Oracle, oracle_id: u16): (u256, u16) {
        let active_sample = 0u256;
        let active_size = 0u16;
        active_sample = get_sample(oracle, oracle_id);
        active_size = (sample_math::get_oracle_length(active_sample) as u16);
        if ((oracle_id != active_size)) {
            active_size = (sample_math::get_oracle_length(get_sample(oracle, active_size)) as u16);
            active_size = ((if ((oracle_id > active_size)) oracle_id else active_size) as u16);
        };
        return (active_sample, active_size)
    }

    public(package) fun get_sample_at(oracle: Oracle, oracle_id: u16, look_up_timestamp: u64): (u64, u64, u64, u64) {
        let last_update = 0u64;
        let cumulative_id = 0u64;
        let cumulative_volatility = 0u64;
        let cumulative_bin_crossed = 0u64;
        let (active_sample, active_size) = get_active_sample_and_size(oracle, oracle_id);
        if ((sample_math::get_sample_last_update(*vector::borrow(&oracle.samples, ((oracle_id % active_size) as u64))) > look_up_timestamp)) {
            abort E_ORACLE_HELPER_LOOK_UP_TIMESTAMP_TOO_OLD
        };
        last_update = (sample_math::get_sample_last_update(active_sample) as u64);
        if ((last_update <= look_up_timestamp)) {
            return (last_update, sample_math::get_cumulative_id(active_sample), sample_math::get_cumulative_volatility(active_sample), sample_math::get_cumulative_bin_crossed(active_sample))
        } else {
            last_update = (look_up_timestamp as u64);
        };
        let (prev_sample, next_sample) = binary_search(oracle, oracle_id, look_up_timestamp, active_size);
        let weight_prev: u64 = (sample_math::get_sample_last_update(next_sample) - look_up_timestamp);
        let weight_next: u64 = (look_up_timestamp - sample_math::get_sample_last_update(prev_sample));
        (cumulative_id, cumulative_volatility, cumulative_bin_crossed) = sample_math::get_weighted_average(prev_sample, next_sample, weight_prev, weight_next);
    }

    public(package) fun binary_search(oracle: Oracle, oracle_id: u16, look_up_timestamp: u64, length: u16): (u256, u256) {
        let low: u256 = 0;
        let high: u256 = (length - 1);
        let sample: u256;
        let sample_last_update: u64;
        let start_id: u256 = oracle_id;
        while ((low <= high)) {
            let mid: u256 = (((low + high)) >> 1u8);
            oracle_id = ((start_id + mid) % (length as u256));
            sample = *vector::borrow(&oracle.samples, (oracle_id as u64));
            sample_last_update = sample_math::get_sample_last_update(sample);
            if ((sample_last_update > look_up_timestamp)) {
                high = (mid - 1);
            } else {
                if ((sample_last_update < look_up_timestamp)) {
                    low = (mid + 1);
                } else {
                    return (sample, sample)
                };
            };
        }
        if ((look_up_timestamp < sample_last_update)) {
            if ((oracle_id == 0)) {
                oracle_id = length;
            };
            return (*vector::borrow(&oracle.samples, ((oracle_id - 1) as u64)), sample)
        } else {
            oracle_id = ((oracle_id + 1) % length);
            return (sample, *vector::borrow(&oracle.samples, (oracle_id as u64)))
        };
    }

    public(package) fun set_sample(oracle: Oracle, oracle_id: u16, sample: u256) {
        check_oracle_id(oracle_id);
        *vector::borrow_mut(&mut oracle.samples, ((oracle_id - 1) as u64)) = sample;
    }

    public(package) fun update(oracle: Oracle, parameters: u256, active_id: u32, state: &OracleHelperState): u256 {
        let oracle_id: u16 = pair_parameter_helper::get_oracle_id(parameters);
        if ((oracle_id == 0)) {
            return parameters
        };
        let sample: u256 = get_sample(oracle, oracle_id);
        let created_at: u64 = sample_math::get_sample_creation(sample);
        let last_updated_at: u64 = (created_at + sample_math::get_sample_lifetime(sample));
        if ((safe_cast::safe40((timestamp::now_seconds() as u256)) > last_updated_at)) {
            let (cumulative_id, cumulative_volatility, cumulative_bin_crossed) = sample_math::update(sample, (((timestamp::now_seconds() as u256) - last_updated_at) & 1099511627775), pair_parameter_helper::get_active_id(parameters), pair_parameter_helper::get_volatility_accumulator(parameters), pair_parameter_helper::get_delta_id(parameters, active_id));
            let length: u16 = sample_math::get_oracle_length(sample);
            let lifetime: u256 = ((timestamp::now_seconds() as u256) - created_at);
            if ((lifetime > _MAX_SAMPLE_LIFETIME)) {
                oracle_id = ((oracle_id % length) + 1);
                lifetime = 0;
                created_at = ((timestamp::now_seconds() as u256) & 1099511627775);
                parameters = pair_parameter_helper::set_oracle_id(parameters, oracle_id);
            };
            sample = sample_math::encode(length, cumulative_id, cumulative_volatility, cumulative_bin_crossed, (lifetime as u8), created_at);
            set_sample(oracle, oracle_id, sample);
        };
        return parameters
    }

    public(package) fun increase_length(oracle: Oracle, oracle_id: u16, new_length: u16, state: &mut OracleHelperState) {
        let sample: u256 = get_sample(oracle, oracle_id);
        let length: u16 = sample_math::get_oracle_length(sample);
        if ((length >= new_length)) {
            abort E_ORACLE_HELPER_NEW_LENGTH_TOO_SMALL
        };
        let last_sample: u256 = (if ((length == oracle_id)) sample else (if ((length == 0)) (0 as u256) else get_sample(oracle, length)));
        let active_size: u256 = sample_math::get_oracle_length(last_sample);
        active_size = (if (((oracle_id as u256) > active_size)) oracle_id else active_size);
        let i: u256 = length;
        while ((i < (new_length as u256))) {
            *vector::borrow_mut(&mut oracle.samples, (i as u64)) = (active_size as u256);
            i = (i + 1);
        }
        set_sample(oracle, oracle_id, (((sample ^ (length as u256))) | (new_length as u256)));
    }

    fun check_oracle_id(oracle_id: u16) {
        if ((oracle_id == 0)) {
            abort E_ORACLE_HELPER_INVALID_ORACLE_ID
        };
    }
}