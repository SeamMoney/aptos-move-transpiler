/// EVM Compatibility Module for Transpiled Solidity Contracts
/// Provides helper functions that emulate EVM behavior in Move
/// Based on reverse engineering of Pontem's e2m tool patterns
module transpiler::evm_compat {
    use std::hash;
    use std::vector;
    use std::bcs;
    use std::signer;
    use aptos_framework::timestamp;
    use aptos_framework::block;
    use aptos_std::aptos_hash;

    // ============================================
    // Error Codes (Solidity-style)
    // ============================================
    const E_OVERFLOW: u64 = 0x11;           // Arithmetic overflow
    const E_UNDERFLOW: u64 = 0x12;          // Arithmetic underflow
    const E_DIVISION_BY_ZERO: u64 = 0x12;   // Division by zero
    const E_REQUIRE_FAILED: u64 = 0x01;     // Require condition failed
    const E_ASSERT_FAILED: u64 = 0x01;      // Assert condition failed
    const E_REVERT: u64 = 0x00;             // Generic revert
    const E_UNAUTHORIZED: u64 = 0x02;       // Unauthorized access
    const E_INVALID_ARGUMENT: u64 = 0x03;   // Invalid argument
    const E_INSUFFICIENT_BALANCE: u64 = 0x04; // Insufficient balance
    const E_REENTRANCY: u64 = 0x05;         // Reentrancy detected

    // Reentrancy guard states
    const NOT_ENTERED: u8 = 1;
    const ENTERED: u8 = 2;

    // ============================================
    // Hash Functions
    // ============================================

    /// Equivalent to keccak256 (uses sha3_256 as closest alternative)
    /// Note: This is NOT the same as Ethereum's keccak256
    public fun keccak256(data: vector<u8>): vector<u8> {
        aptos_hash::keccak256(data)
    }

    /// SHA3-256 hash
    public fun sha3_256(data: vector<u8>): vector<u8> {
        hash::sha3_256(data)
    }

    /// SHA2-256 hash
    public fun sha256(data: vector<u8>): vector<u8> {
        hash::sha2_256(data)
    }

    // ============================================
    // Block Information
    // ============================================

    /// Get current block timestamp (in seconds)
    /// Equivalent to block.timestamp
    public fun block_timestamp(): u64 {
        timestamp::now_seconds()
    }

    /// Get current block timestamp in microseconds
    public fun block_timestamp_micros(): u64 {
        timestamp::now_microseconds()
    }

    /// Get current block number/height
    /// Equivalent to block.number
    public fun block_number(): u64 {
        block::get_current_block_height()
    }

    // ============================================
    // Math Utilities (with overflow protection)
    // ============================================

    /// Safe addition with overflow check
    public fun safe_add_u256(a: u256, b: u256): u256 {
        let result = a + b;
        assert!(result >= a, E_OVERFLOW);
        result
    }

    /// Safe subtraction with underflow check
    public fun safe_sub_u256(a: u256, b: u256): u256 {
        assert!(a >= b, E_UNDERFLOW);
        a - b
    }

    /// Safe multiplication with overflow check
    public fun safe_mul_u256(a: u256, b: u256): u256 {
        if (a == 0 || b == 0) {
            return 0
        };
        let result = a * b;
        assert!(result / a == b, E_OVERFLOW);
        result
    }

    /// Safe division
    public fun safe_div_u256(a: u256, b: u256): u256 {
        assert!(b > 0, E_DIVISION_BY_ZERO);
        a / b
    }

    /// Modulo operation
    public fun mod_u256(a: u256, b: u256): u256 {
        assert!(b > 0, E_DIVISION_BY_ZERO);
        a % b
    }

    /// (a + b) % n - Equivalent to Solidity's addmod
    public fun addmod(a: u256, b: u256, n: u256): u256 {
        assert!(n > 0, E_DIVISION_BY_ZERO);
        ((a % n) + (b % n)) % n
    }

    /// (a * b) % n - Equivalent to Solidity's mulmod
    public fun mulmod(a: u256, b: u256, n: u256): u256 {
        assert!(n > 0, E_DIVISION_BY_ZERO);
        ((a % n) * (b % n)) % n
    }

    /// Exponentiation
    public fun exp_u256(base: u256, exp: u256): u256 {
        if (exp == 0) {
            return 1
        };
        let result: u256 = 1;
        let b = base;
        let e = exp;
        while (e > 0) {
            if (e & 1 == 1) {
                result = result * b;
            };
            b = b * b;
            e = e >> 1;
        };
        result
    }

    // ============================================
    // Type Conversions
    // ============================================

    /// Convert u64 to u256
    public fun u64_to_u256(value: u64): u256 {
        (value as u256)
    }

