module transpiler::evm_compat {
    use std::vector;
    use aptos_std::bcs;
    use aptos_std::from_bcs;

    public fun address_to_u256(addr: address): u256 {
        let bytes = bcs::to_bytes(&addr);
        bytes_to_u256(bytes)
    }

    public fun bytes_to_u256(bytes: vector<u8>): u256 {
        let len = vector::length(&bytes);
        let value: u256 = 0;
        let i = 0;
        while (i < len && i < 32) {
            value = (value << 8) | (*vector::borrow(&bytes, i) as u256);
            i = i + 1;
        };
        value
    }

    public fun to_address(value: u256): address {
        let bytes = bcs::to_bytes(&value);
        let addr_bytes = vector::empty<u8>();
        let len = vector::length(&bytes);
        let start = if (len > 32) { len - 32 } else { 0 };
        let i = start;
        while (i < len) {
            vector::push_back(&mut addr_bytes, *vector::borrow(&bytes, i));
            i = i + 1;
        };
        while (vector::length(&addr_bytes) < 32) {
            vector::push_back(&mut addr_bytes, 0u8);
        };
        from_bcs::to_address(addr_bytes)
    }
}
