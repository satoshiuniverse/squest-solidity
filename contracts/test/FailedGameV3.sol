//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../IGameStarter.sol";
import "../IDnaProvider.sol";
import "../NFT.sol";

/// @title GameController mock for testing.
contract FailedGameV3 is IGameStarter, IDnaProvider, ERC165, Ownable {
    function startGame() external pure override returns (bool) {
        return true;
    }

    function getDna(uint256) external pure override returns (uint256) {
        return 123;
    }

    function retrieveOwnedContract(NFT contractItem) external onlyOwner {
        contractItem.transferController(msg.sender);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165) returns (bool) {
        return interfaceId == type(IDnaProvider).interfaceId || ERC165.supportsInterface(interfaceId);
    }
}
