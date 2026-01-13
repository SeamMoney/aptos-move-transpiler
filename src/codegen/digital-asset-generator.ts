/**
 * Digital Asset Generator
 * Generates Move code using the Aptos Digital Asset standard (aptos_token_objects)
 * This is the recommended approach for ERC-721 style NFTs on Aptos
 */

export interface DigitalAssetConfig {
  moduleName: string;
  moduleAddress: string;
  collectionName: string;
  collectionDescription: string;
  collectionUri: string;
  maxSupply?: number; // undefined = unlimited
  hasTransfer: boolean;
  hasMint: boolean;
  hasBurn: boolean;
  hasApproval: boolean;
  royaltyNumerator?: number;
  royaltyDenominator?: number;
}

/**
 * Generate a Digital Asset module from ERC-721 contract info
 */
export function generateDigitalAssetModule(config: DigitalAssetConfig): string {
  const {
    moduleName,
    moduleAddress,
    collectionName,
    collectionDescription = '',
    collectionUri = '',
    maxSupply,
    hasTransfer,
    hasMint,
    hasBurn,
  } = config;

  const isUnlimited = maxSupply === undefined;

  return `module ${moduleAddress}::${moduleName} {
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
    const COLLECTION_NAME: vector<u8> = b"${collectionName}";

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
        let description = string::utf8(b"${collectionDescription}");
        let name = string::utf8(COLLECTION_NAME);
        let uri = string::utf8(b"${collectionUri}");

        let constructor_ref = ${isUnlimited
    ? `collection::create_unlimited_collection(
            creator,
            description,
            name,
            option::none(), // royalty
            uri,
        )`
    : `collection::create_fixed_collection(
            creator,
            description,
            ${maxSupply},
            name,
            option::none(), // royalty
            uri,
        )`};

        let extend_ref = object::generate_extend_ref(&constructor_ref);

        move_to(creator, CollectionRefs {
            extend_ref,
            minted_count: 0,
        });
    }

    /// Get the collection address
    #[view]
    public fun collection_address(): address {
        collection::create_collection_address(&@${moduleAddress}, &string::utf8(COLLECTION_NAME))
    }

    /// Get the collection object
    #[view]
    public fun collection(): Object<Collection> {
        object::address_to_object(collection_address())
    }

    /// Get the total supply (number of minted tokens)
    #[view]
    public fun total_supply(): u64 acquires CollectionRefs {
        borrow_global<CollectionRefs>(@${moduleAddress}).minted_count
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
${hasMint ? generateMintFunction(moduleAddress, collectionName, maxSupply) : ''}
${hasTransfer ? generateTransferFunction(moduleAddress) : ''}
${hasBurn ? generateBurnFunction(moduleAddress) : ''}
}
`;
}

function generateMintFunction(moduleAddress: string, collectionName: string, maxSupply?: number): string {
  const supplyCheck = maxSupply !== undefined
    ? `
        // Check max supply
        assert!(refs.minted_count < ${maxSupply}, E_MAX_SUPPLY_REACHED);`
    : '';

  return `
    /// Mint a new token
    public entry fun mint(
        creator: &signer,
        to: address,
        token_name: String,
        token_description: String,
        token_uri: String,
    ) acquires CollectionRefs {
        let creator_addr = signer::address_of(creator);
        assert!(creator_addr == @${moduleAddress}, E_NOT_OWNER);

        let refs = borrow_global_mut<CollectionRefs>(@${moduleAddress});${supplyCheck}

        let token_id = refs.minted_count + 1;
        refs.minted_count = token_id;

        let constructor_ref = token::create_named_token(
            creator,
            string::utf8(b"${collectionName}"),
            token_description,
            token_name,
            option::none(), // royalty
            token_uri,
        );

        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let transfer_ref = object::generate_transfer_ref(&constructor_ref);
        let burn_ref = object::generate_delete_ref(&constructor_ref);

        // Store refs at the token's address
        let token_signer = &object::generate_signer(&constructor_ref);
        move_to(token_signer, TokenRefs {
            extend_ref,
            transfer_ref,
            burn_ref,
        });

        // Transfer to recipient if not creator
        if (to != creator_addr) {
            let token_obj = object::object_from_constructor_ref<Token>(&constructor_ref);
            object::transfer(creator, token_obj, to);
        };

        event::emit(Transfer {
            from: @0x0,
            to,
            token_id,
        });
    }

    /// Mint with specific token ID (for compatibility with ERC-721 patterns)
    public entry fun mint_to(
        creator: &signer,
        to: address,
        token_id: u64,
        token_uri: String,
    ) acquires CollectionRefs {
        let creator_addr = signer::address_of(creator);
        assert!(creator_addr == @${moduleAddress}, E_NOT_OWNER);

        let refs = borrow_global_mut<CollectionRefs>(@${moduleAddress});${supplyCheck}
        refs.minted_count = refs.minted_count + 1;

        let token_name = string::utf8(b"Token #");
        // Note: In production, append token_id to name using string utils

        let constructor_ref = token::create_named_token(
            creator,
            string::utf8(b"${collectionName}"),
            string::utf8(b""),
            token_name,
            option::none(),
            token_uri,
        );

        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let transfer_ref = object::generate_transfer_ref(&constructor_ref);
        let burn_ref = object::generate_delete_ref(&constructor_ref);

        let token_signer = &object::generate_signer(&constructor_ref);
        move_to(token_signer, TokenRefs {
            extend_ref,
            transfer_ref,
            burn_ref,
        });

        if (to != creator_addr) {
            let token_obj = object::object_from_constructor_ref<Token>(&constructor_ref);
            object::transfer(creator, token_obj, to);
        };

        event::emit(Transfer {
            from: @0x0,
            to,
            token_id,
        });
    }
`;
}

