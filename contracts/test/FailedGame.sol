//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../IGameStarter.sol";
import "../IDnaProvider.sol";

/// @title GameController mock for testing.
/// @notice This contract is supposed to trigger exceptions on `startGame()` call.
contract FailedGame is IGameStarter, IDnaProvider, ERC165 {
    function startGame() external pure override returns (bool) {
        return false;
    }

    function getDna(uint256) external pure override returns (uint256) {
        return 123;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165) returns (bool) {
        return interfaceId == type(IDnaProvider).interfaceId || ERC165.supportsInterface(interfaceId);
    }
}
