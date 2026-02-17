module 0x1::test_token {
    use std::string::{Self, String};
    use std::signer;
    use std::option;
    use aptos_framework::object::{Self, Object, ExtendRef};
    use aptos_framework::fungible_asset::{Self, MintRef, BurnRef, TransferRef, FungibleAsset, Metadata};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::event;

    // Error codes
    const E_NOT_OWNER: u64 = 1;
    const E_INSUFFICIENT_BALANCE: u64 = 2;
    const E_FROZEN: u64 = 3;

    /// The token metadata object seed
    const ASSET_SYMBOL: vector<u8> = b"TST";

    /// Stores the refs for managing the fungible asset
    struct ManagedFungibleAsset has key {
        mint_ref: MintRef,
        burn_ref: BurnRef,
        transfer_ref: TransferRef,
        extend_ref: ExtendRef,
    }

    #[event]
    struct Transfer has drop, store {
        from: address,
        to: address,
        amount: u64,
    }

    /// Initialize the fungible asset
    fun init_module(admin: &signer) {
        let constructor_ref = &object::create_named_object(admin, ASSET_SYMBOL);

        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            constructor_ref,
            option::none(), // max_supply (none = unlimited)
            string::utf8(b"Test"),
            string::utf8(ASSET_SYMBOL),
            18,
            string::utf8(b""),
            string::utf8(b""),
        );

        let mint_ref = fungible_asset::generate_mint_ref(constructor_ref);
        let burn_ref = fungible_asset::generate_burn_ref(constructor_ref);
        let transfer_ref = fungible_asset::generate_transfer_ref(constructor_ref);
        let extend_ref = object::generate_extend_ref(constructor_ref);

        let metadata_signer = &object::generate_signer(constructor_ref);
        move_to(metadata_signer, ManagedFungibleAsset {
            mint_ref,
            burn_ref,
            transfer_ref,
            extend_ref,
        });
    }

    /// Get the metadata object address
    #[view]
    public fun metadata_address(): address {
        object::create_object_address(&@0x1, ASSET_SYMBOL)
    }

    /// Get the metadata object
    #[view]
    public fun metadata(): Object<Metadata> {
        object::address_to_object(metadata_address())
    }

    /// Get the balance of an account
    #[view]
    public fun balance_of(owner: address): u64 {
        primary_fungible_store::balance(owner, metadata())
    }

    /// Get the total supply
    #[view]
    public fun total_supply(): u128 {
        let supply = fungible_asset::supply(metadata());
        option::get_with_default(&supply, 0)
    }

    /// Get the name
    #[view]
    public fun name(): String {
        fungible_asset::name(metadata())
    }

    /// Get the symbol
    #[view]
    public fun symbol(): String {
        fungible_asset::symbol(metadata())
    }

    /// Get the decimals
    #[view]
    public fun decimals(): u8 {
        fungible_asset::decimals(metadata())
    }

    /// Transfer tokens from sender to recipient
    public entry fun transfer(
        sender: &signer,
        recipient: address,
        amount: u64,
    ) {
        let sender_addr = signer::address_of(sender);
        primary_fungible_store::transfer(sender, metadata(), recipient, amount);
        event::emit(Transfer { from: sender_addr, to: recipient, amount });
    }



}
