//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../IGameStarter.sol";

/// @title GameController mock for testing.
/// @notice This contract is supposed to trigger exceptions, because it does not implement `IDnaProvider`.
contract FailedGameV2 is IGameStarter, ERC165 {
    function startGame() external pure override returns (bool) {
        return true;
    }
}
