module 0x1::encoded {

    // Error codes
    const MASK_UINT1: u256 = 0x1u256;
    const MASK_UINT8: u256 = 0xffu256;
    const MASK_UINT12: u256 = 0xfffu256;
    const MASK_UINT14: u256 = 0x3fffu256;
    const MASK_UINT16: u256 = 0xffffu256;
    const MASK_UINT20: u256 = 0xfffffu256;
    const MASK_UINT24: u256 = 0xffffffu256;
    const MASK_UINT40: u256 = 0xffffffffffu256;
    const MASK_UINT64: u256 = 0xffffffffffffffffu256;
    const MASK_UINT128: u256 = 0xffffffffffffffffffffffffffffffffu256;
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

    public(package) fun set(encoded: u256, value: u256, mask: u256, offset: u256): u256 {
        let new_encoded = 0u256;
        new_encoded = (encoded & ((mask << (offset as u8)) ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256));
        new_encoded = (new_encoded | ((value & mask) << (offset as u8)));
        new_encoded
    }

    public(package) fun set_bool(encoded: u256, boolean: bool, offset: u256): u256 {
        let new_encoded = 0u256;
        set(encoded, if (boolean) 1 else 0, MASK_UINT1, offset)
    }

    public(package) fun decode(encoded: u256, mask: u256, offset: u256): u256 {
        let value = 0u256;
        value = ((encoded >> (offset as u8)) & mask);
        value
    }

    public(package) fun decode_bool(encoded: u256, offset: u256): bool {
        let boolean = false;
        boolean = (((encoded >> (offset as u8)) & MASK_UINT1) != 0);
        boolean
    }

    public(package) fun decode_uint8(encoded: u256, offset: u256): u8 {
        let value = 0u8;
        value = (((encoded >> (offset as u8)) & MASK_UINT8) as u8);
        value
    }

    public(package) fun decode_uint12(encoded: u256, offset: u256): u16 {
        let value = 0u16;
        value = (((encoded >> (offset as u8)) & MASK_UINT12) as u16);
        value
    }

    public(package) fun decode_uint14(encoded: u256, offset: u256): u16 {
        let value = 0u16;
        value = (((encoded >> (offset as u8)) & MASK_UINT14) as u16);
        value
    }

    public(package) fun decode_uint16(encoded: u256, offset: u256): u16 {
        let value = 0u16;
        value = (((encoded >> (offset as u8)) & MASK_UINT16) as u16);
        value
    }

    public(package) fun decode_uint20(encoded: u256, offset: u256): u32 {
        let value = 0u32;
        value = (((encoded >> (offset as u8)) & MASK_UINT20) as u32);
        value
    }

    public(package) fun decode_uint24(encoded: u256, offset: u256): u32 {
        let value = 0u32;
        value = (((encoded >> (offset as u8)) & MASK_UINT24) as u32);
        value
    }

    public(package) fun decode_uint40(encoded: u256, offset: u256): u64 {
        let value = 0u64;
        value = (((encoded >> (offset as u8)) & MASK_UINT40) as u64);
        value
    }

    public(package) fun decode_uint64(encoded: u256, offset: u256): u64 {
        let value = 0u64;
        value = (((encoded >> (offset as u8)) & MASK_UINT64) as u64);
        value
    }

    public(package) fun decode_uint128(encoded: u256, offset: u256): u128 {
        let value = 0u128;
        value = (((encoded >> (offset as u8)) & MASK_UINT128) as u128);
        value
    }
}