/// GhostPay Stealth Address Module
///
/// Implements stealth address registration and discovery for enhanced privacy.
/// Users publish a "stealth meta-address" (a public key). Senders derive a
/// one-time stealth address for each payment, so the recipient's real address
/// never appears in the payment graph.
///
/// Flow:
///   1. Recipient registers their stealth meta-address (public key)
///   2. Sender generates an ephemeral keypair, derives the stealth address
///   3. Sender deposits to the stealth address inside the pool
///   4. Recipient scans announcements, derives the same stealth address,
///      and claims the funds
module ghostpay::stealth {
    use std::signer;
    use std::vector;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_std::smart_table::{Self, SmartTable};

    // ═══════════════════════════════════════════════════════
    //  Error codes
    // ═══════════════════════════════════════════════════════

    const E_ALREADY_REGISTERED: u64 = 100;
    const E_NOT_REGISTERED: u64 = 101;
    const E_INVALID_KEY_LENGTH: u64 = 102;
    const E_REGISTRY_NOT_INITIALIZED: u64 = 103;
    const E_REGISTRY_ALREADY_INITIALIZED: u64 = 104;

    // ═══════════════════════════════════════════════════════
    //  Constants
    // ═══════════════════════════════════════════════════════

    const PUBKEY_LENGTH: u64 = 32;

    // ═══════════════════════════════════════════════════════
    //  Resources
    // ═══════════════════════════════════════════════════════

    /// Global registry mapping addresses to stealth meta-addresses.
    struct StealthRegistry has key {
        registry: SmartTable<address, vector<u8>>, // address -> stealth public key
        total_registered: u64,
    }

    /// Per-user stealth meta-address stored at their account.
    struct StealthMetaAddress has key {
        spending_pubkey: vector<u8>,  // 32-byte compressed public key
        viewing_pubkey: vector<u8>,   // 32-byte compressed public key
    }

    /// Announcement log — senders publish ephemeral pubkeys here so
    /// recipients can scan and identify payments to them.
    struct AnnouncementLog has key {
        announcements: vector<Announcement>,
    }

    struct Announcement has store, drop, copy {
        ephemeral_pubkey: vector<u8>,  // Sender's one-time public key
        stealth_address: address,       // Derived stealth address
        metadata: vector<u8>,          // Optional encrypted memo
        timestamp: u64,
    }

    // ═══════════════════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════════════════

    #[event]
    struct StealthRegistered has drop, store {
        user: address,
        spending_pubkey: vector<u8>,
        timestamp: u64,
    }

    #[event]
    struct StealthAnnouncement has drop, store {
        ephemeral_pubkey: vector<u8>,
        stealth_address: address,
        metadata: vector<u8>,
        timestamp: u64,
    }

    // ═══════════════════════════════════════════════════════
    //  Initialization
    // ═══════════════════════════════════════════════════════

    /// Initialize the stealth registry. Called once by deployer.
    public entry fun initialize_registry(deployer: &signer) {
        let deployer_addr = signer::address_of(deployer);
        assert!(!exists<StealthRegistry>(deployer_addr), E_REGISTRY_ALREADY_INITIALIZED);

        move_to(deployer, StealthRegistry {
            registry: smart_table::new(),
            total_registered: 0,
        });

        move_to(deployer, AnnouncementLog {
            announcements: vector::empty(),
        });
    }

    // ═══════════════════════════════════════════════════════
    //  Registration
    // ═══════════════════════════════════════════════════════

    /// Register a stealth meta-address. This publishes your spending and
    /// viewing public keys so senders can derive stealth addresses for you.
    public entry fun register(
        account: &signer,
        registry_addr: address,
        spending_pubkey: vector<u8>,
        viewing_pubkey: vector<u8>,
    ) acquires StealthRegistry {
        let user_addr = signer::address_of(account);
        assert!(exists<StealthRegistry>(registry_addr), E_REGISTRY_NOT_INITIALIZED);
        assert!(!exists<StealthMetaAddress>(user_addr), E_ALREADY_REGISTERED);
        assert!(vector::length(&spending_pubkey) == PUBKEY_LENGTH, E_INVALID_KEY_LENGTH);
        assert!(vector::length(&viewing_pubkey) == PUBKEY_LENGTH, E_INVALID_KEY_LENGTH);

        // Store at user's address
        move_to(account, StealthMetaAddress {
            spending_pubkey: spending_pubkey,
            viewing_pubkey: viewing_pubkey,
        });

        // Register in global registry
        let registry = borrow_global_mut<StealthRegistry>(registry_addr);
        smart_table::add(&mut registry.registry, user_addr, spending_pubkey);
        registry.total_registered = registry.total_registered + 1;

        event::emit(StealthRegistered {
            user: user_addr,
            spending_pubkey,
            timestamp: timestamp::now_seconds(),
        });
    }

    /// Publish a stealth payment announcement. The sender calls this after
    /// depositing to a derived stealth address inside the pool.
    public entry fun announce(
        _sender: &signer,
        registry_addr: address,
        ephemeral_pubkey: vector<u8>,
        stealth_address: address,
        metadata: vector<u8>,
    ) acquires AnnouncementLog {
        assert!(exists<AnnouncementLog>(registry_addr), E_REGISTRY_NOT_INITIALIZED);
        assert!(vector::length(&ephemeral_pubkey) == PUBKEY_LENGTH, E_INVALID_KEY_LENGTH);

        let log = borrow_global_mut<AnnouncementLog>(registry_addr);
        vector::push_back(&mut log.announcements, Announcement {
            ephemeral_pubkey,
            stealth_address,
            metadata,
            timestamp: timestamp::now_seconds(),
        });

        event::emit(StealthAnnouncement {
            ephemeral_pubkey,
            stealth_address,
            metadata,
            timestamp: timestamp::now_seconds(),
        });
    }

    // ═══════════════════════════════════════════════════════
    //  View functions
    // ═══════════════════════════════════════════════════════

    #[view]
    /// Look up a user's stealth meta-address.
    public fun get_meta_address(user: address): (vector<u8>, vector<u8>) acquires StealthMetaAddress {
        assert!(exists<StealthMetaAddress>(user), E_NOT_REGISTERED);
        let meta = borrow_global<StealthMetaAddress>(user);
        (meta.spending_pubkey, meta.viewing_pubkey)
    }

    #[view]
    /// Get total number of registered stealth addresses.
    public fun get_registry_count(registry_addr: address): u64 acquires StealthRegistry {
        assert!(exists<StealthRegistry>(registry_addr), E_REGISTRY_NOT_INITIALIZED);
        borrow_global<StealthRegistry>(registry_addr).total_registered
    }

    #[view]
    /// Check if a user is registered.
    public fun is_registered(user: address): bool {
        exists<StealthMetaAddress>(user)
    }

    #[view]
    /// Get the number of announcements.
    public fun get_announcement_count(registry_addr: address): u64 acquires AnnouncementLog {
        assert!(exists<AnnouncementLog>(registry_addr), E_REGISTRY_NOT_INITIALIZED);
        vector::length(&borrow_global<AnnouncementLog>(registry_addr).announcements)
    }
}
