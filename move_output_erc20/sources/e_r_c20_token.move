module 0x1::e_r_c20_token {

    use std::signer;
    use aptos_std::table;
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
    const E_INVALID RECIPIENT: u64 = 256u64;
    const E_INVALID SPENDER: u64 = 257u64;

    struct ERC20TokenState has key {
        name: vector<u8>,
        symbol: vector<u8>,
        decimals: u8,
        total_supply: u256,
        balance_of: aptos_std::table::Table<address, u256>,
        allowance: aptos_std::table::Table<address, aptos_std::table::Table<address, u256>>
    }

    #[event]
    struct Transfer has drop, store {
        from: address,
        to: address,
        value: u256
    }

    #[event]
    struct Approval has drop, store {
        owner: address,
        spender: address,
        value: u256
    }

    public entry fun initialize(deployer: &signer, name: vector<u8>, symbol: vector<u8>, initial_supply: u256) {
        *table::borrow(&state.balance_of, signer::address_of(account)) = state.total_supply;
        move_to(deployer, ERC20TokenState { name: _name, symbol: _symbol, decimals: 18u256, total_supply: (_initialSupply * (10u256 ** decimals)), balance_of: table::new(), allowance: table::new() });
    }

    public entry fun transfer(account: &signer, to: address, amount: u256): bool acquires ERC20TokenState {
        let state = borrow_global_mut<ERC20TokenState>(@0x1);
        assert!((*table::borrow(&state.balance_of, signer::address_of(account)) >= amount), E_INSUFFICIENT_BALANCE);
        assert!((to != address(0u256)), E_INVALID RECIPIENT);
        *table::borrow(&state.balance_of, signer::address_of(account)) -= amount;
        *table::borrow(&state.balance_of, to) += amount;
        event::emit(Transfer { from: signer::address_of(account), to: to, value: amount });
        true
    }

    public entry fun approve(account: &signer, spender: address, amount: u256): bool acquires ERC20TokenState {
        let state = borrow_global_mut<ERC20TokenState>(@0x1);
        assert!((spender != address(0u256)), E_INVALID SPENDER);
        *table::borrow(&*table::borrow(&state.allowance, signer::address_of(account)), spender) = amount;
        event::emit(Approval { owner: signer::address_of(account), spender: spender, value: amount });
        true
    }

    public entry fun transfer_from(account: &signer, from: address, to: address, amount: u256): bool acquires ERC20TokenState {
        let state = borrow_global_mut<ERC20TokenState>(@0x1);
        assert!((*table::borrow(&state.balance_of, from) >= amount), E_INSUFFICIENT_BALANCE);
        assert!((*table::borrow(&*table::borrow(&state.allowance, from), signer::address_of(account)) >= amount), E_INSUFFICIENT_ALLOWANCE);
        assert!((to != address(0u256)), E_INVALID RECIPIENT);
        *table::borrow(&state.balance_of, from) -= amount;
        *table::borrow(&state.balance_of, to) += amount;
        *table::borrow(&*table::borrow(&state.allowance, from), signer::address_of(account)) -= amount;
        event::emit(Transfer { from: from, to: to, value: amount });
        true
    }
}