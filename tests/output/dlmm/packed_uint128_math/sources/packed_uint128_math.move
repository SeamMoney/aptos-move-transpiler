module 0x1::packed_uint128_math {

    // Error codes
    const OFFSET: u256 = 128u256;
    const MASK_128: u256 = 0xffffffffffffffffffffffffffffffffu256;
    const MASK_128_PLUS_ONE: u256 = 340282366920938463463374607431768211456u256;
    const BASIS_POINT_MAX: u256 = 10_000u256;
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
    const E_PACKED_UINT128_MATH_ADD_OVERFLOW: u64 = 256u64;
    const E_PACKED_UINT128_MATH_SUB_UNDERFLOW: u64 = 257u64;
    const E_PACKED_UINT128_MATH_MULTIPLIER_TOO_LARGE: u64 = 258u64;

    public(package) fun encode(x1: u128, x2: u128): u256 {
        let z = 0u256;
        z = ((x1 & MASK_128) | (x2 << (OFFSET as u8)));
        return z
    }

    public(package) fun encode_first(x1: u128): u256 {
        let z = 0u256;
        z = (x1 & MASK_128);
        return z
    }

    public(package) fun encode_second(x2: u128): u256 {
        let z = 0u256;
        z = (x2 << (OFFSET as u8));
        return z
    }

    public(package) fun encode_u_bool(x: u128, first: bool): u256 {
        let z = 0u256;
        return if (first) encode_first(x) else encode_second(x)
    }

    public(package) fun decode(z: u256): (u128, u128) {
        let x1 = 0u128;
        let x2 = 0u128;
        x1 = ((z & MASK_128) as u128);
        x2 = ((z >> (OFFSET as u8)) as u128);
        return (x1, x2)
    }

    public(package) fun decode_x(z: u256): u128 {
        let x = 0u128;
        x = ((z & MASK_128) as u128);
        return x
    }

    public(package) fun decode_y(z: u256): u128 {
        let y = 0u128;
        y = ((z >> (OFFSET as u8)) as u128);
        return y
    }

    public(package) fun decode_b_bool(z: u256, first: bool): u128 {
        let x = 0u128;
        return if (first) decode_x(z) else decode_y(z)
    }

    public(package) fun add(x: u256, y: u256): u256 {
        let z = 0u256;
        z = (x + y);
        if (((z < x) || ((z as u128) < (x as u128)))) {
            abort E_PACKED_UINT128_MATH_ADD_OVERFLOW
        };
        return z
    }

    public(package) fun add_b_u_u(x: u256, y1: u128, y2: u128): u256 {
        return add(x, encode(y1, y2))
    }

    public(package) fun sub(x: u256, y: u256): u256 {
        let z = 0u256;
        z = (x - y);
        if (((z > x) || ((z as u128) > (x as u128)))) {
            abort E_PACKED_UINT128_MATH_SUB_UNDERFLOW
        };
        return z
    }

    public(package) fun sub_b_u_u(x: u256, y1: u128, y2: u128): u256 {
        return sub(x, encode(y1, y2))
    }

    public(package) fun lt(x: u256, y: u256): bool {
        let (x1, x2) = decode(x);
        let (y1, y2) = decode(y);
        return ((x1 < y1) || (x2 < y2))
    }

    public(package) fun gt(x: u256, y: u256): bool {
        let (x1, x2) = decode(x);
        let (y1, y2) = decode(y);
        return ((x1 > y1) || (x2 > y2))
    }

    public(package) fun scalar_mul_div_basis_point_round_down(x: u256, multiplier: u128): u256 {
        let z = 0u256;
        if ((multiplier == 0)) {
            return 0
        };
        let BASIS_POINT_MAX: u256 = BASIS_POINT_MAX;
        if (((multiplier as u256) > BASIS_POINT_MAX)) {
            abort E_PACKED_UINT128_MATH_MULTIPLIER_TOO_LARGE
        };
        let (x1, x2) = decode(x);
        x1 = ((x1 * multiplier) / BASIS_POINT_MAX);
        x2 = ((x2 * multiplier) / BASIS_POINT_MAX);
        return encode(x1, x2)
    }
}