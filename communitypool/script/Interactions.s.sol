// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Script, console} from "forge-std/Script.sol";
import {DevOpsTools} from "foundry-devops/src/DevOpsTools.sol";
import {CommunityPool} from "../src/CommunityPool.sol";

contract FundCommunityPool is Script {
    uint256 public constant SEND_VALUE = 0.01 ether;

    /// @dev Call inside `vm.startBroadcast(...)` (or use `run()`).
    function fundCommunityPool(address poolAddress) public {
        CommunityPool(payable(poolAddress)).fund{value: SEND_VALUE}();
    }

    function run() external {
        vm.startBroadcast();
        address latest = DevOpsTools.get_most_recent_deployment("CommunityPool", block.chainid);
        fundCommunityPool(latest);
        vm.stopBroadcast();
        console.log("FundCommunityPool run complete");
    }
}

contract WithdrawCommunityPool is Script {
    /// @dev Call inside `vm.startBroadcast(...)` (or use `run()`). Caller must be a pool owner.
    function withdrawCommunityPool(address poolAddress) public {
        CommunityPool(payable(poolAddress)).cheaperWithdraw();
    }

    function run() external {
        vm.startBroadcast();
        address latest = DevOpsTools.get_most_recent_deployment("CommunityPool", block.chainid);
        withdrawCommunityPool(latest);
        vm.stopBroadcast();
        console.log("WithdrawCommunityPool run complete");
    }
}
