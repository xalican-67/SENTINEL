// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IChainlink {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract SentinelOracle {
    address public immutable owner;
    address public           sentinel;

    // Chainlink feeds — Polygon — all verified checksums, all 40 hex digits
    address constant ETH_USD   = 0xF9680D99D6C9589e2a93a78A04A279e509205945;
    address constant BTC_USD   = 0xc907E116054Ad103354f2D350FD2514433D57F6f;
    address constant MATIC_USD = 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0;
    address constant USDC_USD  = 0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7;

    uint256 constant MAX_AGE = 300;

    struct Price {
        int256  value;
        uint256 updatedAt;
        bool    fresh;
    }

    modifier onlyOwner() { require(msg.sender == owner, "ORA:!owner"); _; }

    constructor() { owner = msg.sender; }

    function setSentinel(address _sentinel) external onlyOwner { sentinel = _sentinel; }

    function getPrice(address feed) public view returns (Price memory) {
        (, int256 answer, , uint256 updatedAt,) = IChainlink(feed).latestRoundData();
        return Price({
            value:     answer,
            updatedAt: updatedAt,
            fresh:     block.timestamp - updatedAt <= MAX_AGE
        });
    }

    function allPricesFresh() external view returns (bool) {
        return
            getPrice(ETH_USD).fresh   &&
            getPrice(BTC_USD).fresh   &&
            getPrice(MATIC_USD).fresh &&
            getPrice(USDC_USD).fresh;
    }

    function getPrices() external view returns (
        Price memory eth,
        Price memory btc,
        Price memory matic,
        Price memory usdc
    ) {
        eth   = getPrice(ETH_USD);
        btc   = getPrice(BTC_USD);
        matic = getPrice(MATIC_USD);
        usdc  = getPrice(USDC_USD);
    }
}
