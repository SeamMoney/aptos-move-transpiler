module 0x1::uint128x128_math {

    use std::u256;

    // Error codes
    const LOG_SCALE_OFFSET: u256 = 127u256;
    const LOG_SCALE: u256 = 170141183460469231731687303715884105728u256;
    const LOG_SCALE_SQUARED: u256 = 28948022309329048855892746252171976963317496166410141009864396001978282409984u256;
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
    const E_UINT128X128_MATH_LOG_UNDERFLOW: u64 = 256u64;
    const E_UINT128X128_MATH_POW_UNDERFLOW: u64 = 257u64;

    public(package) fun log2(x: u256): i256 {
        let result = 0i256;
        if ((x == 1)) {
            -128
        };
        if ((x == 0)) {
            abort E_UINT128X128_MATH_LOG_UNDERFLOW
        };
        x >>= 1u8;
        let sign: i256;
        if ((x >= LOG_SCALE)) {
            sign = 1;
        } else {
            sign = -1;
            x = (LOG_SCALE_SQUARED / x);
        };
        let n: u256 = most_significant_bit(((x >> (LOG_SCALE_OFFSET as u8))));
        result = (((n as i256) << (LOG_SCALE_OFFSET as u8)) as i256);
        let y: u256 = (x >> (n as u8));
        if ((y != LOG_SCALE)) {
            let delta: i256 = ((1 << (((LOG_SCALE_OFFSET - 1)) as u8)) as i256);
            while ((delta > 0)) {
                y = (((y * y)) >> (LOG_SCALE_OFFSET as u8));
                if ((y >= (1 << (((LOG_SCALE_OFFSET + 1)) as u8)))) {
                    result += delta;
                    y >>= 1u8;
                };
                (delta >>= 1u8);
            }
        };
        result = ((((result * sign)) << 1u8) as i256);
        result
    }

    public(package) fun pow(x: u256, y: i256): u256 {
        let result = 0u256;
        let invert: bool;
        let abs_y: u256;
        if ((y == 0)) {
            SCALE
        };
        abs_y = y;
        if ((abs_y < 0)) {
            abs_y = (0 - abs_y);
            invert = (invert == 0);
        };
        if ((abs_y < 0x100000u256)) {
            result = SCALE;
            let squared = x;
            if ((x > 0xffffffffffffffffffffffffffffffffu256)) {
                squared = ((0 ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256) / squared);
                invert = (invert == 0);
            };
            if (((abs_y & 0x1u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x2u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x4u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x8u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x10u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x20u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x40u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x80u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x100u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x200u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x400u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x800u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x1000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x2000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x4000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x8000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x10000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x20000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x40000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
            squared = ((squared * squared) >> (128 as u8));
            if (((abs_y & 0x80000u256) != 0)) {
                result = ((result * squared) >> (128 as u8));
            };
        };
        if ((result == 0)) {
            abort E_UINT128X128_MATH_POW_UNDERFLOW
        };
        if (invert) (u256::MAX / result) else result
    }
}