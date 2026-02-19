/**
 * Fungible Asset Generator
 * Generates Move code using the modern Aptos Fungible Asset standard (AIP-21)
 * This is the recommended approach for ERC-20 style tokens on Aptos
 */

export interface FungibleAssetConfig {
  moduleName: string;
  moduleAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  iconUri?: string;
  projectUri?: string;
  hasTransfer: boolean;
  hasApprove: boolean;
  hasMint: boolean;
  hasBurn: boolean;
}

/**
 * Generate a Fungible Asset module from ERC-20 contract info
 */
export function generateFungibleAssetModule(config: FungibleAssetConfig): string {
  const {
    moduleName,
    moduleAddress,
    name,
    symbol,
    decimals,
    iconUri = '',
    projectUri = '',
    hasTransfer,
    hasMint,
    hasBurn,
  } = config;

  return `module ${moduleAddress}::${moduleName} {
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
    const ASSET_SYMBOL: vector<u8> = b"${symbol}";

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
            string::utf8(b"${name}"),
            string::utf8(ASSET_SYMBOL),
            ${decimals},
            string::utf8(b"${iconUri}"),
            string::utf8(b"${projectUri}"),
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
        object::create_object_address(&@${moduleAddress}, ASSET_SYMBOL)
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
${hasTransfer ? generateTransferFunction() : ''}
${hasMint ? generateMintFunction(moduleAddress) : ''}
${hasBurn ? generateBurnFunction(moduleAddress) : ''}
}
`;
}

function generateTransferFunction(): string {
  return `
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
`;
}

function generateMintFunction(moduleAddress: string): string {
  return `
    /// Mint new tokens (only admin)
    public entry fun mint(
        admin: &signer,
        to: address,
        amount: u64,
    ) acquires ManagedFungibleAsset {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @${moduleAddress}, E_NOT_OWNER);

        let managed = borrow_global<ManagedFungibleAsset>(metadata_address());
        let fa = fungible_asset::mint(&managed.mint_ref, amount);
        primary_fungible_store::deposit(to, fa);
        event::emit(Transfer { from: @0x0, to, amount });
    }
`;
}

function generateBurnFunction(moduleAddress: string): string {
  return `
    /// Burn tokens from an account
    public entry fun burn(
        account: &signer,
        amount: u64,
    ) acquires ManagedFungibleAsset {
        let account_addr = signer::address_of(account);
        let managed = borrow_global<ManagedFungibleAsset>(metadata_address());
        let fa = primary_fungible_store::withdraw(account, metadata(), amount);
        fungible_asset::burn(&managed.burn_ref, fa);
        event::emit(Transfer { from: account_addr, to: @0x0, amount });
    }
`;
}

/**
 * Detect if a contract is an ERC-20 token based on its functions and state variables
 * ERC-20 tokens have:
 * - transfer function
 * - balanceOf (can be function or public mapping)
 * - totalSupply (can be function or public state variable)
 */
export function isERC20Contract(
  functions: { name: string }[],
  stateVariables?: { name: string; isMapping?: boolean }[]
): boolean {
  const functionNames = functions.map(f => f.name);
  const stateVarNames = (stateVariables || []).map(v => v.name);
  const allNames = [...functionNames, ...stateVarNames];

  // Required: transfer function
  if (!functionNames.includes('transfer')) {
    return false;
  }

  // Required: balanceOf (as mapping or function)
  const hasBalanceOf = allNames.includes('balanceOf') || allNames.includes('_balances') || allNames.includes('balances');
  if (!hasBalanceOf) {
    return false;
  }

  // Required: totalSupply (as variable or function)
  const hasTotalSupply = allNames.includes('totalSupply') || allNames.includes('_totalSupply');
  if (!hasTotalSupply) {
    return false;
  }

  return true;
}

/**
 * Extract ERC-20 config from contract IR
 */
export function extractERC20Config(
  contractName: string,
  moduleAddress: string,
  stateVariables: { name: string; type: any; initialValue?: any }[],
  functions: { name: string }[]
): FungibleAssetConfig {
  // Try to find name, symbol, decimals from state variables
  let name = contractName;
  let symbol = contractName.substring(0, 3).toUpperCase();
  let decimals = 18;

  for (const v of stateVariables) {
    if (v.name === 'name' || v.name === '_name') {
      if (v.initialValue?.kind === 'literal' && v.initialValue.type === 'string') {
        name = v.initialValue.value;
      }
    }
    if (v.name === 'symbol' || v.name === '_symbol') {
      if (v.initialValue?.kind === 'literal' && v.initialValue.type === 'string') {
        symbol = v.initialValue.value;
      }
    }
    if (v.name === 'decimals' || v.name === '_decimals') {
      if (v.initialValue?.kind === 'literal' && v.initialValue.type === 'number') {
        decimals = Number(v.initialValue.value);
      }
    }
  }

  const functionNames = functions.map(f => f.name);

  return {
    moduleName: toSnakeCase(contractName),
    moduleAddress,
    name,
    symbol,
    decimals,
    hasTransfer: functionNames.includes('transfer'),
    hasApprove: functionNames.includes('approve'),
    hasMint: functionNames.includes('mint'),
    hasBurn: functionNames.includes('burn'),
  };
}

function toSnakeCase(str: string): string {
  if (!str) return '';
  // Preserve SCREAMING_SNAKE_CASE constants
  if (/^_?[A-Z][A-Z0-9_]*$/.test(str)) {
    return str.toLowerCase();
  }
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')     // lowercase/digit → uppercase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // consecutive uppercase → Titlecase boundary
    .toLowerCase()
    .replace(/^_/, '');
}
