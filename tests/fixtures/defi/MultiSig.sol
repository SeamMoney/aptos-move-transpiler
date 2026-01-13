// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Multi-Signature Wallet - Gnosis Safe Style
 * Tests: Multi-sig transactions, threshold signatures, owner management
 */
contract MultiSig {
    // Transaction state
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 numConfirmations;
    }

    // State
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public numConfirmationsRequired;

    // Transaction storage
    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    // Nonce for unique transaction IDs
    uint256 public nonce;

    // Events
    event Deposit(address indexed sender, uint256 amount, uint256 balance);
    event SubmitTransaction(
        address indexed owner,
        uint256 indexed txIndex,
        address indexed to,
        uint256 value,
        bytes data
    );
    event ConfirmTransaction(address indexed owner, uint256 indexed txIndex);
    event RevokeConfirmation(address indexed owner, uint256 indexed txIndex);
    event ExecuteTransaction(address indexed owner, uint256 indexed txIndex);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 required);

    // Errors
    error NotOwner();
    error TxDoesNotExist();
    error TxAlreadyExecuted();
    error TxAlreadyConfirmed();
    error TxNotConfirmed();
    error NotEnoughConfirmations();
    error TxExecutionFailed();
    error InvalidOwner();
    error OwnerAlreadyExists();
    error InvalidRequirement();

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 _txIndex) {
        require(_txIndex < transactions.length, "Tx does not exist");
        _;
    }

    modifier notExecuted(uint256 _txIndex) {
        require(!transactions[_txIndex].executed, "Tx already executed");
        _;
    }

    modifier notConfirmed(uint256 _txIndex) {
        require(!isConfirmed[_txIndex][msg.sender], "Tx already confirmed");
        _;
    }

    constructor(address[] memory _owners, uint256 _numConfirmationsRequired) {
        require(_owners.length > 0, "Owners required");
        require(
            _numConfirmationsRequired > 0 && _numConfirmationsRequired <= _owners.length,
            "Invalid number of required confirmations"
        );

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Owner not unique");

            isOwner[owner] = true;
            owners.push(owner);
        }

        numConfirmationsRequired = _numConfirmationsRequired;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    /**
     * Submit a new transaction
     */
    function submitTransaction(
        address _to,
        uint256 _value,
        bytes memory _data
    ) public onlyOwner returns (uint256 txIndex) {
        txIndex = transactions.length;

        transactions.push(Transaction({
            to: _to,
            value: _value,
            data: _data,
            executed: false,
            numConfirmations: 0
        }));

        emit SubmitTransaction(msg.sender, txIndex, _to, _value, _data);

        // Auto-confirm for submitter
        confirmTransaction(txIndex);
    }

    /**
     * Confirm a pending transaction
     */
    function confirmTransaction(uint256 _txIndex)
        public
        onlyOwner
        txExists(_txIndex)
        notExecuted(_txIndex)
        notConfirmed(_txIndex)
    {
        Transaction storage transaction = transactions[_txIndex];
        transaction.numConfirmations += 1;
        isConfirmed[_txIndex][msg.sender] = true;

        emit ConfirmTransaction(msg.sender, _txIndex);

        // Auto-execute if threshold reached
        if (transaction.numConfirmations >= numConfirmationsRequired) {
            executeTransaction(_txIndex);
        }
    }

    /**
     * Execute a confirmed transaction
     */
    function executeTransaction(uint256 _txIndex)
        public
        onlyOwner
        txExists(_txIndex)
        notExecuted(_txIndex)
    {
        Transaction storage transaction = transactions[_txIndex];

        require(
            transaction.numConfirmations >= numConfirmationsRequired,
            "Not enough confirmations"
        );

        transaction.executed = true;

        (bool success, ) = transaction.to.call{value: transaction.value}(transaction.data);
        require(success, "Tx execution failed");

        emit ExecuteTransaction(msg.sender, _txIndex);
    }

    /**
     * Revoke a confirmation
     */
    function revokeConfirmation(uint256 _txIndex)
        public
        onlyOwner
        txExists(_txIndex)
        notExecuted(_txIndex)
    {
        require(isConfirmed[_txIndex][msg.sender], "Tx not confirmed");

        Transaction storage transaction = transactions[_txIndex];
        transaction.numConfirmations -= 1;
        isConfirmed[_txIndex][msg.sender] = false;

        emit RevokeConfirmation(msg.sender, _txIndex);
    }

    /**
     * Add a new owner (requires multi-sig confirmation)
     */
    function addOwner(address _owner) external {
        // This should be called via executeTransaction
        require(msg.sender == address(this), "Only via multisig");
        require(_owner != address(0), "Invalid owner");
        require(!isOwner[_owner], "Owner already exists");

        isOwner[_owner] = true;
        owners.push(_owner);

        emit OwnerAdded(_owner);
    }

    /**
     * Remove an owner (requires multi-sig confirmation)
     */
    function removeOwner(address _owner) external {
        require(msg.sender == address(this), "Only via multisig");
        require(isOwner[_owner], "Not owner");
        require(owners.length - 1 >= numConfirmationsRequired, "Cannot remove owner");

        isOwner[_owner] = false;

        // Remove from owners array
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == _owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        emit OwnerRemoved(_owner);
    }

    /**
     * Change confirmation requirement (requires multi-sig confirmation)
     */
    function changeRequirement(uint256 _required) external {
        require(msg.sender == address(this), "Only via multisig");
        require(_required > 0 && _required <= owners.length, "Invalid requirement");

        numConfirmationsRequired = _required;

        emit RequirementChanged(_required);
    }

    // View functions

    function getOwners() public view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() public view returns (uint256) {
        return transactions.length;
    }

    function getTransaction(uint256 _txIndex)
        public
        view
        returns (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            uint256 numConfirmations
        )
    {
        Transaction storage transaction = transactions[_txIndex];
        return (
            transaction.to,
            transaction.value,
            transaction.data,
            transaction.executed,
            transaction.numConfirmations
        );
    }

    /**
     * Get pending transactions
     */
    function getPendingTransactions() public view returns (uint256[] memory) {
        uint256 pendingCount = 0;

        // Count pending
        for (uint256 i = 0; i < transactions.length; i++) {
            if (!transactions[i].executed) {
                pendingCount++;
            }
        }

        // Collect pending
        uint256[] memory pending = new uint256[](pendingCount);
        uint256 index = 0;

        for (uint256 i = 0; i < transactions.length; i++) {
            if (!transactions[i].executed) {
                pending[index] = i;
                index++;
            }
        }

        return pending;
    }

    /**
     * Check if transaction is confirmed by specific owner
     */
    function isTransactionConfirmedBy(uint256 _txIndex, address _owner) public view returns (bool) {
        return isConfirmed[_txIndex][_owner];
    }

    /**
     * Get list of owners who confirmed a transaction
     */
    function getConfirmations(uint256 _txIndex) public view returns (address[] memory) {
        uint256 count = 0;

        // Count confirmations
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmed[_txIndex][owners[i]]) {
                count++;
            }
        }

        // Collect confirmations
        address[] memory confirmations = new address[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmed[_txIndex][owners[i]]) {
                confirmations[index] = owners[i];
                index++;
            }
        }

        return confirmations;
    }

    /**
     * Encode function call for adding owner
     */
    function encodeAddOwner(address _owner) public pure returns (bytes memory) {
        return abi.encodeWithSignature("addOwner(address)", _owner);
    }

    /**
     * Encode function call for removing owner
     */
    function encodeRemoveOwner(address _owner) public pure returns (bytes memory) {
        return abi.encodeWithSignature("removeOwner(address)", _owner);
    }

    /**
     * Encode function call for changing requirement
     */
    function encodeChangeRequirement(uint256 _required) public pure returns (bytes memory) {
        return abi.encodeWithSignature("changeRequirement(uint256)", _required);
    }
}
