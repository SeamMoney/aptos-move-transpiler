module 0x1::struct_array {

    use std::signer;
    use aptos_framework::account;
    use std::string;
    use std::vector;

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

    struct StructArrayState has key {
        items: vector<Item>,
        signer_cap: account::SignerCapability
    }

    struct Item has copy, drop, store {
        id: u256,
        name: std::string::String
    }

    fun init_module(deployer: &signer) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"struct_array");
        move_to(&resource_signer, StructArrayState { items: vector::empty(), signer_cap: signer_cap });
    }

    public entry fun add_item(account: &signer, id: u256, name: std::string::String) acquires StructArrayState {
        let state = borrow_global<StructArrayState>(@0x1);
        vector::push_back(&mut state.items, Item { id: id, name: name });
    }
}