module 0x1::bin_helper {

    use std::u128;
    use 0x1::packed_uint128_math;
    use 0x1::safe_cast;
    use 0x1::uint256x256_math;
    use 0x1::fee_helper;
    use 0x1::pair_parameter_helper;
    use 0x1::price_helper;
    use 0x1::token_helper;

    // Error codes
    const SCALE: u256 = 340282366920938463463374607431768211456u256;
    const SCALE_OFFSET: u8 = 128u8;
    const MAX_LIQUIDITY_PER_BIN: u256 = 65251743116719673010965625540244653191619923014385985379600384103134737u256;
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
    const E_BIN_HELPER_COMPOSITION_FACTOR_FLAWED: u64 = 256u64;
    const E_BIN_HELPER_LIQUIDITY_OVERFLOW: u64 = 257u64;
    const E_BIN_HELPER_MAX_LIQUIDITY_PER_BIN_EXCEEDED: u64 = 258u64;

    public(package) fun get_amount_out_of_bin(bin_reserves: u256, amount_to_burn: u256, total_supply: u256): u256 {
        let amounts_out = 0u256;
        let (bin_reserve_x, bin_reserve_y) = packed_uint128_math::decode(bin_reserves);
        let amount_x_out_from_bin: u128;
        let amount_y_out_from_bin: u128;
        if ((bin_reserve_x > 0)) {
            amount_x_out_from_bin = safe_cast::safe128((uint256x256_math::mul_div_round_down(amount_to_burn, bin_reserve_x, total_supply)));
        };
        if ((bin_reserve_y > 0)) {
            amount_y_out_from_bin = safe_cast::safe128((uint256x256_math::mul_div_round_down(amount_to_burn, bin_reserve_y, total_supply)));
        };
        amounts_out = packed_uint128_math::encode(amount_x_out_from_bin, amount_y_out_from_bin);
        return amounts_out
    }

    public(package) fun get_shares_and_effective_amounts_in(bin_reserves: u256, amounts_in: u256, price: u256, total_supply: u256): (u256, u256) {
        let shares = 0u256;
        let _effective_amounts_in = 0u256;
        let (x, y) = packed_uint128_math::decode(amounts_in);
        let user_liquidity: u256 = get_liquidity_u_u_u(x, y, price);
        if ((user_liquidity == 0)) {
            return (0, 0)
        };
        let bin_liquidity: u256 = get_liquidity(bin_reserves, price);
        if (((bin_liquidity == 0) || (total_supply == 0))) {
            return (uint256x256_math::sqrt(user_liquidity), amounts_in)
        };
        shares = uint256x256_math::mul_div_round_down(user_liquidity, total_supply, bin_liquidity);
        let effective_liquidity: u256 = uint256x256_math::mul_div_round_up(shares, bin_liquidity, total_supply);
        if ((user_liquidity > effective_liquidity)) {
            let delta_liquidity: u256 = (user_liquidity - effective_liquidity);
            if ((delta_liquidity >= SCALE)) {
                let delta_y: u256 = (delta_liquidity >> (SCALE_OFFSET as u8));
                delta_y = (if ((delta_y > y)) y else delta_y);
                y -= delta_y;
                delta_liquidity -= (delta_y << (SCALE_OFFSET as u8));
            };
            if ((delta_liquidity >= price)) {
                let delta_x: u256 = (delta_liquidity / price);
                delta_x = (if ((delta_x > x)) x else delta_x);
                x -= delta_x;
            };
            amounts_in = packed_uint128_math::encode((x as u128), (y as u128));
        };
        if ((get_liquidity((bin_reserves + amounts_in), price) > MAX_LIQUIDITY_PER_BIN)) {
            abort E_BIN_HELPER_MAX_LIQUIDITY_PER_BIN_EXCEEDED
        };
        return (shares, amounts_in)
    }

    public(package) fun get_liquidity(amounts: u256, price: u256): u256 {
        let _liquidity = 0u256;
        let (x, y) = packed_uint128_math::decode(amounts);
        return get_liquidity_u_u_u(x, y, price)
    }

    public(package) fun get_liquidity_u_u_u(x: u256, y: u256, price: u256): u256 {
        let liquidity = 0u256;
        if ((x > 0)) {
            liquidity = (price * x);
            if (((liquidity / x) != price)) {
                abort E_BIN_HELPER_LIQUIDITY_OVERFLOW
            };
        };
        if ((y > 0)) {
            y <<= (SCALE_OFFSET as u8);
            liquidity += y;
            if ((liquidity < y)) {
                abort E_BIN_HELPER_LIQUIDITY_OVERFLOW
            };
        };
        return liquidity
    }

    public(package) fun verify_amounts(amounts: u256, active_id: u32, id: u32) {
        if ((((id < active_id) && (((amounts << 128u8)) > 0)) || ((id > active_id) && ((amounts as u256) > u128::MAX)))) {
            abort E_BIN_HELPER_COMPOSITION_FACTOR_FLAWED
        };
    }

    public(package) fun get_composition_fees(bin_reserves: u256, parameters: u256, bin_step: u16, amounts_in: u256, total_supply: u256, shares: u256): u256 {
        let fees = 0u256;
        if ((shares == 0)) {
            return 0
        };
        let (amount_x, amount_y) = packed_uint128_math::decode(amounts_in);
        let (received_amount_x, received_amount_y) = packed_uint128_math::decode(get_amount_out_of_bin((bin_reserves + amounts_in), shares, (total_supply + shares)));
        if ((received_amount_x > amount_x)) {
            let fee_y: u128 = fee_helper::get_composition_fee(((amount_y - received_amount_y)), pair_parameter_helper::get_total_fee(parameters, bin_step));
            fees = packed_uint128_math::encode_second(fee_y);
        } else {
            if ((received_amount_y > amount_y)) {
                let fee_x: u128 = fee_helper::get_composition_fee(((amount_x - received_amount_x)), pair_parameter_helper::get_total_fee(parameters, bin_step));
                fees = packed_uint128_math::encode_first(fee_x);
            };
        };
    }

    public(package) fun is_empty(bin_reserves: u256, is_x: bool): bool {
        return (if (is_x) (packed_uint128_math::decode_x(bin_reserves) == 0) else (packed_uint128_math::decode_y(bin_reserves) == 0))
    }

    public(package) fun get_amounts(bin_reserves: u256, parameters: u256, bin_step: u16, swap_for_y: bool, active_id: u32, amounts_in_left: u256): (u256, u256, u256) {
        let amounts_in_with_fees = 0u256;
        let amounts_out_of_bin = 0u256;
        let total_fees = 0u256;
        let price: u256 = price_helper::get_price_from_id(active_id, bin_step);
        let bin_reserve_out: u128 = packed_uint128_math::decode(bin_reserves, !swap_for_y);
        let max_amount_in: u128 = (if (swap_for_y) safe_cast::safe128(uint256x256_math::shift_div_round_up((bin_reserve_out as u256), SCALE_OFFSET, price)) else safe_cast::safe128(uint256x256_math::mul_shift_round_up((bin_reserve_out as u256), price, SCALE_OFFSET)));
        let total_fee: u128 = pair_parameter_helper::get_total_fee(parameters, bin_step);
        let max_fee: u128 = fee_helper::get_fee_amount(max_amount_in, total_fee);
        max_amount_in += max_fee;
        let amount_in128: u128 = packed_uint128_math::decode(amounts_in_left, swap_for_y);
        let fee128: u128;
        let amount_out128: u128;
        if ((amount_in128 >= max_amount_in)) {
            fee128 = max_fee;
            amount_in128 = max_amount_in;
            amount_out128 = bin_reserve_out;
        } else {
            fee128 = fee_helper::get_fee_amount_from(amount_in128, total_fee);
            let amount_in: u256 = (amount_in128 - fee128);
            amount_out128 = (if (swap_for_y) safe_cast::safe128(uint256x256_math::mul_shift_round_down((amount_in as u256), price, SCALE_OFFSET)) else safe_cast::safe128(uint256x256_math::shift_div_round_down((amount_in as u256), SCALE_OFFSET, price)));
            if ((amount_out128 > bin_reserve_out)) {
                amount_out128 = bin_reserve_out;
            };
        };
        (amounts_in_with_fees, amounts_out_of_bin, total_fees) = (if (swap_for_y) (packed_uint128_math::encode_first(amount_in128), packed_uint128_math::encode_second(amount_out128), packed_uint128_math::encode_first(fee128)) else (packed_uint128_math::encode_second(amount_in128), packed_uint128_math::encode_first(amount_out128), packed_uint128_math::encode_second(fee128)));
        if ((get_liquidity(((bin_reserves + amounts_in_with_fees) - amounts_out_of_bin), price) > MAX_LIQUIDITY_PER_BIN)) {
            abort E_BIN_HELPER_MAX_LIQUIDITY_PER_BIN_EXCEEDED
        };
        return (amounts_in_with_fees, amounts_out_of_bin, total_fees)
    }

    public(package) fun received(reserves: u256, token_x: address, token_y: address): u256 {
        let amounts = 0u256;
        amounts = (packed_uint128_math::encode(balance_of(token_x), balance_of(token_y)) - reserves);
        return amounts
    }

    public(package) fun received_x(reserves: u256, token_x: address): u256 {
        let reserve_x: u128 = packed_uint128_math::decode_x(reserves);
        return packed_uint128_math::encode_first(((balance_of(token_x) - reserve_x)))
    }

    public(package) fun received_y(reserves: u256, token_y: address): u256 {
        let reserve_y: u128 = packed_uint128_math::decode_y(reserves);
        return packed_uint128_math::encode_second(((balance_of(token_y) - reserve_y)))
    }

    public(package) fun transfer(amounts: u256, token_x: address, token_y: address, recipient: address) {
        let (amount_x, amount_y) = packed_uint128_math::decode(amounts);
        if ((amount_x > 0)) {
            token_helper::safe_transfer(token_x, recipient, amount_x);
        };
        if ((amount_y > 0)) {
            token_helper::safe_transfer(token_y, recipient, amount_y);
        };
    }

    public(package) fun transfer_x(amounts: u256, token_x: address, recipient: address) {
        let amount_x: u128 = packed_uint128_math::decode_x(amounts);
        if ((amount_x > 0)) {
            token_helper::safe_transfer(token_x, recipient, amount_x);
        };
    }

    public(package) fun transfer_y(amounts: u256, token_y: address, recipient: address) {
        let amount_y: u128 = packed_uint128_math::decode_y(amounts);
        if ((amount_y > 0)) {
            token_helper::safe_transfer(token_y, recipient, amount_y);
        };
    }

    fun balance_of(token: address): u128 {
        return safe_cast::safe128(balance_of(token, @0x1))
    }
}