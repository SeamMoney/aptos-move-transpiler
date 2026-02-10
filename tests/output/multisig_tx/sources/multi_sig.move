module 0x1::multi_sig {

    use std::signer;
    use aptos_std::table;
    use aptos_framework::account;
    use aptos_framework::event;
    use std::vector;
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
    const E_NOT_OWNER: u64 = 256u64;
    const E_TX_DOES_NOT_EXIST: u64 = 257u64;
    const E_TX_ALREADY_EXECUTED: u64 = 258u64;
    const E_TX_ALREADY_CONFIRMED: u64 = 259u64;
    const E_TX_NOT_CONFIRMED: u64 = 260u64;
    const E_NOT_ENOUGH_CONFIRMATIONS: u64 = 261u64;
    const E_TX_EXECUTION_FAILED: u64 = 262u64;
    const E_INVALID_OWNER: u64 = 263u64;
    const E_OWNER_ALREADY_EXISTS: u64 = 264u64;
    const E_INVALID_REQUIREMENT: u64 = 265u64;
    const E_ONLY_VIA_MULTISIG: u64 = 266u64;

    struct MultiSigState has key {
        owners: vector<address>,
        is_owner: aptos_std::table::Table<address, bool>,
        num_confirmations_required: u256,
        transactions: vector<Transaction>,
        is_confirmed: aptos_std::table::Table<u256, aptos_std::table::Table<address, bool>>,
        nonce: u256,
        signer_cap: account::SignerCapability
    }

    struct Transaction has copy, drop, store {
        to: address,
        value: u256,
        data: vector<u8>,
        executed: bool,
        num_confirmations: u256
    }

    #[event]
    struct Deposit has drop, store {
        sender: address,
        amount: u256,
        balance: u256
    }

    #[event]
    struct SubmitTransaction has drop, store {
        owner: address,
        tx_index: u256,
        to: address,
        value: u256,
        data: vector<u8>
    }

    #[event]
    struct ConfirmTransaction has drop, store {
        owner: address,
        tx_index: u256
    }

    #[event]
    struct RevokeConfirmation has drop, store {
        owner: address,
        tx_index: u256
    }

    #[event]
    struct ExecuteTransaction has drop, store {
        owner: address,
        tx_index: u256
    }

    #[event]
    struct OwnerAdded has drop, store {
        owner: address
    }

    #[event]
    struct OwnerRemoved has drop, store {
        owner: address
    }

    #[event]
    struct RequirementChanged has drop, store {
        required: u256
    }

    public entry fun initialize(deployer: &signer, owners: vector<address>, num_confirmations_required: u256) {
        let (resource_signer, signer_cap) = account::create_resource_account(deployer, b"multi_sig");
        assert!((vector::length(&owners) > 0u256), E_OWNERS_REQUIRED);
        assert!(((num_confirmations_required > 0u256) && (num_confirmations_required <= vector::length(&owners))), E_INVALID_NUMBER_OF_REQUIRED_CON);
        let i: u256 = 0u256;
        while ((i < vector::length(&owners))) {
            let owner: address = *vector::borrow(&owners, (i as u64));
            assert!((owner != @0x0), E_INVALID_OWNER);
            assert!(!*table::borrow_with_default(&state.is_owner, owner, &false), E_OWNER_NOT_UNIQUE);
            *table::borrow_mut_with_default(&mut state.is_owner, owner, false) = true;
            vector::push_back(&mut state.owners, owner);
            i = (i + 1);
        }
        move_to(&resource_signer, MultiSigState { owners: vector::empty(), is_owner: table::new(), num_confirmations_required: num_confirmations_required, transactions: vector::empty(), is_confirmed: table::new(), nonce: 0, signer_cap: signer_cap });
    }

    public entry fun receive(account: &signer) {
        string::utf8(b"UNSUPPORTED: receive() has no Move equivalent");
    }

    public fun submit_transaction(account: &signer, to: address, value: u256, data: vector<u8>): u256 acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        let tx_index = 0u256;
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        tx_index = vector::length(&state.transactions);
        vector::push_back(&mut state.transactions, Transaction { to: to, value: value, data: data, executed: false, num_confirmations: 0u256 });
        event::emit(SubmitTransaction { owner: signer::address_of(account), tx_index: tx_index, to: to, value: value, data: data });
        confirm_transaction(tx_index);
        tx_index
    }

    public entry fun confirm_transaction(account: &signer, tx_index: u256) acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        assert!((tx_index < vector::length(&state.transactions)), E_NOT_FOUND);
        assert!(!*vector::borrow(&state.transactions, (tx_index as u64)).executed, E_TX_ALREADY_EXECUTED);
        assert!(!*table::borrow(&*table::borrow_with_default(&state.is_confirmed, tx_index, &0u256), signer::address_of(account)), E_TX_ALREADY_CONFIRMED);
        let transaction: Transaction = *vector::borrow(&state.transactions, (tx_index as u64));
        transaction.num_confirmations += 1u256;
        *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.is_confirmed, tx_index, 0u256), signer::address_of(account)) = true;
        event::emit(ConfirmTransaction { owner: signer::address_of(account), tx_index: tx_index });
        if ((transaction.num_confirmations >= state.num_confirmations_required)) {
            execute_transaction(tx_index);
        };
    }

    public entry fun execute_transaction(account: &signer, tx_index: u256) acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        assert!((tx_index < vector::length(&state.transactions)), E_NOT_FOUND);
        assert!(!*vector::borrow(&state.transactions, (tx_index as u64)).executed, E_TX_ALREADY_EXECUTED);
        let transaction: Transaction = *vector::borrow(&state.transactions, (tx_index as u64));
        assert!((transaction.num_confirmations >= state.num_confirmations_required), E_INSUFFICIENT_BALANCE);
        transaction.executed = true;
        let (success, 1) = unknown(transaction.data);
        assert!(success, E_TX_EXECUTION_FAILED);
        event::emit(ExecuteTransaction { owner: signer::address_of(account), tx_index: tx_index });
    }

    public entry fun revoke_confirmation(account: &signer, tx_index: u256) acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        assert!((signer::address_of(account) == state.owner), E_UNAUTHORIZED);
        assert!((tx_index < vector::length(&state.transactions)), E_NOT_FOUND);
        assert!(!*vector::borrow(&state.transactions, (tx_index as u64)).executed, E_TX_ALREADY_EXECUTED);
        assert!(*table::borrow(&*table::borrow_with_default(&state.is_confirmed, tx_index, &0u256), signer::address_of(account)), E_TX_NOT_CONFIRMED);
        let transaction: Transaction = *vector::borrow(&state.transactions, (tx_index as u64));
        transaction.num_confirmations -= 1u256;
        *table::borrow_mut(&mut *table::borrow_mut_with_default(&mut state.is_confirmed, tx_index, 0u256), signer::address_of(account)) = false;
        event::emit(RevokeConfirmation { owner: signer::address_of(account), tx_index: tx_index });
    }

    public entry fun add_owner(account: &signer, owner: address) acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        assert!((signer::address_of(account) == @0x1), E_ONLY_VIA_MULTISIG);
        assert!((owner != @0x0), E_INVALID_OWNER);
        assert!(!*table::borrow_with_default(&state.is_owner, owner, &false), E_ALREADY_EXISTS);
        *table::borrow_mut_with_default(&mut state.is_owner, owner, false) = true;
        vector::push_back(&mut state.owners, owner);
        event::emit(OwnerAdded { owner: owner });
    }

    public entry fun remove_owner(account: &signer, owner: address) acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        assert!((signer::address_of(account) == @0x1), E_ONLY_VIA_MULTISIG);
        assert!(*table::borrow_with_default(&state.is_owner, owner, &false), E_UNAUTHORIZED);
        assert!(((vector::length(&state.owners) - 1u256) >= state.num_confirmations_required), E_UNAUTHORIZED);
        *table::borrow_mut_with_default(&mut state.is_owner, owner, false) = false;
        let i: u256 = 0u256;
        while ((i < vector::length(&state.owners))) {
            if ((*vector::borrow(&state.owners, (i as u64)) == owner)) {
                *vector::borrow_mut(&mut state.owners, (i as u64)) = *vector::borrow(&state.owners, ((vector::length(&state.owners) - 1u256) as u64));
                vector::pop_back(&mut state.owners);
                break;
            };
            i = (i + 1);
        }
        event::emit(OwnerRemoved { owner: owner });
    }

    public entry fun change_requirement(account: &signer, required: u256) acquires MultiSigState {
        let state = borrow_global_mut<MultiSigState>(@0x1);
        assert!((signer::address_of(account) == @0x1), E_ONLY_VIA_MULTISIG);
        assert!(((required > 0u256) && (required <= vector::length(&state.owners))), E_INVALID_REQUIREMENT);
        state.num_confirmations_required = required;
        event::emit(RequirementChanged { required: required });
    }

    #[view]
    public fun get_owners(): vector<address> acquires MultiSigState {
        let state = borrow_global<MultiSigState>(@0x1);
        state.owners
    }

    #[view]
    public fun get_transaction_count(): u256 {
        vector::length(&state.transactions)
    }

    #[view]
    public fun get_transaction(tx_index: u256): (address, u256, vector<u8>, bool, u256) {
        let to = @0x0;
        let value = 0u256;
        let data = vector::empty();
        let executed = false;
        let num_confirmations = 0u256;
        let transaction: Transaction = *vector::borrow(&state.transactions, (tx_index as u64));
        (transaction.to, transaction.value, transaction.data, transaction.executed, transaction.num_confirmations)
    }

    #[view]
    public fun get_pending_transactions(): vector<u256> {
        let pending_count: u256 = 0u256;
        let i: u256 = 0u256;
        while ((i < vector::length(&state.transactions))) {
            if (!*vector::borrow(&state.transactions, (i as u64)).executed) {
                pending_count = (pending_count + 1);
            };
            i = (i + 1);
        }
        let pending: vector<u256> = unknown(pending_count);
        let index: u256 = 0u256;
        let i: u256 = 0u256;
        while ((i < vector::length(&state.transactions))) {
            if (!*vector::borrow(&state.transactions, (i as u64)).executed) {
                *vector::borrow_mut(&mut pending, (index as u64)) = i;
                index = (index + 1);
            };
            i = (i + 1);
        }
        pending
    }

    #[view]
    public fun is_transaction_confirmed_by(tx_index: u256, owner: address): bool {
        *table::borrow(&*table::borrow_with_default(&state.is_confirmed, tx_index, &0u256), owner)
    }

    #[view]
    public fun get_confirmations(tx_index: u256): vector<address> {
        let count: u256 = 0u256;
        let i: u256 = 0u256;
        while ((i < vector::length(&state.owners))) {
            if (*table::borrow(&*table::borrow_with_default(&state.is_confirmed, tx_index, &0u256), *vector::borrow(&state.owners, (i as u64)))) {
                count = (count + 1);
            };
            i = (i + 1);
        }
        let confirmations: vector<address> = unknown(count);
        let index: u256 = 0u256;
        let i: u256 = 0u256;
        while ((i < vector::length(&state.owners))) {
            if (*table::borrow(&*table::borrow_with_default(&state.is_confirmed, tx_index, &0u256), *vector::borrow(&state.owners, (i as u64)))) {
                *vector::borrow_mut(&mut confirmations, (index as u64)) = *vector::borrow(&state.owners, (i as u64));
                index = (index + 1);
            };
            i = (i + 1);
        }
        confirmations
    }

    #[view]
    public fun encode_add_owner(owner: address): vector<u8> {
        abi.encode_with_signature(string::utf8(b"addOwner(address)"), owner)
    }

    #[view]
    public fun encode_remove_owner(owner: address): vector<u8> {
        abi.encode_with_signature(string::utf8(b"removeOwner(address)"), owner)
    }

    #[view]
    public fun encode_change_requirement(required: u256): vector<u8> {
        abi.encode_with_signature(string::utf8(b"changeRequirement(uint256)"), required)
    }
}