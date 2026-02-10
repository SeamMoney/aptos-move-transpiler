module 0x1::uint256x256_math {

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
    const E_UINT256X256_MATH_MUL_SHIFT_OVERFLOW: u64 = 256u64;
    const E_UINT256X256_MATH_MUL_DIV_OVERFLOW: u64 = 257u64;

    public(package) fun mul_div_round_down(x: u256, y: u256, denominator: u256): u256 {
        let result = 0u256;
        let (prod0, prod1) = get_mul_prods(x, y);
        get_end_of_div_round_down(x, y, denominator, prod0, prod1)
    }

    public(package) fun mul_div_round_up(x: u256, y: u256, denominator: u256): u256 {
        let result = 0u256;
        result = mul_div_round_down(x, y, denominator);
        if ((((x * y) % denominator) != 0u256)) {
            result += 1u256;
        };
        result
    }

    public(package) fun mul_shift_round_down(x: u256, y: u256, offset: u8): u256 {
        let result = 0u256;
        let (prod0, prod1) = get_mul_prods(x, y);
        if ((prod0 != 0u256)) {
            result = (prod0 >> (offset as u8));
        };
        if ((prod1 != 0u256)) {
            if ((prod1 >= (1u256 << (offset as u8)))) {
                abort E_UINT256X256_MATH_MUL_SHIFT_OVERFLOW
            };
            result += (prod1 << (((256u256 - offset)) as u8));
        };
        result
    }

    public(package) fun mul_shift_round_up(x: u256, y: u256, offset: u8): u256 {
        let result = 0u256;
        result = mul_shift_round_down(x, y, offset);
        if ((((x * y) % (1u256 << (offset as u8))) != 0u256)) {
            result += 1u256;
        };
        result
    }

    public(package) fun shift_div_round_down(x: u256, offset: u8, denominator: u256): u256 {
        let result = 0u256;
        let prod0: u256;
        let prod1: u256;
        prod0 = (x << (offset as u8));
        prod1 = (x >> (((256u256 - offset)) as u8));
        get_end_of_div_round_down(x, (1u256 << (offset as u8)), denominator, prod0, prod1)
    }

    public(package) fun shift_div_round_up(x: u256, offset: u8, denominator: u256): u256 {
        let result = 0u256;
        result = shift_div_round_down(x, offset, denominator);
        if ((((x * (1u256 << (offset as u8))) % denominator) != 0u256)) {
            result += 1u256;
        };
        result
    }

    fun get_mul_prods(x: u256, y: u256): (u256, u256) {
        let prod0 = 0u256;
        let prod1 = 0u256;
        let mm = ((x * y) % (0u256 ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256));
        prod0 = (x * y);
        prod1 = ((mm - prod0) - if ((mm < prod0)) 1u256 else 0u256);
        (prod0, prod1)
    }

    fun get_end_of_div_round_down(x: u256, y: u256, denominator: u256, prod0: u256, prod1: u256): u256 {
        let result = 0u256;
        if ((prod1 == 0u256)) {
            result = (prod0 / denominator);
        } else {
            if ((prod1 >= denominator)) {
                abort E_UINT256X256_MATH_MUL_DIV_OVERFLOW
            };
            let remainder: u256;
            remainder = ((x * y) % denominator);
            prod1 = (prod1 - if ((remainder > prod0)) 1u256 else 0u256);
            prod0 = (prod0 - remainder);
            let lpotdod: u256 = (denominator & (((denominator ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256) + 1u256)));
            denominator = (denominator / lpotdod);
            prod0 = (prod0 / lpotdod);
            lpotdod = (((0u256 - lpotdod) / lpotdod) + 1u256);
            prod0 |= (prod1 * lpotdod);
            let inverse: u256 = (((3u256 * denominator)) ^ 2u256);
            inverse *= (2u256 - (denominator * inverse));
            inverse *= (2u256 - (denominator * inverse));
            inverse *= (2u256 - (denominator * inverse));
            inverse *= (2u256 - (denominator * inverse));
            inverse *= (2u256 - (denominator * inverse));
            inverse *= (2u256 - (denominator * inverse));
            result = (prod0 * inverse);
        };
        result
    }

    public(package) fun sqrt(x: u256): u256 {
        let sqrt_x = 0u256;
        if ((x == 0u256)) {
            0u256
        };
        let msb: u256 = bit_math::most_significant_bit(x);
        sqrt_x = (1u256 << ((msb >> (1u256 as u8)) as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        sqrt_x = ((sqrt_x + (x / sqrt_x)) >> (1u256 as u8));
        x = (x / sqrt_x);
        if ((sqrt_x < x)) sqrt_x else x
    }
}