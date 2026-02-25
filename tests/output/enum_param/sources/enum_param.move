module 0x1::enum_param {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use std::string;

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

    struct EnumParamState has key {
        item_status: aptos_std::table::Table<u256, Status>,
        signer_cap: account::SignerCapability
    }

    enum Status has copy, drop, store {
        Pending,
        Active,
        Completed
    }

    fun init_module(deployer: &signer) {
        let (_resource_signer, signer_cap) = account::create_resource_account(deployer, b"enum_param");
        move_to(deployer, EnumParamState { item_status: table::new(), signer_cap: signer_cap });
    }

    public entry fun set_status(account: &signer, id: u256, status: Status) acquires EnumParamState {
        let state = borrow_global_mut<EnumParamState>(@0x1);
        *table::borrow_mut_with_default(&mut state.item_status, id, 0u256) = status;
    }

    #[view]
    public fun is_active(id: u256): bool acquires EnumParamState {
        let state = borrow_global<EnumParamState>(@0x1);
        return (*table::borrow_with_default(&state.item_status, id, &0u256) == Status::Active)
    }
}