    /// Convert u128 to u256
    public fun u128_to_u256(value: u128): u256 {
        (value as u256)
    }

    /// Convert u256 to u64 (truncates)
    public fun u256_to_u64(value: u256): u64 {
        ((value & 0xFFFFFFFFFFFFFFFF) as u64)
    }

    /// Convert u256 to u128 (truncates)
    public fun u256_to_u128(value: u256): u128 {
        ((value & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) as u128)
    }

    /// Convert address to u256
    public fun address_to_u256(addr: address): u256 {
        let bytes = bcs::to_bytes(&addr);
        bytes_to_u256(bytes)
    }

    /// Convert bytes to u256 (big-endian)
    public fun bytes_to_u256(bytes: vector<u8>): u256 {
        let len = vector::length(&bytes);
        let result: u256 = 0;
        let i = 0;
        while (i < len && i < 32) {
            result = (result << 8) | (*vector::borrow(&bytes, i) as u256);
            i = i + 1;
        };
        result
    }

    /// Convert u256 to bytes (big-endian, 32 bytes)
    public fun u256_to_bytes(value: u256): vector<u8> {
        let result = vector::empty<u8>();
        let i = 0;
        while (i < 32) {
            let byte = (((value >> ((31 - i) * 8)) & 0xFF) as u8);
            vector::push_back(&mut result, byte);
            i = i + 1;
        };
        result
    }

    // ============================================
    // Bitwise Operations
    // ============================================

    /// Bitwise NOT
    public fun bit_not_u256(a: u256): u256 {
        a ^ 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
    }

    /// Get byte at position (0-31, big-endian like EVM)
    public fun byte_at(value: u256, pos: u8): u8 {
        assert!(pos < 32, E_OVERFLOW);
        (((value >> ((31 - (pos as u256)) * 8)) & 0xFF) as u8)
    }

    // ============================================
    // ABI Encoding (simplified)
    // ============================================

    /// Encode single u256 value
    public fun abi_encode_u256(value: u256): vector<u8> {
        u256_to_bytes(value)
    }

    /// Encode address
    public fun abi_encode_address(addr: address): vector<u8> {
        let bytes = bcs::to_bytes(&addr);
        // Pad to 32 bytes
        let result = vector::empty<u8>();
        let padding = 32 - vector::length(&bytes);
        let i = 0;
        while (i < padding) {
            vector::push_back(&mut result, 0);
            i = i + 1;
        };
        vector::append(&mut result, bytes);
        result
    }

    /// Concatenate two byte vectors
    public fun concat(a: vector<u8>, b: vector<u8>): vector<u8> {
        vector::append(&mut a, b);
        a
    }

    // ============================================
    // Comparison helpers
    // ============================================

    /// Min of two u256 values
    public fun min_u256(a: u256, b: u256): u256 {
        if (a < b) { a } else { b }
    }

    /// Max of two u256 values
    public fun max_u256(a: u256, b: u256): u256 {
        if (a > b) { a } else { b }
    }

    // ============================================
    // Require/Assert/Revert (Solidity patterns)
    // ============================================

    /// Solidity require(condition) equivalent
    public fun require(condition: bool) {
        assert!(condition, E_REQUIRE_FAILED);
    }

    /// Solidity require(condition, errorCode) equivalent
    public fun require_with_code(condition: bool, error_code: u64) {
        assert!(condition, error_code);
    }

    /// Solidity revert() equivalent
    public fun revert() {
        abort E_REVERT
    }

    /// Solidity revert with custom error code
    public fun revert_with_code(error_code: u64) {
        abort error_code
    }

    // ============================================
    // Signed Integer Operations (for int256)
    // ============================================

    /// Signed division (sdiv)
    public fun sdiv(a: i256, b: i256): i256 {
        assert!(b != 0, E_DIVISION_BY_ZERO);
        a / b
    }

    /// Signed modulo (smod)
    public fun smod(a: i256, b: i256): i256 {
        assert!(b != 0, E_DIVISION_BY_ZERO);
        a % b
    }

    /// Signed less than (slt)
    public fun slt(a: i256, b: i256): bool {
        a < b
    }

    /// Signed greater than (sgt)
    public fun sgt(a: i256, b: i256): bool {
        a > b
    }

    /// Convert u256 to i256 (for signed operations)
    public fun to_signed(value: u256): i256 {
        (value as i256)
    }

    /// Convert i256 to u256
    public fun to_unsigned(value: i256): u256 {
        (value as u256)
    }

    // ============================================
    // Reentrancy Guard Pattern
    // ============================================

