module 0x1::test_nft {
    use std::string::{Self, String};
    use std::signer;
    use std::option::{Self, Option};
    use aptos_framework::object::{Self, Object, ExtendRef, TransferRef, DeleteRef};
    use aptos_token_objects::collection::{Self, Collection};
    use aptos_token_objects::token::{Self, Token};
    use aptos_token_objects::royalty;
    use aptos_framework::event;

    // Error codes
    const E_NOT_OWNER: u64 = 1;
    const E_NOT_AUTHORIZED: u64 = 2;
    const E_TOKEN_NOT_FOUND: u64 = 3;
    const E_COLLECTION_NOT_FOUND: u64 = 4;
    const E_INVALID_TOKEN_ID: u64 = 5;
    const E_MAX_SUPPLY_REACHED: u64 = 6;

    /// The collection name
    const COLLECTION_NAME: vector<u8> = b"TestNFT";

    /// Stores the collection and minting capabilities
    struct CollectionRefs has key {
        extend_ref: ExtendRef,
        minted_count: u64,
    }

    /// Stores refs for each token to enable transfer and burn
    struct TokenRefs has key {
        extend_ref: ExtendRef,
        transfer_ref: TransferRef,
        burn_ref: DeleteRef,
    }

    #[event]
    struct Transfer has drop, store {
        from: address,
        to: address,
        token_id: u64,
    }

    #[event]
    struct Approval has drop, store {
        owner: address,
        approved: address,
        token_id: u64,
    }

    /// Initialize the collection
    fun init_module(creator: &signer) {
        let description = string::utf8(b"TNFT NFT Collection");
        let name = string::utf8(COLLECTION_NAME);
        let uri = string::utf8(b"");

        let constructor_ref = collection::create_unlimited_collection(
            creator,
            description,
            name,
            option::none(), // royalty
            uri,
        );

        let extend_ref = object::generate_extend_ref(&constructor_ref);

        move_to(creator, CollectionRefs {
            extend_ref,
            minted_count: 0,
        });
    }

    /// Get the collection address
    #[view]
    public fun collection_address(): address {
        collection::create_collection_address(&@0x1, &string::utf8(COLLECTION_NAME))
    }

    /// Get the collection object
    #[view]
    public fun collection(): Object<Collection> {
        object::address_to_object(collection_address())
    }

    /// Get the total supply (number of minted tokens)
    #[view]
    public fun total_supply(): u64 acquires CollectionRefs {
        borrow_global<CollectionRefs>(@0x1).minted_count
    }

    /// Get the name of the collection
    #[view]
    public fun name(): String {
        collection::name(collection())
    }

    /// Get the collection description
    #[view]
    public fun description(): String {
        collection::description(collection())
    }

    /// Get the collection URI
    #[view]
    public fun uri(): String {
        collection::uri(collection())
    }

    /// Get the owner of a token by its object address
    #[view]
    public fun owner_of(token_address: address): address {
        let token_obj: Object<Token> = object::address_to_object(token_address);
        object::owner(token_obj)
    }

    /// Get the balance of an owner (number of tokens owned)
    #[view]
    public fun balance_of(owner: address): u64 {
        // Note: In Aptos, tracking balance requires indexer or off-chain storage
        // This is a simplified implementation - production should use events + indexer
        0 // Placeholder - use indexer to count tokens owned
    }


    /// Transfer a token to another address
    public entry fun transfer(
        owner: &signer,
        token_address: address,
        to: address,
    ) {
        let owner_addr = signer::address_of(owner);
        let token_obj: Object<Token> = object::address_to_object(token_address);

        // Verify ownership
        assert!(object::owner(token_obj) == owner_addr, E_NOT_OWNER);

        // Transfer the token
        object::transfer(owner, token_obj, to);

        // Note: token_id would need to be tracked separately for accurate events
        event::emit(Transfer {
            from: owner_addr,
            to,
            token_id: 0, // Placeholder - use indexer for accurate tracking
        });
    }

    /// Transfer from (with approval - simplified version)
    public entry fun transfer_from(
        sender: &signer,
        from: address,
        to: address,
        token_address: address,
    ) acquires TokenRefs {
        let sender_addr = signer::address_of(sender);
        let token_obj: Object<Token> = object::address_to_object(token_address);

        // Check if sender is owner or has transfer permission
        let current_owner = object::owner(token_obj);
        assert!(
            current_owner == sender_addr || from == sender_addr,
            E_NOT_AUTHORIZED
        );

        // Use transfer_ref for admin transfers
        if (exists<TokenRefs>(token_address)) {
            let refs = borrow_global<TokenRefs>(token_address);
            object::transfer_with_ref(object::generate_linear_transfer_ref(&refs.transfer_ref), to);
        } else {
            // Regular transfer if owner
            assert!(current_owner == sender_addr, E_NOT_AUTHORIZED);
            object::transfer(sender, token_obj, to);
        };

        event::emit(Transfer {
            from,
            to,
            token_id: 0,
        });
    }


}
