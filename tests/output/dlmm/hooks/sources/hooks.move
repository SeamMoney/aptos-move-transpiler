module 0x1::hooks {

    use transpiler::evm_compat;
    use aptos_std::bcs;
    use std::vector;

    // Error codes
    const BEFORE_SWAP_FLAG: u256 = 1461501637330902918203684832716283019655932542976u256;
    const AFTER_SWAP_FLAG: u256 = 2923003274661805836407369665432566039311865085952u256;
    const BEFORE_FLASH_LOAN_FLAG: u256 = 5846006549323611672814739330865132078623730171904u256;
    const AFTER_FLASH_LOAN_FLAG: u256 = 11692013098647223345629478661730264157247460343808u256;
    const BEFORE_MINT_FLAG: u256 = 23384026197294446691258957323460528314494920687616u256;
    const AFTER_MINT_FLAG: u256 = 46768052394588893382517914646921056628989841375232u256;
    const BEFORE_BURN_FLAG: u256 = 93536104789177786765035829293842113257979682750464u256;
    const AFTER_BURN_FLAG: u256 = 187072209578355573530071658587684226515959365500928u256;
    const BEFORE_TRANSFER_FLAG: u256 = 374144419156711147060143317175368453031918731001856u256;
    const AFTER_TRANSFER_FLAG: u256 = 748288838313422294120286634350736906063837462003712u256;
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
    const E_HOOKS_CALL_FAILED: u64 = 256u64;

    struct Parameters has copy, drop, store {
        hooks: address,
        before_swap: bool,
        after_swap: bool,
        before_flash_loan: bool,
        after_flash_loan: bool,
        before_mint: bool,
        after_mint: bool,
        before_burn: bool,
        after_burn: bool,
        before_batch_transfer_from: bool,
        after_batch_transfer_from: bool
    }

    public(package) fun encode(parameters: Parameters): u256 {
        let hooks_parameters = 0u256;
        hooks_parameters = ((evm_compat::to_address(parameters.hooks) & 1461501637330902918203684832716283019655932542975) as u256);
        if (parameters.before_swap) {
            hooks_parameters |= BEFORE_SWAP_FLAG;
        };
        if (parameters.after_swap) {
            hooks_parameters |= AFTER_SWAP_FLAG;
        };
        if (parameters.before_flash_loan) {
            hooks_parameters |= BEFORE_FLASH_LOAN_FLAG;
        };
        if (parameters.after_flash_loan) {
            hooks_parameters |= AFTER_FLASH_LOAN_FLAG;
        };
        if (parameters.before_mint) {
            hooks_parameters |= BEFORE_MINT_FLAG;
        };
        if (parameters.after_mint) {
            hooks_parameters |= AFTER_MINT_FLAG;
        };
        if (parameters.before_burn) {
            hooks_parameters |= BEFORE_BURN_FLAG;
        };
        if (parameters.after_burn) {
            hooks_parameters |= AFTER_BURN_FLAG;
        };
        if (parameters.before_batch_transfer_from) {
            hooks_parameters |= BEFORE_TRANSFER_FLAG;
        };
        if (parameters.after_batch_transfer_from) {
            hooks_parameters |= AFTER_TRANSFER_FLAG;
        };
        return hooks_parameters
    }

    public(package) fun decode(hooks_parameters: u256): Parameters {
        let parameters = 0u256;
        parameters.hooks = get_hooks(hooks_parameters);
        parameters.before_swap = (((hooks_parameters & BEFORE_SWAP_FLAG)) != 0);
        parameters.after_swap = (((hooks_parameters & AFTER_SWAP_FLAG)) != 0);
        parameters.before_flash_loan = (((hooks_parameters & BEFORE_FLASH_LOAN_FLAG)) != 0);
        parameters.after_flash_loan = (((hooks_parameters & AFTER_FLASH_LOAN_FLAG)) != 0);
        parameters.before_mint = (((hooks_parameters & BEFORE_MINT_FLAG)) != 0);
        parameters.after_mint = (((hooks_parameters & AFTER_MINT_FLAG)) != 0);
        parameters.before_burn = (((hooks_parameters & BEFORE_BURN_FLAG)) != 0);
        parameters.after_burn = (((hooks_parameters & AFTER_BURN_FLAG)) != 0);
        parameters.before_batch_transfer_from = (((hooks_parameters & BEFORE_TRANSFER_FLAG)) != 0);
        parameters.after_batch_transfer_from = (((hooks_parameters & AFTER_TRANSFER_FLAG)) != 0);
        return parameters
    }

    public(package) fun get_hooks(hooks_parameters: u256): address {
        let hooks = @0x0;
        hooks = (evm_compat::to_address(((hooks_parameters as u256) & 1461501637330902918203684832716283019655932542975)) as address);
        return hooks
    }

    public(package) fun set_hooks(hooks_parameters: u256, new_hooks: address): u256 {
        return (((hooks_parameters as u128) as u256) | ((new_hooks & 1461501637330902918203684832716283019655932542975) as u256))
    }

    public(package) fun get_flags(hooks_parameters: u256): u128 {
        let flags = 0u128;
        flags = (hooks_parameters as u128);
        return flags
    }

    public(package) fun on_hooks_set(hooks_parameters: u256, on_hooks_set_data: vector<u8>) {
        if ((hooks_parameters != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun before_swap(hooks_parameters: u256, sender: address, to: address, swap_for_y: bool, amounts_in: u256, state: &HooksState) {
        if ((((hooks_parameters & BEFORE_SWAP_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun after_swap(hooks_parameters: u256, sender: address, to: address, swap_for_y: bool, amounts_out: u256, state: &HooksState) {
        if ((((hooks_parameters & AFTER_SWAP_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun before_flash_loan(hooks_parameters: u256, sender: address, to: address, amounts: u256, state: &HooksState) {
        if ((((hooks_parameters & BEFORE_FLASH_LOAN_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun after_flash_loan(hooks_parameters: u256, sender: address, to: address, fees: u256, fees_received: u256, state: &HooksState) {
        if ((((hooks_parameters & AFTER_FLASH_LOAN_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun before_mint(hooks_parameters: u256, sender: address, to: address, liquidity_configs: vector<u256>, amounts_received: u256, state: &HooksState) {
        if ((((hooks_parameters & BEFORE_MINT_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun after_mint(hooks_parameters: u256, sender: address, to: address, liquidity_configs: vector<u256>, amounts_in: u256, state: &HooksState) {
        if ((((hooks_parameters & AFTER_MINT_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun before_burn(hooks_parameters: u256, sender: address, from: address, to: address, ids: vector<u256>, amounts_to_burn: vector<u256>, state: &HooksState) {
        if ((((hooks_parameters & BEFORE_BURN_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun after_burn(hooks_parameters: u256, sender: address, from: address, to: address, ids: vector<u256>, amounts_to_burn: vector<u256>, state: &HooksState) {
        if ((((hooks_parameters & AFTER_BURN_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun before_batch_transfer_from(hooks_parameters: u256, sender: address, from: address, to: address, ids: vector<u256>, amounts: vector<u256>, state: &HooksState) {
        if ((((hooks_parameters & BEFORE_TRANSFER_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    public(package) fun after_batch_transfer_from(hooks_parameters: u256, sender: address, from: address, to: address, ids: vector<u256>, amounts: vector<u256>, state: &HooksState) {
        if ((((hooks_parameters & AFTER_TRANSFER_FLAG)) != 0)) {
            safe_call(hooks_parameters, vector::empty<u8>());
        };
    }

    fun safe_call(hooks_parameters: u256, data: vector<u8>) {
        let success: bool;
        let hooks: address = get_hooks(hooks_parameters);
        let expected_selector = ((data + 0x20u256) >> (224 as u8));
        success = true;
        if (((if (!success) 1 else 0 & if (!(0 == 0)) 1 else 0) != 0)) {
            0;
            abort E_REQUIRE_FAILED
        };
        success = (success & (if ((0 > 0x1fu256)) 1 else 0 & if (((0 >> (224 as u8)) == expected_selector)) 1 else 0));
        if (!success) {
            abort E_HOOKS_CALL_FAILED
        };
    }
}