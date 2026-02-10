module 0x1::bit_math {

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

    public(package) fun closest_bit_right(x: u256, bit: u8): u256 {
        let id = 0u256;
        let shift: u256 = (255u256 - bit);
        x <<= (shift as u8);
        if (((x == 0u256))) 115792089237316195423570985008687907853269984665640564039457584007913129639935u256 else (most_significant_bit(x) - shift)
        id
    }

    public(package) fun closest_bit_left(x: u256, bit: u8): u256 {
        let id = 0u256;
        x >>= (bit as u8);
        if (((x == 0u256))) 115792089237316195423570985008687907853269984665640564039457584007913129639935u256 else (least_significant_bit(x) + bit)
        id
    }

    public(package) fun most_significant_bit(x: u256): u8 {
        let msb = 0u8;
        if ((x > 0xffffffffffffffffffffffffffffffffu256)) {
            x = (x >> (128u256 as u8));
            msb = (128u256 as u8);
        };
        if ((x > 0xffffffffffffffffu256)) {
            x = (x >> (64u256 as u8));
            msb = ((msb + 64u256) as u8);
        };
        if ((x > 0xffffffffu256)) {
            x = (x >> (32u256 as u8));
            msb = ((msb + 32u256) as u8);
        };
        if ((x > 0xffffu256)) {
            x = (x >> (16u256 as u8));
            msb = ((msb + 16u256) as u8);
        };
        if ((x > 0xffu256)) {
            x = (x >> (8u256 as u8));
            msb = ((msb + 8u256) as u8);
        };
        if ((x > 0xfu256)) {
            x = (x >> (4u256 as u8));
            msb = ((msb + 4u256) as u8);
        };
        if ((x > 0x3u256)) {
            x = (x >> (2u256 as u8));
            msb = ((msb + 2u256) as u8);
        };
        if ((x > 0x1u256)) {
            msb = ((msb + 1u256) as u8);
        };
        msb
    }

    public(package) fun least_significant_bit(x: u256): u8 {
        let lsb = 0u8;
        let sx = (x << (128u256 as u8));
        if (!(sx == 0u256)) {
            lsb = (128u256 as u8);
            x = sx;
        };
        sx = (x << (64u256 as u8));
        if (!(sx == 0u256)) {
            x = sx;
            lsb = ((lsb + 64u256) as u8);
        };
        sx = (x << (32u256 as u8));
        if (!(sx == 0u256)) {
            x = sx;
            lsb = ((lsb + 32u256) as u8);
        };
        sx = (x << (16u256 as u8));
        if (!(sx == 0u256)) {
            x = sx;
            lsb = ((lsb + 16u256) as u8);
        };
        sx = (x << (8u256 as u8));
        if (!(sx == 0u256)) {
            x = sx;
            lsb = ((lsb + 8u256) as u8);
        };
        sx = (x << (4u256 as u8));
        if (!(sx == 0u256)) {
            x = sx;
            lsb = ((lsb + 4u256) as u8);
        };
        sx = (x << (2u256 as u8));
        if (!(sx == 0u256)) {
            x = sx;
            lsb = ((lsb + 2u256) as u8);
        };
        if (!((x << (1u256 as u8)) == 0u256)) {
            lsb = ((lsb + 1u256) as u8);
        };
        lsb = ((255u256 - lsb) as u8);
        lsb
    }
}