module 0x1::safe_cast {

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
    const E_SAFE_CAST_EXCEEDS248_BITS: u64 = 256u64;
    const E_SAFE_CAST_EXCEEDS240_BITS: u64 = 257u64;
    const E_SAFE_CAST_EXCEEDS232_BITS: u64 = 258u64;
    const E_SAFE_CAST_EXCEEDS224_BITS: u64 = 259u64;
    const E_SAFE_CAST_EXCEEDS216_BITS: u64 = 260u64;
    const E_SAFE_CAST_EXCEEDS208_BITS: u64 = 261u64;
    const E_SAFE_CAST_EXCEEDS200_BITS: u64 = 262u64;
    const E_SAFE_CAST_EXCEEDS192_BITS: u64 = 263u64;
    const E_SAFE_CAST_EXCEEDS184_BITS: u64 = 264u64;
    const E_SAFE_CAST_EXCEEDS176_BITS: u64 = 265u64;
    const E_SAFE_CAST_EXCEEDS168_BITS: u64 = 266u64;
    const E_SAFE_CAST_EXCEEDS160_BITS: u64 = 267u64;
    const E_SAFE_CAST_EXCEEDS152_BITS: u64 = 268u64;
    const E_SAFE_CAST_EXCEEDS144_BITS: u64 = 269u64;
    const E_SAFE_CAST_EXCEEDS136_BITS: u64 = 270u64;
    const E_SAFE_CAST_EXCEEDS128_BITS: u64 = 271u64;
    const E_SAFE_CAST_EXCEEDS120_BITS: u64 = 272u64;
    const E_SAFE_CAST_EXCEEDS112_BITS: u64 = 273u64;
    const E_SAFE_CAST_EXCEEDS104_BITS: u64 = 274u64;
    const E_SAFE_CAST_EXCEEDS96_BITS: u64 = 275u64;
    const E_SAFE_CAST_EXCEEDS88_BITS: u64 = 276u64;
    const E_SAFE_CAST_EXCEEDS80_BITS: u64 = 277u64;
    const E_SAFE_CAST_EXCEEDS72_BITS: u64 = 278u64;
    const E_SAFE_CAST_EXCEEDS64_BITS: u64 = 279u64;
    const E_SAFE_CAST_EXCEEDS56_BITS: u64 = 280u64;
    const E_SAFE_CAST_EXCEEDS48_BITS: u64 = 281u64;
    const E_SAFE_CAST_EXCEEDS40_BITS: u64 = 282u64;
    const E_SAFE_CAST_EXCEEDS32_BITS: u64 = 283u64;
    const E_SAFE_CAST_EXCEEDS24_BITS: u64 = 284u64;
    const E_SAFE_CAST_EXCEEDS16_BITS: u64 = 285u64;
    const E_SAFE_CAST_EXCEEDS8_BITS: u64 = 286u64;

    public(package) fun safe248(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS248_BITS
        };
        y
    }

    public(package) fun safe240(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS240_BITS
        };
        y
    }

    public(package) fun safe232(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS232_BITS
        };
        y
    }

    public(package) fun safe224(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS224_BITS
        };
        y
    }

    public(package) fun safe216(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS216_BITS
        };
        y
    }

    public(package) fun safe208(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS208_BITS
        };
        y
    }

    public(package) fun safe200(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS200_BITS
        };
        y
    }

    public(package) fun safe192(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS192_BITS
        };
        y
    }

    public(package) fun safe184(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS184_BITS
        };
        y
    }

    public(package) fun safe176(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS176_BITS
        };
        y
    }

    public(package) fun safe168(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS168_BITS
        };
        y
    }

    public(package) fun safe160(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS160_BITS
        };
        y
    }

    public(package) fun safe152(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS152_BITS
        };
        y
    }

    public(package) fun safe144(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS144_BITS
        };
        y
    }

    public(package) fun safe136(x: u256): u256 {
        let y = 0u256;
        y = (x as u256);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS136_BITS
        };
        y
    }

    public(package) fun safe128(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS128_BITS
        };
        y
    }

    public(package) fun safe120(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS120_BITS
        };
        y
    }

    public(package) fun safe112(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS112_BITS
        };
        y
    }

    public(package) fun safe104(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS104_BITS
        };
        y
    }

    public(package) fun safe96(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS96_BITS
        };
        y
    }

    public(package) fun safe88(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS88_BITS
        };
        y
    }

    public(package) fun safe80(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS80_BITS
        };
        y
    }

    public(package) fun safe72(x: u256): u128 {
        let y = 0u128;
        y = (x as u128);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS72_BITS
        };
        y
    }

    public(package) fun safe64(x: u256): u64 {
        let y = 0u64;
        y = (x as u64);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS64_BITS
        };
        y
    }

    public(package) fun safe56(x: u256): u64 {
        let y = 0u64;
        y = (x as u64);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS56_BITS
        };
        y
    }

    public(package) fun safe48(x: u256): u64 {
        let y = 0u64;
        y = (x as u64);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS48_BITS
        };
        y
    }

    public(package) fun safe40(x: u256): u64 {
        let y = 0u64;
        y = (x as u64);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS40_BITS
        };
        y
    }

    public(package) fun safe32(x: u256): u32 {
        let y = 0u32;
        y = (x as u32);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS32_BITS
        };
        y
    }

    public(package) fun safe24(x: u256): u32 {
        let y = 0u32;
        y = (x as u32);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS24_BITS
        };
        y
    }

    public(package) fun safe16(x: u256): u16 {
        let y = 0u16;
        y = (x as u16);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS16_BITS
        };
        y
    }

    public(package) fun safe8(x: u256): u8 {
        let y = 0u8;
        y = (x as u8);
        if ((y != x)) {
            abort E_SAFE_CAST_EXCEEDS8_BITS
        };
        y
    }
}