module 0x1::my_nft {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use aptos_framework::event;
    use std::string;
    use aptos_std::bcs;
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
    const E_INVALID_OWNER: u64 = 256u64;
    const E_NOT_AUTHORIZED: u64 = 257u64;
    const E_INVALID_RECIPIENT: u64 = 258u64;

    struct MyNFTState has key {
        name: std::string::String,
        symbol: std::string::String,
        base_uri: std::string::String,
        owners: aptos_std::table::Table<u256, address>,
        balances: aptos_std::table::Table<address, u256>,
        token_approvals: aptos_std::table::Table<u256, address>,
        operator_approvals: aptos_std::table::Table<address, aptos_std::table::Table<address, bool>>,
        token_id_counter: u256,
        signer_cap: account::SignerCapability
    }

    #[event]
    struct Transfer has drop, store {
        from: address,
        to: address,
        token_id: u256
    }

    #[event]
    struct Approval has drop, store {
        owner: address,
        approved: address,
        token_id: u256
    }

    #[event]
    struct ApprovalForAll has drop, store {
        owner: address,
        operator: address,
        approved: bool
    }

    fun init_module(deployer: &signer) {
        let (_resource_signer, signer_cap) = account::create_resource_account(deployer, b"my_nft");
        move_to(deployer, MyNFTState { name: "My NFT Collection", symbol: "MNFT", base_uri: "https://example.com/nft/", owners: table::new(), balances: table::new(), token_approvals: table::new(), operator_approvals: table::new(), token_id_counter: 0, signer_cap: signer_cap });
    }

    #[view]
    public fun balance_of(owner: address): u256 acquires MyNFTState {
        let state = borrow_global<MyNFTState>(@0x1);
        assert!((owner != @0x0), E_INVALID_OWNER);
        return *table::borrow_with_default(&state.balances, owner, &0u256)
    }

    #[view]
    public fun owner_of(token_id: u256): address acquires MyNFTState {
        let state = borrow_global<MyNFTState>(@0x1);
        let owner: address = *table::borrow_with_default(&state.owners, token_id, &@0x0);
        assert!((owner != @0x0), E_NOT_FOUND);
        return owner
    }

    #[view]
    public fun token_uri(token_id: u256): std::string::String acquires MyNFTState {
        let state = borrow_global<MyNFTState>(@0x1);
        assert!((*table::borrow_with_default(&state.owners, token_id, &@0x0) != @0x0), E_NOT_FOUND);
        return ({
        let __bytes = bcs::to_bytes(&state.base_uri);
        vector::append(&mut __bytes, bcs::to_bytes(&token_id));
        __bytes
    } as std::string::String)
    }

    public entry fun approve(account: &signer, to: address, token_id: u256) acquires MyNFTState {
        let state = borrow_global_mut<MyNFTState>(@0x1);
        let owner: address = owner_of(token_id);
        assert!((to != owner), E_INSUFFICIENT_ALLOWANCE);
        assert!(((signer::address_of(account) == owner) || is_approved_for_all(owner, signer::address_of(account))), E_NOT_AUTHORIZED);
        *table::borrow_mut_with_default(&mut state.token_approvals, token_id, @0x0) = to;
        event::emit(Approval { owner: owner, approved: to, token_id: token_id });
    }

    #[view]
    public fun get_approved(token_id: u256): address acquires MyNFTState {
        let state = borrow_global<MyNFTState>(@0x1);
        assert!((*table::borrow_with_default(&state.owners, token_id, &@0x0) != @0x0), E_NOT_FOUND);
        return *table::borrow_with_default(&state.token_approvals, token_id, &@0x0)
    }

    public entry fun set_approval_for_all(account: &signer, operator: address, approved: bool) acquires MyNFTState {
        let state = borrow_global_mut<MyNFTState>(@0x1);
        assert!((operator != signer::address_of(account)), E_INSUFFICIENT_ALLOWANCE);
        if (!table::contains(&state.operator_approvals, signer::address_of(account))) {
            table::add(&mut state.operator_approvals, signer::address_of(account), table::new());
        };
        *table::borrow_mut(&mut *table::borrow_mut(&mut state.operator_approvals, signer::address_of(account)), operator) = approved;
        event::emit(ApprovalForAll { owner: signer::address_of(account), operator: operator, approved: approved });
    }

    #[view]
    public fun is_approved_for_all(owner: address, operator: address): bool acquires MyNFTState {
        let state = borrow_global<MyNFTState>(@0x1);
        return *table::borrow_with_default(table::borrow(&state.operator_approvals, owner), operator, &false)
    }

    public entry fun transfer_from(account: &signer, from: address, to: address, token_id: u256) acquires MyNFTState {
        let state = borrow_global_mut<MyNFTState>(@0x1);
        assert!(is_approved_or_owner(signer::address_of(account), token_id), E_NOT_AUTHORIZED);
        assert!((to != @0x0), E_INVALID_RECIPIENT);
        *table::borrow_mut_with_default(&mut state.balances, from, 0u256) -= 1;
        *table::borrow_mut_with_default(&mut state.balances, to, 0u256) += 1;
        *table::borrow_mut_with_default(&mut state.owners, token_id, @0x0) = to;
        table::remove(&mut state.token_approvals, token_id);
        event::emit(Transfer { from: from, to: to, token_id: token_id });
    }

    public entry fun safe_transfer_from(account: &signer, from: address, to: address, token_id: u256) {
        transfer_from(from, to, token_id);
    }

    public fun mint(account: &signer, to: address): u256 acquires MyNFTState {
        let state = borrow_global_mut<MyNFTState>(@0x1);
        assert!((to != @0x0), E_INVALID_RECIPIENT);
        let token_id: u256 = state.token_id_counter;
        state.token_id_counter += 1;
        *table::borrow_mut_with_default(&mut state.balances, to, 0u256) += 1;
        *table::borrow_mut_with_default(&mut state.owners, token_id, @0x0) = to;
        event::emit(Transfer { from: @0x0, to: to, token_id: token_id });
        return token_id
    }

    public entry fun burn(account: &signer, token_id: u256) acquires MyNFTState {
        let state = borrow_global_mut<MyNFTState>(@0x1);
        let owner: address = owner_of(token_id);
        assert!((signer::address_of(account) == owner), E_UNAUTHORIZED);
        *table::borrow_mut_with_default(&mut state.balances, owner, 0u256) -= 1;
        table::remove(&mut state.owners, token_id);
        table::remove(&mut state.token_approvals, token_id);
        event::emit(Transfer { from: owner, to: @0x0, token_id: token_id });
    }

    public(package) fun is_approved_or_owner(spender: address, token_id: u256): bool {
        let owner: address = owner_of(token_id);
        return ((((spender == owner) || (get_approved(token_id) == spender)) || is_approved_for_all(owner, spender)))
    }
}