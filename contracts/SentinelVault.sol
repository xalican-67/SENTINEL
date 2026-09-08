// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract SentinelVault {
    address public immutable owner;
    address public immutable treasury;
    address public           sentinel;
    address public           recycler;

    address constant USDC      = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalToRecycler;
    uint256 public totalToTreasury;

    uint256 constant TREASURY_BPS = 7000;
    uint256 constant RECYCLER_BPS = 2000;
    uint256 constant BPS_BASE     = 10000;

    event Deposited(address token, uint256 amount, uint256 toTreasury, uint256 toRecycler);
    event Withdrawn(address to, uint256 amount);

    modifier onlyAuth() {
        require(
            msg.sender == owner || msg.sender == sentinel || msg.sender == recycler,
            "V:!auth"
        );
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "V:!owner");
        _;
    }

    constructor(address _treasury) {
        owner    = msg.sender;
        treasury = _treasury;
    }

    function setSentinel(address _sentinel) external onlyOwner { sentinel = _sentinel; }
    function setRecycler(address _recycler) external onlyOwner { recycler = _recycler; }

    function deposit(address token, uint256 amount) external onlyAuth {
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "V:transfer");
        totalDeposited += amount;

        uint256 toTreasury = (amount * TREASURY_BPS) / BPS_BASE;
        uint256 toRecycler = (amount * RECYCLER_BPS) / BPS_BASE;

        if (toTreasury > 0) {
            IERC20(token).transfer(treasury, toTreasury);
            totalToTreasury += toTreasury;
            totalWithdrawn  += toTreasury;
        }
        if (toRecycler > 0 && recycler != address(0)) {
            IERC20(token).transfer(recycler, toRecycler);
            totalToRecycler += toRecycler;
        }

        emit Deposited(token, amount, toTreasury, toRecycler);
    }

    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 amt = amount == 0 ? bal : amount;
        require(amt <= bal, "V:insufficient");
        IERC20(token).transfer(to, amt);
        totalWithdrawn += amt;
        emit Withdrawn(to, amt);
    }

    function supplyToAave(address token, uint256 amount) external onlyOwner {
        IERC20(token).approve(AAVE_POOL, amount);
        IAavePool(AAVE_POOL).supply(token, amount, address(this), 0);
    }

    function withdrawFromAave(address token, uint256 amount) external onlyOwner {
        IAavePool(AAVE_POOL).withdraw(token, amount, address(this));
    }

    function balanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
