module 0x1::price_helper {

    // Error codes
    const REAL_ID_SHIFT: i256 = 8388608i256;
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

    public(package) fun get_price_from_id(id: u32, bin_step: u16): u256 {
        let price = 0u256;
        let base: u256 = get_base(bin_step);
        let exponent: i256 = get_exponent(id);
        price = pow(base, exponent);
        price
    }

    public(package) fun get_id_from_price(price: u256, bin_step: u16): u32 {
        let id = 0u32;
        let base: u256 = get_base(bin_step);
        let real_id: i256 = (log2(price) / log2(base));
        id = (safe24(((REAL_ID_SHIFT + real_id) as u256)) as u32);
        id
    }

    public(package) fun get_base(bin_step: u16): u256 {
        (SCALE + ((((bin_step as u256) << SCALE_OFFSET)) / BASIS_POINT_MAX))
    }

    public(package) fun get_exponent(id: u32): i256 {
        (((id as u256) as i256) - REAL_ID_SHIFT)
    }

    public(package) fun convert_decimal_price_to128x128(price: u256): u256 {
        shift_div_round_down(price, SCALE_OFFSET, PRECISION)
    }

    public(package) fun convert128x128_price_to_decimal(price128x128: u256): u256 {
        mul_shift_round_down(price128x128, PRECISION, SCALE_OFFSET)
    }
}