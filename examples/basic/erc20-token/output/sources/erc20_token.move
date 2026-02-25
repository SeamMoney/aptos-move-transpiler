module 0x1::erc20_token {

    use std::signer;
    use aptos_std::table;
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
    const E_INVALID_RECIPIENT: u64 = 256u64;
    const E_INVALID_SPENDER: u64 = 257u64;

    struct ERC20TokenState has key {
        name: std::string::String,
        symbol: std::string::String,
        decimals: u8,
        total_supply: u256,
        balance_of: aptos_std::table::Table<address, u256>,
        allowance: aptos_std::table::Table<address, aptos_std::table::Table<address, u256>>,
        signer_cap: account::SignerCapability
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

    public entry fun initialize(deployer: &signer, initial_supply: u256) {
        let (_resource_signer, signer_cap) = account::create_resource_account(deployer, b"erc20_token");
        move_to(deployer, ERC20TokenState { name: "Test Token", symbol: "TEST", decimals: 18u8, total_supply: (initial_supply * ((10 ** decimals))), balance_of: table::new(), allowance: table::new(), signer_cap: signer_cap });
        let state = borrow_global_mut<ERC20TokenState>(signer::address_of(deployer));
        table::add(&mut state.balance_of, signer::address_of(deployer), state.total_supply);
    }

    public fun transfer(account: &signer, to: address, amount: u256): bool acquires ERC20TokenState {
        let state = borrow_global_mut<ERC20TokenState>(@0x1);
        assert!((*table::borrow_with_default(&state.balance_of, signer::address_of(account), &0u256) >= amount), E_INSUFFICIENT_BALANCE);
        assert!((to != @0x0), E_INVALID_RECIPIENT);
        *table::borrow_mut_with_default(&mut state.balance_of, signer::address_of(account), 0u256) -= amount;
        *table::borrow_mut_with_default(&mut state.balance_of, to, 0u256) += amount;
        event::emit(Transfer { from: signer::address_of(account), to: to, value: amount });
        return true
    }

    public fun approve(account: &signer, spender: address, amount: u256): bool acquires ERC20TokenState {
        let state = borrow_global_mut<ERC20TokenState>(@0x1);
        assert!((spender != @0x0), E_INVALID_SPENDER);
        if (!table::contains(&state.allowance, signer::address_of(account))) {
            table::add(&mut state.allowance, signer::address_of(account), table::new());
        };
        *table::borrow_mut(&mut *table::borrow_mut(&mut state.allowance, signer::address_of(account)), spender) = amount;
        event::emit(Approval { owner: signer::address_of(account), spender: spender, value: amount });
        return true
    }

    public fun transfer_from(account: &signer, from: address, to: address, amount: u256): bool acquires ERC20TokenState {
        let state = borrow_global_mut<ERC20TokenState>(@0x1);
        assert!((*table::borrow_with_default(&state.balance_of, from, &0u256) >= amount), E_INSUFFICIENT_BALANCE);
        assert!((*table::borrow_with_default(table::borrow(&state.allowance, from), signer::address_of(account), &0u256) >= amount), E_INSUFFICIENT_ALLOWANCE);
        assert!((to != @0x0), E_INVALID_RECIPIENT);
        *table::borrow_mut_with_default(&mut state.balance_of, from, 0u256) -= amount;
        *table::borrow_mut_with_default(&mut state.balance_of, to, 0u256) += amount;
        if (!table::contains(&state.allowance, from)) {
            table::add(&mut state.allowance, from, table::new());
        };
        *table::borrow_mut(&mut *table::borrow_mut(&mut state.allowance, from), signer::address_of(account)) -= amount;
        event::emit(Transfer { from: from, to: to, value: amount });
        return true
    }
}