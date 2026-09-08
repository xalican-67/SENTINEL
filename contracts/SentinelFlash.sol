// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 { function balanceOf(address) external view returns (uint256); }
interface IBalancerVault {
    function flashLoan(address recipient, address[] memory tokens, uint256[] memory amounts, bytes memory userData) external;
}
interface IAavePool {
    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external;
}

contract SentinelFlash {
    address public immutable owner;
    address public           sentinel;

    address constant BALANCER  = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant USDC      = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;

    bool private _locked;

    modifier nonReentrant() { require(!_locked,"SF:re"); _locked=true; _; _locked=false; }
    modifier onlyOwner() { require(msg.sender==owner,"SF:own"); _; }

    constructor() { owner = msg.sender; }
    function setSentinel(address _s) external onlyOwner { sentinel = _s; }

    function balancerFlash(address[] calldata tokens, uint256[] calldata amounts, bytes calldata data) external nonReentrant onlyOwner {
        IBalancerVault(BALANCER).flashLoan(sentinel, tokens, amounts, data);
    }

    function aaveFlash(address asset, uint256 amount, bytes calldata params) external nonReentrant onlyOwner {
        IAavePool(AAVE_POOL).flashLoanSimple(sentinel, asset, amount, params, 0);
    }

    function balancerAvailable(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(BALANCER);
    }
}
