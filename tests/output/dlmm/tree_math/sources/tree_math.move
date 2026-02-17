module 0x1::tree_math {

    use std::vector;
    use std::u8;
    use std::u256;
    use 0x1::bit_math;

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

    struct TreeUint24 has copy, drop, store {
        level0: u256,
        level1: aptos_std::table::Table<u256, u256>,
        level2: aptos_std::table::Table<u256, u256>
    }

    public(package) fun contains(tree: TreeUint24, id: u32): bool {
        let leaf2: u256 = (((id as u256) >> 8u8) as u256);
        return ((*vector::borrow(&tree.level2, (leaf2 as u64)) & ((1 << (((id & u8::MAX)) as u8)) as u256)) != 0)
    }

    public(package) fun add(tree: TreeUint24, id: u32, state: &mut TreeMathState): bool {
        let key2: u256 = (((id as u256) >> 8u8) as u256);
        let leaves: u256 = *vector::borrow(&tree.level2, (key2 as u64));
        let new_leaves: u256 = (leaves | ((1 << (((id & u8::MAX)) as u8)) as u256));
        if ((leaves != new_leaves)) {
            *vector::borrow_mut(&mut tree.level2, (key2 as u64)) = new_leaves;
            if ((leaves == 0)) {
                let key1: u256 = (key2 >> 8u8);
                leaves = *vector::borrow(&tree.level1, (key1 as u64));
                *vector::borrow_mut(&mut tree.level1, (key1 as u64)) = (leaves | ((1 << ((((key2 as u256) & u8::MAX)) as u8)) as u256));
                if ((leaves == 0)) {
                    tree.level0 |= ((1 << ((((key1 as u256) & u8::MAX)) as u8)) as u256);
                };
            };
            return true
        };
        return false
    }

    public(package) fun remove(tree: TreeUint24, id: u32, state: &mut TreeMathState): bool {
        let key2: u256 = (((id as u256) >> 8u8) as u256);
        let leaves: u256 = *vector::borrow(&tree.level2, (key2 as u64));
        let new_leaves: u256 = (leaves & (((1 << (((id & u8::MAX)) as u8)) as u256) ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256));
        if ((leaves != new_leaves)) {
            *vector::borrow_mut(&mut tree.level2, (key2 as u64)) = new_leaves;
            if ((new_leaves == 0)) {
                let key1: u256 = (key2 >> 8u8);
                new_leaves = (*vector::borrow(&tree.level1, (key1 as u64)) & (((1 << ((((key2 as u256) & u8::MAX)) as u8)) as u256) ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256));
                *vector::borrow_mut(&mut tree.level1, (key1 as u64)) = new_leaves;
                if ((new_leaves == 0)) {
                    tree.level0 &= (((1 << ((((key1 as u256) & u8::MAX)) as u8)) as u256) ^ 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffu256);
                };
            };
            return true
        };
        return false
    }

    public(package) fun find_first_right(tree: TreeUint24, id: u32): u32 {
        let leaves: u256;
        let key2: u256 = (((id as u256) >> 8u8) as u256);
        let bit: u8 = ((id & u8::MAX) as u8);
        if ((bit != 0)) {
            leaves = *vector::borrow(&tree.level2, (key2 as u64));
            let closest_bit: u256 = closest_bit_right(leaves, bit);
            if ((closest_bit != u256::MAX)) {
                return ((((key2 as u256) << 8u8) | closest_bit) & 16777215)
            };
        };
        let key1: u256 = (key2 >> 8u8);
        bit = (((key2 as u256) & u8::MAX) as u8);
        if ((bit != 0)) {
            leaves = *vector::borrow(&tree.level1, (key1 as u64));
            let closest_bit: u256 = closest_bit_right(leaves, bit);
            if ((closest_bit != u256::MAX)) {
                key2 = ((((key1 as u256) << 8u8) | closest_bit) as u256);
                leaves = *vector::borrow(&tree.level2, (key2 as u64));
                return ((((key2 as u256) << 8u8) | bit_math::most_significant_bit((leaves as u256))) & 16777215)
            };
        };
        bit = (((key1 as u256) & u8::MAX) as u8);
        if ((bit != 0)) {
            leaves = tree.level0;
            let closest_bit: u256 = closest_bit_right(leaves, bit);
            if ((closest_bit != u256::MAX)) {
                key1 = (closest_bit as u256);
                leaves = *vector::borrow(&tree.level1, (key1 as u64));
                key2 = ((((key1 as u256) << 8u8) | bit_math::most_significant_bit((leaves as u256))) as u256);
                leaves = *vector::borrow(&tree.level2, (key2 as u64));
                return ((((key2 as u256) << 8u8) | bit_math::most_significant_bit((leaves as u256))) & 16777215)
            };
        };
        return 16777215
    }

    public(package) fun find_first_left(tree: TreeUint24, id: u32): u32 {
        let leaves: u256;
        let key2: u256 = (((id as u256) >> 8u8) as u256);
        let bit: u8 = ((id & u8::MAX) as u8);
        if ((bit != u8::MAX)) {
            leaves = *vector::borrow(&tree.level2, (key2 as u64));
            let closest_bit: u256 = closest_bit_left(leaves, bit);
            if ((closest_bit != u256::MAX)) {
                return ((((key2 as u256) << 8u8) | closest_bit) & 16777215)
            };
        };
        let key1: u256 = (key2 >> 8u8);
        bit = (((key2 as u256) & u8::MAX) as u8);
        if ((bit != u8::MAX)) {
            leaves = *vector::borrow(&tree.level1, (key1 as u64));
            let closest_bit: u256 = closest_bit_left(leaves, bit);
            if ((closest_bit != u256::MAX)) {
                key2 = ((((key1 as u256) << 8u8) | closest_bit) as u256);
                leaves = *vector::borrow(&tree.level2, (key2 as u64));
                return ((((key2 as u256) << 8u8) | bit_math::least_significant_bit((leaves as u256))) & 16777215)
            };
        };
        bit = (((key1 as u256) & u8::MAX) as u8);
        if ((bit != u8::MAX)) {
            leaves = tree.level0;
            let closest_bit: u256 = closest_bit_left(leaves, bit);
            if ((closest_bit != u256::MAX)) {
                key1 = (closest_bit as u256);
                leaves = *vector::borrow(&tree.level1, (key1 as u64));
                key2 = ((((key1 as u256) << 8u8) | bit_math::least_significant_bit((leaves as u256))) as u256);
                leaves = *vector::borrow(&tree.level2, (key2 as u64));
                return ((((key2 as u256) << 8u8) | bit_math::least_significant_bit((leaves as u256))) & 16777215)
            };
        };
        return 0
    }

    fun closest_bit_right(leaves: u256, bit: u8): u256 {
        return bit_math::closest_bit_right((leaves as u256), (bit - 1))
    }

    fun closest_bit_left(leaves: u256, bit: u8): u256 {
        return bit_math::closest_bit_left((leaves as u256), (bit + 1))
    }
}