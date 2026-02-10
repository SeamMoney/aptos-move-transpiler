module 0x1::liquidity_configurations {

    // Error codes
    const OFFSET_ID: u256 = 0u256;
    const OFFSET_DISTRIBUTION_Y: u256 = 24u256;
    const OFFSET_DISTRIBUTION_X: u256 = 88u256;
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
    const E_LIQUIDITY_CONFIGURATIONS_INVALID_CONFIG: u64 = 256u64;

    public(package) fun encode_params(distribution_x: u64, distribution_y: u64, id: u32): u256 {
        let config = 0u256;
        config = set(config, distribution_x, MASK_UINT64, OFFSET_DISTRIBUTION_X);
        config = set(config, distribution_y, MASK_UINT64, OFFSET_DISTRIBUTION_Y);
        config = set(config, id, MASK_UINT24, OFFSET_ID);
        config
    }

    public(package) fun decode_params(config: u256): (u64, u64, u32) {
        let distribution_x = 0u64;
        let distribution_y = 0u64;
        let id = 0u32;
        distribution_x = (decode_uint64(config, OFFSET_DISTRIBUTION_X) as u64);
        distribution_y = (decode_uint64(config, OFFSET_DISTRIBUTION_Y) as u64);
        id = (decode_uint24(config, OFFSET_ID) as u32);
        if (((((config as u256) > 115792089237316195423570985008687907853269984665640564039457584007913129639935u256) || (distribution_x > PRECISION)) || (distribution_y > PRECISION))) {
            abort E_LIQUIDITY_CONFIGURATIONS_INVALID_CONFIG
        };
        (distribution_x, distribution_y, id)
    }

    public(package) fun get_amounts_and_id(config: u256, amounts_in: u256): (u256, u32) {
        let (distribution_x, distribution_y, id) = decode_params(config);
        let (x1, x2) = decode(amounts_in);
        x1 = ((x1 * distribution_x) / PRECISION);
        x2 = ((x2 * distribution_y) / PRECISION);
        (encode(x1, x2), id)
    }
}