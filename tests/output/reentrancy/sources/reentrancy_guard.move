module 0x1::reentrancy_guard {

    use std::signer;
    use aptos_framework::account;
    use std::string;

    // Error codes
    const NOT_ENTERED: u256 = 1u256;
    const ENTERED: u256 = 2u256;
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

    struct ReentrancyGuardState has key {
        status: u256,
        signer_cap: account::SignerCapability
    }

    fun init_module(deployer: &signer) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"reentrancy_guard");
        move_to(&resource_signer, ReentrancyGuardState { status: 0, signer_cap: signer_cap });
    }

    public entry fun withdraw(account: &signer, amount: u256) acquires ReentrancyGuardState {
        let state = borrow_global_mut<ReentrancyGuardState>(@0x1);
        assert!((state.reentrancy_status != 2u8), E_REENTRANCY);
        state.reentrancy_status = 2u8;
        state.reentrancy_status = 1u8;
    }
}