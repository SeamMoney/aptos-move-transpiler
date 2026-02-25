// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Simple AMM (Automated Market Maker) - Uniswap V2 Style
 * Tests: Liquidity pools, swaps, constant product formula, LP tokens
 */
contract SimpleAMM {
    // Token addresses
    address public token0;
    address public token1;

    // Reserves
    uint256 public reserve0;
    uint256 public reserve1;

    // LP token tracking
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    // Fee (0.3% = 3/1000)
    uint256 public constant FEE_NUMERATOR = 3;
    uint256 public constant FEE_DENOMINATOR = 1000;

    // Minimum liquidity to prevent division by zero attacks
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    // Reentrancy guard
    uint256 private unlocked = 1;

    // Events
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint256 reserve0, uint256 reserve1);

    // Errors
    error InsufficientLiquidity();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InvalidTo();
    error Locked();
    error Overflow();

    modifier lock() {
        require(unlocked == 1, "Locked");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    /**
     * Add liquidity to the pool
     */
    function mint(address to) external lock returns (uint256 liquidity) {
        (uint256 _reserve0, uint256 _reserve1) = getReserves();
        uint256 balance0 = getBalance0();
        uint256 balance1 = getBalance1();
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            // Permanently lock the first MINIMUM_LIQUIDITY tokens
            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
            totalSupply = MINIMUM_LIQUIDITY;
        } else {
            liquidity = min(
                (amount0 * _totalSupply) / _reserve0,
                (amount1 * _totalSupply) / _reserve1
            );
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        balanceOf[to] += liquidity;
        totalSupply += liquidity;

        _update(balance0, balance1);

        emit Mint(msg.sender, amount0, amount1);
    }

    /**
     * Remove liquidity from the pool
     */
    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = getBalance0();
        uint256 balance1 = getBalance1();
        uint256 liquidity = balanceOf[address(this)];

        uint256 _totalSupply = totalSupply;
        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;

        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");

        balanceOf[address(this)] -= liquidity;
        totalSupply -= liquidity;

        // Transfer tokens to recipient (simplified - real impl uses safeTransfer)
        _update(balance0 - amount0, balance1 - amount1);

        emit Burn(msg.sender, amount0, amount1, to);
    }

    /**
     * Swap tokens - core AMM function
     */
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to
    ) external lock {
        require(amount0Out > 0 || amount1Out > 0, "Insufficient output amount");

        (uint256 _reserve0, uint256 _reserve1) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "Insufficient liquidity");
        require(to != token0 && to != token1, "Invalid to");

        uint256 balance0 = getBalance0() - amount0Out;
        uint256 balance1 = getBalance1() - amount1Out;

        // Calculate input amounts
        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;

        require(amount0In > 0 || amount1In > 0, "Insufficient input amount");

        // Verify constant product with fee
        uint256 balance0Adjusted = (balance0 * FEE_DENOMINATOR) - (amount0In * FEE_NUMERATOR);
        uint256 balance1Adjusted = (balance1 * FEE_DENOMINATOR) - (amount1In * FEE_NUMERATOR);

        require(
            balance0Adjusted * balance1Adjusted >= _reserve0 * _reserve1 * (FEE_DENOMINATOR ** 2),
            "K invariant"
        );

        _update(balance0, balance1);

        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /**
     * Get output amount for a given input
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        require(amountIn > 0, "Insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_NUMERATOR);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DENOMINATOR) + amountInWithFee;

        amountOut = numerator / denominator;
    }

    /**
     * Get input amount for a desired output
     */
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountIn) {
        require(amountOut > 0, "Insufficient output amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 numerator = reserveIn * amountOut * FEE_DENOMINATOR;
        uint256 denominator = (reserveOut - amountOut) * (FEE_DENOMINATOR - FEE_NUMERATOR);

        amountIn = (numerator / denominator) + 1;
    }

    // View functions
    function getReserves() public view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    // Internal functions
    function _update(uint256 balance0, uint256 balance1) private {
        reserve0 = balance0;
        reserve1 = balance1;
        emit Sync(reserve0, reserve1);
    }

    // Simplified balance getters (real impl reads from ERC20)
    function getBalance0() internal view returns (uint256) {
        return reserve0; // Simplified
    }

    function getBalance1() internal view returns (uint256) {
        return reserve1; // Simplified
    }

    // Math utilities
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
