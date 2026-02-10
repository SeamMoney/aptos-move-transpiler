module 0x1::bit_math {

    use std::u256;

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
        let shift: u256 = (255 - bit);
        x <<= (shift as u8);
        return if (((x == 0))) u256::MAX else (most_significant_bit(x) - shift)
        return id
    }

    public(package) fun closest_bit_left(x: u256, bit: u8): u256 {
        let id = 0u256;
        x >>= (bit as u8);
        return if (((x == 0))) u256::MAX else (least_significant_bit(x) + bit)
        return id
    }

    public(package) fun most_significant_bit(x: u256): u8 {
        let msb = 0u8;
        if ((x > 0xffffffffffffffffffffffffffffffffu256)) {
            x = (x >> (128 as u8));
            msb = (128 as u8);
        };
        if ((x > 0xffffffffffffffffu256)) {
            x = (x >> (64 as u8));
            msb = ((msb + 64) as u8);
        };
        if ((x > 0xffffffffu256)) {
            x = (x >> (32 as u8));
            msb = ((msb + 32) as u8);
        };
        if ((x > 0xffffu256)) {
            x = (x >> (16 as u8));
            msb = ((msb + 16) as u8);
        };
        if ((x > 0xffu256)) {
            x = (x >> (8 as u8));
            msb = ((msb + 8) as u8);
        };
        if ((x > 0xfu256)) {
            x = (x >> (4 as u8));
            msb = ((msb + 4) as u8);
        };
        if ((x > 0x3u256)) {
            x = (x >> (2 as u8));
            msb = ((msb + 2) as u8);
        };
        if ((x > 0x1u256)) {
            msb = ((msb + 1) as u8);
        };
        return msb
    }

    public(package) fun least_significant_bit(x: u256): u8 {
        let lsb = 0u8;
        let sx = (x << (128 as u8));
        if (!(sx == 0)) {
            lsb = (128 as u8);
            x = sx;
        };
        sx = (x << (64 as u8));
        if (!(sx == 0)) {
            x = sx;
            lsb = ((lsb + 64) as u8);
        };
        sx = (x << (32 as u8));
        if (!(sx == 0)) {
            x = sx;
            lsb = ((lsb + 32) as u8);
        };
        sx = (x << (16 as u8));
        if (!(sx == 0)) {
            x = sx;
            lsb = ((lsb + 16) as u8);
        };
        sx = (x << (8 as u8));
        if (!(sx == 0)) {
            x = sx;
            lsb = ((lsb + 8) as u8);
        };
        sx = (x << (4 as u8));
        if (!(sx == 0)) {
            x = sx;
            lsb = ((lsb + 4) as u8);
        };
        sx = (x << (2 as u8));
        if (!(sx == 0)) {
            x = sx;
            lsb = ((lsb + 2) as u8);
        };
        if (!((x << (1 as u8)) == 0)) {
            lsb = ((lsb + 1) as u8);
        };
        lsb = ((255 - lsb) as u8);
        return lsb
    }
}