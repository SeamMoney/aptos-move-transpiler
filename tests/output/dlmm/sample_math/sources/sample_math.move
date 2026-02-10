module 0x1::sample_math {

    // Error codes
    const OFFSET_ORACLE_LENGTH: u256 = 0u256;
    const OFFSET_CUMULATIVE_ID: u256 = 16u256;
    const OFFSET_CUMULATIVE_VOLATILITY: u256 = 80u256;
    const OFFSET_CUMULATIVE_BIN_CROSSED: u256 = 144u256;
    const OFFSET_SAMPLE_LIFETIME: u256 = 208u256;
    const OFFSET_SAMPLE_CREATION: u256 = 216u256;
    const MASK_UINT16: u256 = 0xffffu256;
    const MASK_UINT64: u256 = 0xffffffffffffffffu256;
    const MASK_UINT8: u256 = 0xffu256;
    const MASK_UINT40: u256 = 0xffffffffffu256;
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

    public(package) fun encode(oracle_length: u16, cumulative_id: u64, cumulative_volatility: u64, cumulative_bin_crossed: u64, sample_lifetime: u8, created_at: u64): u256 {
        let sample = 0u256;
        sample = encoded::set(sample, oracle_length, MASK_UINT16, OFFSET_ORACLE_LENGTH);
        sample = encoded::set(sample, cumulative_id, MASK_UINT64, OFFSET_CUMULATIVE_ID);
        sample = encoded::set(sample, cumulative_volatility, MASK_UINT64, OFFSET_CUMULATIVE_VOLATILITY);
        sample = encoded::set(sample, cumulative_bin_crossed, MASK_UINT64, OFFSET_CUMULATIVE_BIN_CROSSED);
        sample = encoded::set(sample, sample_lifetime, MASK_UINT8, OFFSET_SAMPLE_LIFETIME);
        sample = encoded::set(sample, created_at, MASK_UINT40, OFFSET_SAMPLE_CREATION);
        return sample
    }

    public(package) fun get_oracle_length(sample: u256): u16 {
        let length = 0u16;
        return encoded::decode_uint16(sample, 0)
    }

    public(package) fun get_cumulative_id(sample: u256): u64 {
        let id = 0u64;
        return encoded::decode_uint64(sample, OFFSET_CUMULATIVE_ID)
    }

    public(package) fun get_cumulative_volatility(sample: u256): u64 {
        let volatility_accumulator = 0u64;
        return encoded::decode_uint64(sample, OFFSET_CUMULATIVE_VOLATILITY)
    }

    public(package) fun get_cumulative_bin_crossed(sample: u256): u64 {
        let bin_crossed = 0u64;
        return encoded::decode_uint64(sample, OFFSET_CUMULATIVE_BIN_CROSSED)
    }

    public(package) fun get_sample_lifetime(sample: u256): u8 {
        let lifetime = 0u8;
        return encoded::decode_uint8(sample, OFFSET_SAMPLE_LIFETIME)
    }

    public(package) fun get_sample_creation(sample: u256): u64 {
        let creation = 0u64;
        return encoded::decode_uint40(sample, OFFSET_SAMPLE_CREATION)
    }

    public(package) fun get_sample_last_update(sample: u256): u64 {
        let last_update = 0u64;
        last_update = ((get_sample_creation(sample) + get_sample_lifetime(sample)) as u64);
        return last_update
    }

    public(package) fun get_weighted_average(sample1: u256, sample2: u256, weight1: u64, weight2: u64): (u64, u64, u64) {
        let weighted_average_id = 0u64;
        let weighted_average_volatility = 0u64;
        let weighted_average_bin_crossed = 0u64;
        let c_id1: u256 = get_cumulative_id(sample1);
        let c_volatility1: u256 = get_cumulative_volatility(sample1);
        let c_bin_crossed1: u256 = get_cumulative_bin_crossed(sample1);
        if ((weight2 == 0)) {
            return ((c_id1 as u64), (c_volatility1 as u64), (c_bin_crossed1 as u64))
        };
        let c_id2: u256 = get_cumulative_id(sample2);
        let c_volatility2: u256 = get_cumulative_volatility(sample2);
        let c_bin_crossed2: u256 = get_cumulative_bin_crossed(sample2);
        if ((weight1 == 0)) {
            return ((c_id2 as u64), (c_volatility2 as u64), (c_bin_crossed2 as u64))
        };
        let total_weight: u256 = ((weight1 as u256) + weight2);
        weighted_average_id = (((((c_id1 * weight1) + (c_id2 * weight2))) / total_weight) as u64);
        weighted_average_volatility = (((((c_volatility1 * weight1) + (c_volatility2 * weight2))) / total_weight) as u64);
        weighted_average_bin_crossed = (((((c_bin_crossed1 * weight1) + (c_bin_crossed2 * weight2))) / total_weight) as u64);
        return (weighted_average_id, weighted_average_volatility, weighted_average_bin_crossed)
    }

    public(package) fun update(sample: u256, delta_time: u64, active_id: u32, volatility_accumulator: u32, bin_crossed: u32): (u64, u64, u64) {
        let cumulative_id = 0u64;
        let cumulative_volatility = 0u64;
        let cumulative_bin_crossed = 0u64;
        cumulative_id = (((active_id as u64) * delta_time) as u64);
        cumulative_volatility = (((volatility_accumulator as u64) * delta_time) as u64);
        cumulative_bin_crossed = (((bin_crossed as u64) * delta_time) as u64);
        cumulative_id += (get_cumulative_id(sample) as u64);
        cumulative_volatility += (get_cumulative_volatility(sample) as u64);
        cumulative_bin_crossed += (get_cumulative_bin_crossed(sample) as u64);
        return (cumulative_id, cumulative_volatility, cumulative_bin_crossed)
    }
}