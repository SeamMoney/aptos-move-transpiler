module 0x1::reentrancy_guard_upgradeable {

    use std::signer;
    use aptos_framework::account;
    use std::string;

    // Error codes
    const NOT_ENTERED: u256 = 1u256;
    const ENTERED: u256 = 2u256;
    const REENTRANCY_GUARD_STORAGE_LOCATION: u256 = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00u256;
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
    const E_REENTRANCY_GUARD_REENTRANT_CALL: u64 = 256u64;
    const E_MODIFIER_ONLY_INITIALIZING: u64 = 257u64;

    struct ReentrancyGuardUpgradeableState has key {
        signer_cap: account::SignerCapability
    }

    struct ReentrancyGuardStorage has copy, drop, store {
        status: u256
    }

    fun init_module(deployer: &signer) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"reentrancy_guard_upgradeable");
        move_to(&resource_signer, ReentrancyGuardUpgradeableState { signer_cap: signer_cap });
    }

    fun get_reentrancy_guard_storage(): ReentrancyGuardStorage {
        let _storage_ref = 0u256;
        string::utf8(b"UNSUPPORTED: inline assembly (Yul) - complex pattern not yet supported");
        return _storage_ref
    }

    public(package) fun __reentrancy_guard_init(state: &mut ReentrancyGuardUpgradeableState) {
        assert!(true, E_MODIFIER_ONLY_INITIALIZING);
        __reentrancy_guard_init_unchained(state);
    }

    public(package) fun __reentrancy_guard_init_unchained(state: &mut ReentrancyGuardUpgradeableState) {
        assert!(true, E_MODIFIER_ONLY_INITIALIZING);
        let _storage_ref: ReentrancyGuardStorage = get_reentrancy_guard_storage();
        _storage_ref.status = NOT_ENTERED;
    }

    public(package) fun non_reentrant_before(state: &mut ReentrancyGuardUpgradeableState) {
        let _storage_ref: ReentrancyGuardStorage = get_reentrancy_guard_storage();
        if ((_storage_ref.status == ENTERED)) {
            abort E_REENTRANCY_GUARD_REENTRANT_CALL
        };
        _storage_ref.status = ENTERED;
    }

    public(package) fun non_reentrant_after(state: &mut ReentrancyGuardUpgradeableState) {
        let _storage_ref: ReentrancyGuardStorage = get_reentrancy_guard_storage();
        _storage_ref.status = NOT_ENTERED;
    }

    #[view]
    public(package) fun reentrancy_guard_entered(state: &ReentrancyGuardUpgradeableState): bool {
        let _storage_ref: ReentrancyGuardStorage = get_reentrancy_guard_storage();
        return (_storage_ref.status == ENTERED)
    }
}