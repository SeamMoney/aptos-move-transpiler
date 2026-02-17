module 0x1::l_b_token {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use std::string;
    use std::vector;
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

    struct LBTokenState has key {
        balances: aptos_std::table::Table<address, aptos_std::table::Table<u256, u256>>,
        total_supplies: aptos_std::table::Table<u256, u256>,
        spender_approvals: aptos_std::table::Table<address, aptos_std::table::Table<address, bool>>,
        signer_cap: account::SignerCapability
    }

    fun init_module(deployer: &signer) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"l_b_token");
        move_to(&resource_signer, LBTokenState { balances: 0, total_supplies: 0, spender_approvals: 0, signer_cap: signer_cap });
    }

    public fun name(): vector<u8> {
        return string::utf8(b"Liquidity Book Token")
    }

    public fun symbol(): vector<u8> {
        return string::utf8(b"LBT")
    }

    #[view]
    public fun total_supply(id: u256): u256 acquires LBTokenState {
        let state = borrow_global<LBTokenState>(@0x1);
        return *table::borrow_with_default(&state.total_supplies, id, &0u256)
    }

    #[view]
    public fun balance_of(account: address, id: u256): u256 acquires LBTokenState {
        let state = borrow_global<LBTokenState>(@0x1);
        return *table::borrow(&*table::borrow_with_default(&state.balances, account, &0u256), id)
    }

    public fun balance_of_batch(accounts: vector<address>, ids: vector<u256>): vector<u256> {
        let batch_balances = vector::empty();
        check_length(vector::length(&accounts), vector::length(&ids));
        batch_balances = unknown(vector::length(&accounts));
        let i: u256;
        while ((i < (vector::length(&accounts) as u256))) {
            *vector::borrow_mut(&mut batch_balances, (i as u64)) = balance_of(*vector::borrow(&accounts, (i as u64)), *vector::borrow(&ids, (i as u64)));
            i = (i + 1);
        }
        return batch_balances
    }

    public fun is_approved_for_all(owner: address, spender: address): bool {
        return is_approved_for_all(owner, spender, state)
    }

    public entry fun approve_for_all(account: &signer, spender: address, approved: bool) {
        approve_for_all(signer::address_of(account), spender, approved, state);
    }

    public entry fun batch_transfer_from(account: &signer, from: address, to: address, ids: vector<u256>, amounts: vector<u256>) {
        if (!is_approved_for_all(from, signer::address_of(account), state)) {
            abort E_L_B_TOKEN_SPENDER_NOT_APPROVED
        };
        batch_transfer_from(from, to, ids, amounts, state);
    }

    #[view]
    public(package) fun is_approved_for_all(owner: address, spender: address, state: &LBTokenState): bool {
        return ((owner == spender) || *table::borrow(&*table::borrow_with_default(&state.spender_approvals, owner, &0u256), spender))
    }

    public(package) fun mint(account: address, id: u256, amount: u256, state: &mut LBTokenState) {
        *table::borrow_mut_with_default(&mut state.total_supplies, id, 0u256) += amount;
        *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.balances, account, 0u256), id) += amount;
    }

    public(package) fun burn(account: address, id: u256, amount: u256, state: &LBTokenState) {
        let account_balances: aptos_std::table::Table<u256, u256> = *table::borrow_with_default(&state.balances, account, &0u256);
        let balance: u256 = *table::borrow_with_default(&account_balances, id, &0u256);
        if ((balance < amount)) {
            abort E_L_B_TOKEN_BURN_EXCEEDS_BALANCE
        };
        *table::borrow_mut_with_default(&mut state.total_supplies, id, 0u256) -= amount;
        *table::borrow_mut_with_default(&mut account_balances, id, 0u256) = (balance - amount);
    }

    public(package) fun batch_transfer_from(account: &signer, from: address, to: address, ids: vector<u256>, amounts: vector<u256>, state: &mut LBTokenState) {
        check_length(vector::length(&ids), vector::length(&amounts));
        not_address_zero_or_this(to);
        let from_balances: aptos_std::table::Table<u256, u256> = *table::borrow_with_default(&state.balances, from, &0u256);
        let to_balances: aptos_std::table::Table<u256, u256> = *table::borrow_with_default(&state.balances, to, &0u256);
        let i: u256;
        while ((i < (vector::length(&ids) as u256))) {
            let id: u256 = *vector::borrow(&ids, (i as u64));
            let amount: u256 = *vector::borrow(&amounts, (i as u64));
            let from_balance: u256 = *table::borrow_with_default(&from_balances, id, &0u256);
            if ((from_balance < amount)) {
                abort E_L_B_TOKEN_TRANSFER_EXCEEDS_BALANCE
            };
            *table::borrow_mut_with_default(&mut from_balances, id, 0u256) = (from_balance - amount);
            *table::borrow_mut_with_default(&mut to_balances, id, 0u256) += amount;
            i = (i + 1);
        }
        event::emit(TransferBatch { arg0: signer::address_of(account), arg1: from, arg2: to, arg3: ids, arg4: amounts });
    }

    public(package) fun approve_for_all(owner: address, spender: address, approved: bool, state: &mut LBTokenState) {
        not_address_zero_or_this(owner);
        if ((owner == spender)) {
            abort E_L_B_TOKEN_SELF_APPROVAL
        };
        *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.spender_approvals, owner, 0u256), spender) = approved;
        event::emit(ApprovalForAll { arg0: owner, arg1: spender, arg2: approved });
    }

    public(package) fun not_address_zero_or_this(account: address) {
        if (((account == @0x0) || (account == @0x1))) {
            abort E_L_B_TOKEN_ADDRESS_THIS_OR_ZERO
        };
    }

    public(package) fun check_length(length_a: u256, length_b: u256) {
        if ((length_a != length_b)) {
            abort E_L_B_TOKEN_INVALID_LENGTH
        };
    }
}