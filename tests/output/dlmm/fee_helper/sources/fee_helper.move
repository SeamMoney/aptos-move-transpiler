module 0x1::fee_helper {

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
    const E_FEE_HELPER_FEE_TOO_LARGE: u64 = 256u64;
    const E_FEE_HELPER_PROTOCOL_SHARE_TOO_LARGE: u64 = 257u64;

    public(package) fun get_fee_amount_from(amount_with_fees: u128, total_fee: u128): u128 {
        verify_fee(fee);
        (((((((amount_with_fees as u256) * total_fee) + PRECISION) - 1)) / PRECISION) as u128)
    }

    public(package) fun get_fee_amount(amount: u128, total_fee: u128): u128 {
        verify_fee(fee);
        let denominator: u256 = (PRECISION - total_fee);
        (((((((amount as u256) * total_fee) + denominator) - 1)) / denominator) as u128)
    }

    public(package) fun get_composition_fee(amount_with_fees: u128, total_fee: u128): u128 {
        verify_fee(fee);
        let denominator: u256 = SQUARED_PRECISION;
        (((((amount_with_fees as u256) * total_fee) * (((total_fee as u256) + PRECISION))) / denominator) as u128)
    }

    public(package) fun get_protocol_fee_amount(fee_amount: u128, protocol_share: u128): u128 {
        if ((protocol_share > MAX_PROTOCOL_SHARE)) {
            abort E_FEE_HELPER_PROTOCOL_SHARE_TOO_LARGE
        };
        ((((fee_amount as u256) * protocol_share) / BASIS_POINT_MAX) as u128)
    }

    fun verify_fee(fee: u128) {
        if ((fee > MAX_FEE)) {
            abort E_FEE_HELPER_FEE_TOO_LARGE
        };
    }
}