module 0x1::simple_storage {

    use std::signer;
    use aptos_framework::account;
    use aptos_framework::event;

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

    struct SimpleStorageState has key {
        stored_value: u256,
        owner: address,
        signer_cap: account::SignerCapability
    }

    #[event]
    struct ValueChanged has drop, store {
        sender: address,
        old_value: u256,
        new_value: u256
    }

    fun init_module(deployer: &signer) {
        let (_resource_signer, signer_cap) = account::create_resource_account(deployer, b"simple_storage");
        move_to(deployer, SimpleStorageState { stored_value: 0u256, owner: signer::address_of(deployer), signer_cap: signer_cap });
    }

    public entry fun set_value(account: &signer, new_value: u256) acquires SimpleStorageState {
        let state = borrow_global_mut<SimpleStorageState>(@0x1);
        let old_value: u256 = state.stored_value;
        state.stored_value = new_value;
        event::emit(ValueChanged { sender: signer::address_of(account), old_value: old_value, new_value: new_value });
    }

    #[view]
    public fun get_value(): u256 acquires SimpleStorageState {
        let state = borrow_global<SimpleStorageState>(@0x1);
        return state.stored_value
    }

    public entry fun increment(account: &signer) acquires SimpleStorageState {
        let state = borrow_global_mut<SimpleStorageState>(@0x1);
        state.stored_value += 1;
    }

    #[view]
    public fun is_owner(account: address): bool acquires SimpleStorageState {
        let state = borrow_global<SimpleStorageState>(@0x1);
        return (account == state.owner)
    }
}