function generateTransferFunction(moduleAddress: string): string {
  return `
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
`;
}

function generateBurnFunction(moduleAddress: string): string {
  return `
    /// Burn a token
    public entry fun burn(
        owner: &signer,
        token_address: address,
    ) acquires TokenRefs, CollectionRefs {
        let owner_addr = signer::address_of(owner);
        let token_obj: Object<Token> = object::address_to_object(token_address);

        // Verify ownership
        assert!(object::owner(token_obj) == owner_addr, E_NOT_OWNER);

        // Get and use burn ref
        let TokenRefs { extend_ref: _, transfer_ref: _, burn_ref } = move_from<TokenRefs>(token_address);
        object::delete(burn_ref);

        // Update supply count
        let refs = borrow_global_mut<CollectionRefs>(@${moduleAddress});
        if (refs.minted_count > 0) {
            refs.minted_count = refs.minted_count - 1;
        };

        event::emit(Transfer {
            from: owner_addr,
            to: @0x0,
            token_id: 0,
        });
    }
`;
}

/**
 * Detect if a contract is an ERC-721 token based on its functions
 * ERC-721 tokens have:
 * - ownerOf function
 * - balanceOf function
 * - transferFrom or safeTransferFrom function
 */
export function isERC721Contract(
  functions: { name: string }[],
  stateVariables?: { name: string; isMapping?: boolean }[]
): boolean {
  const functionNames = functions.map(f => f.name);
  const stateVarNames = (stateVariables || []).map(v => v.name);
  const allNames = [...functionNames, ...stateVarNames];

  // Required: ownerOf (as function or mapping _owners/_tokenOwner)
  const hasOwnerOf = functionNames.includes('ownerOf') ||
    stateVarNames.includes('_owners') ||
    stateVarNames.includes('_tokenOwner') ||
    stateVarNames.includes('owners');

  if (!hasOwnerOf) {
    return false;
  }

  // Required: balanceOf (as function or mapping _balances)
  const hasBalanceOf = allNames.includes('balanceOf') ||
    allNames.includes('_balances') ||
    allNames.includes('balances');

  if (!hasBalanceOf) {
    return false;
  }

  // Required: transfer mechanism
  const hasTransfer = functionNames.includes('transferFrom') ||
    functionNames.includes('safeTransferFrom') ||
    functionNames.includes('transfer');

  if (!hasTransfer) {
    return false;
  }

  // Additional signals that this is an NFT, not fungible token
  const hasNFTSignals = functionNames.includes('tokenURI') ||
    functionNames.includes('tokenOfOwnerByIndex') ||
    functionNames.includes('approve') ||
    functionNames.includes('getApproved') ||
    functionNames.includes('setApprovalForAll') ||
    stateVarNames.includes('_tokenURIs') ||
    stateVarNames.includes('_tokenApprovals');

  return hasNFTSignals;
}

/**
 * Extract ERC-721 config from contract IR
 */
export function extractERC721Config(
  contractName: string,
  moduleAddress: string,
  stateVariables: { name: string; type: any; initialValue?: any }[],
  functions: { name: string }[]
): DigitalAssetConfig {
  // Try to find name, symbol from state variables or constructor
  let collectionName = contractName;
  let collectionDescription = '';
  let collectionUri = '';

  for (const v of stateVariables) {
    if (v.name === 'name' || v.name === '_name') {
      if (v.initialValue?.kind === 'literal' && v.initialValue.type === 'string') {
        collectionName = v.initialValue.value;
      }
    }
    if (v.name === 'symbol' || v.name === '_symbol') {
      if (v.initialValue?.kind === 'literal' && v.initialValue.type === 'string') {
        // Use symbol in description
        collectionDescription = `${v.initialValue.value} NFT Collection`;
      }
    }
    if (v.name === 'baseURI' || v.name === '_baseURI' || v.name === 'baseTokenURI') {
      if (v.initialValue?.kind === 'literal' && v.initialValue.type === 'string') {
        collectionUri = v.initialValue.value;
      }
    }
  }

  const functionNames = functions.map(f => f.name);

  return {
    moduleName: toSnakeCase(contractName),
    moduleAddress,
    collectionName,
    collectionDescription: collectionDescription || `${collectionName} Digital Assets`,
    collectionUri,
    hasTransfer: functionNames.includes('transferFrom') ||
      functionNames.includes('safeTransferFrom') ||
      functionNames.includes('transfer'),
    hasApproval: functionNames.includes('approve') ||
      functionNames.includes('setApprovalForAll'),
    hasMint: functionNames.includes('mint') ||
      functionNames.includes('safeMint') ||
      functionNames.includes('_mint'),
    hasBurn: functionNames.includes('burn') ||
      functionNames.includes('_burn'),
  };
}

function toSnakeCase(str: string): string {
  if (!str) return '';
  // Preserve SCREAMING_SNAKE_CASE constants
  if (/^[A-Z][A-Z0-9_]*$/.test(str)) {
    return str.toLowerCase();
  }
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}