    /// Check reentrancy - call at start of function
    public fun reentrancy_enter(status: &mut u8) {
        assert!(*status != ENTERED, E_REENTRANCY);
        *status = ENTERED;
    }

    /// Exit reentrancy guard - call at end of function
    public fun reentrancy_exit(status: &mut u8) {
        *status = NOT_ENTERED;
    }

    /// Get initial reentrancy status
    public fun reentrancy_init(): u8 {
        NOT_ENTERED
    }

    // ============================================
    // Address Utilities
    // ============================================

    /// Get sender address from signer (msg.sender)
    public fun msg_sender(account: &signer): address {
        signer::address_of(account)
    }

    /// Check if address is zero
    public fun is_zero_address(addr: address): bool {
        addr == @0x0
    }

    /// Get zero address
    public fun zero_address(): address {
        @0x0
    }

    /// Convert u256 to address (takes lower 32 bytes)
    /// NOTE: This is for compatibility - in practice, Move addresses are 32 bytes
    /// and cannot be constructed from arbitrary u256 at runtime
    public fun to_address(value: u256): address {
        // In Move, addresses are fixed at compile time
        // For runtime conversion, we use BCS serialization
        let bytes = bcs::to_bytes(&value);
        // Take last 32 bytes (address size)
        let addr_bytes = vector::empty<u8>();
        let len = vector::length(&bytes);
        let start = if (len > 32) { len - 32 } else { 0 };
        let i = start;
        while (i < len) {
            vector::push_back(&mut addr_bytes, *vector::borrow(&bytes, i));
            i = i + 1;
        };
        // Pad to 32 bytes if needed
        while (vector::length(&addr_bytes) < 32) {
            vector::push_back(&mut addr_bytes, 0u8);
        };
        aptos_std::from_bcs::to_address(addr_bytes)
    }

    /// Convert address to u256
    public fun address_to_u256(addr: address): u256 {
        let bytes = bcs::to_bytes(&addr);
        let result: u256 = 0;
        let i = 0;
        let len = vector::length(&bytes);
        while (i < len) {
            result = (result << 8) | (*vector::borrow(&bytes, i) as u256);
            i = i + 1;
        };
        result
    }

    /// Check if two addresses are equal
    public fun address_eq(a: address, b: address): bool {
        a == b
    }

    // ============================================
    // String/Bytes Utilities
    // ============================================

    /// Get length of bytes
    public fun bytes_length(data: &vector<u8>): u64 {
        vector::length(data)
    }

    /// Slice bytes from start to end
    public fun bytes_slice(data: &vector<u8>, start: u64, end: u64): vector<u8> {
        let result = vector::empty<u8>();
        let i = start;
        while (i < end && i < vector::length(data)) {
            vector::push_back(&mut result, *vector::borrow(data, i));
            i = i + 1;
        };
        result
    }

    /// Compare two byte vectors
    public fun bytes_eq(a: &vector<u8>, b: &vector<u8>): bool {
        if (vector::length(a) != vector::length(b)) {
            return false
        };
        let i = 0;
        let len = vector::length(a);
        while (i < len) {
            if (*vector::borrow(a, i) != *vector::borrow(b, i)) {
                return false
            };
            i = i + 1;
        };
        true
    }

    // ============================================
    // Ownable Pattern Helpers
    // ============================================

    /// Check if caller is owner
    public fun only_owner(caller: address, owner: address) {
        assert!(caller == owner, E_UNAUTHORIZED);
    }

    // ============================================
    // SafeERC20-style Checks
    // ============================================

    /// Check sufficient balance
    public fun check_balance(balance: u256, amount: u256) {
        assert!(balance >= amount, E_INSUFFICIENT_BALANCE);
    }

    /// Safe transfer check - non-zero address
    public fun check_transfer(to: address) {
        assert!(to != @0x0, E_INVALID_ARGUMENT);
    }

    // ============================================
    // Common Constants
    // ============================================

    /// Max u256 value
    public fun max_u256_value(): u256 {
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
    }

    /// Wei per Ether (1e18)
    public fun wei_per_ether(): u256 {
        1000000000000000000
    }

    // ============================================
    // Error Code Getters
    // ============================================

    public fun error_overflow(): u64 { E_OVERFLOW }
    public fun error_underflow(): u64 { E_UNDERFLOW }
    public fun error_division_by_zero(): u64 { E_DIVISION_BY_ZERO }
    public fun error_require_failed(): u64 { E_REQUIRE_FAILED }
    public fun error_unauthorized(): u64 { E_UNAUTHORIZED }
    public fun error_invalid_argument(): u64 { E_INVALID_ARGUMENT }
    public fun error_insufficient_balance(): u64 { E_INSUFFICIENT_BALANCE }
}
