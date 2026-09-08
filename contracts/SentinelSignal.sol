// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract SentinelSignal {
    address public immutable owner;
    address public           sentinel;

    struct Signal {
        bytes32 commitment;
        uint256 blockNumber;
        uint256 minProfit;
        uint256 actualProfit;
        bool    executed;
        bool    revealed;
    }

    mapping(bytes32 => Signal) public signals;
    bytes32[] public signalIds;

    uint256 public totalSignals;
    uint256 public executedSignals;
    uint256 public totalProfitSignalled;

    event Committed(bytes32 indexed id, uint256 blockNumber, uint256 minProfit);
    event Revealed(bytes32 indexed id, uint256 actualProfit);
    event Missed(bytes32 indexed id);

    modifier onlyAuth() {
        require(msg.sender == owner || msg.sender == sentinel, "SIG:!auth");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SIG:!owner");
        _;
    }

    constructor() { owner = msg.sender; }
    function setSentinel(address _s) external onlyOwner { sentinel = _s; }

    function commit(bytes32 id, bytes32 commitment, uint256 minProfit) external onlyAuth {
        signals[id] = Signal({
            commitment:   commitment,
            blockNumber:  block.number,
            minProfit:    minProfit,
            actualProfit: 0,
            executed:     false,
            revealed:     false
        });
        signalIds.push(id);
        totalSignals++;
        emit Committed(id, block.number, minProfit);
    }

    function reveal(bytes32 id, uint256 actualProfit) external onlyAuth {
        Signal storage s = signals[id];
        require(!s.revealed, "SIG:revealed");
        s.revealed     = true;
        s.executed     = actualProfit >= s.minProfit;
        s.actualProfit = actualProfit;
        if (s.executed) {
            executedSignals++;
            totalProfitSignalled += actualProfit;
            emit Revealed(id, actualProfit);
        } else {
            emit Missed(id);
        }
    }

    function landingRate() external view returns (uint256) {
        if (totalSignals == 0) return 0;
        return (executedSignals * 10000) / totalSignals;
    }
}
