// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IChainlink {
    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    );
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

contract SentinelGuard {
    address public immutable owner;
    address public           sentinel;

    struct CheckResult {
        bool    check1_flash;
        bool    check2_gas;
        bool    check3_spread;
        bool    check4_oracle;
        bool    check5_depth;
        bool    check6_treasury;
        bool    check7_capacity;
        bool    allPass;
        uint256 flashAvailable;
        uint256 gasCostUSD;
        uint256 expectedProfit;
        uint256 timestamp;
    }

    mapping(uint256 => CheckResult) public results;
    uint256 public totalChecks;
    uint256 public totalPass;
    uint256 public totalSkip;

    // Chainlink feeds — Polygon — all verified checksums, all 40 hex digits
    address constant ETH_USD   = 0xF9680D99D6C9589e2a93a78A04A279e509205945;
    address constant MATIC_USD = 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0;

    // Balancer + Aave — Polygon
    address constant BALANCER  = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant USDC      = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant A_USDC    = 0x625E7708f30cA75bfd92586e17077590C60eb4cD;

    uint256 constant MAX_ORACLE_AGE = 300;
    uint256 constant MIN_FLASH      = 1_000_000e6;

    event CheckRecorded(uint256 indexed cycleId, bool allPass, uint256 flashAvailable);

    modifier onlyAuth() {
        require(msg.sender == owner || msg.sender == sentinel, "G:!auth");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "G:!owner");
        _;
    }

    constructor() { owner = msg.sender; }

    function setSentinel(address _sentinel) external onlyOwner { sentinel = _sentinel; }

    function recordCheck(
        uint256 cycleId,
        bool c1, bool c2, bool c3, bool c4, bool c5, bool c6, bool c7,
        uint256 flashAvailable,
        uint256 gasCostUSD,
        uint256 expectedProfit
    ) external onlyAuth {
        bool allPass = c1 && c2 && c3 && c4 && c5 && c6 && c7;
        results[cycleId] = CheckResult({
            check1_flash:    c1,
            check2_gas:      c2,
            check3_spread:   c3,
            check4_oracle:   c4,
            check5_depth:    c5,
            check6_treasury: c6,
            check7_capacity: c7,
            allPass:         allPass,
            flashAvailable:  flashAvailable,
            gasCostUSD:      gasCostUSD,
            expectedProfit:  expectedProfit,
            timestamp:       block.timestamp
        });
        totalChecks++;
        if (allPass) totalPass++;
        else         totalSkip++;
        emit CheckRecorded(cycleId, allPass, flashAvailable);
    }

    function liveBalancerFlash() external view returns (uint256) {
        return IERC20(USDC).balanceOf(BALANCER);
    }

    function liveAaveFlash() external view returns (uint256) {
        return IERC20(A_USDC).balanceOf(AAVE_POOL);
    }

    function oracleFresh() external view returns (bool) {
        (, , , uint256 updatedAt,) = IChainlink(ETH_USD).latestRoundData();
        return block.timestamp - updatedAt <= MAX_ORACLE_AGE;
    }

    function landingRate() external view returns (uint256) {
        if (totalChecks == 0) return 0;
        return (totalPass * 10000) / totalChecks;
    }

    function getResult(uint256 cycleId) external view returns (CheckResult memory) {
        return results[cycleId];
    }
}
