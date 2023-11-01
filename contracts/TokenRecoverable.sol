//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Recover ERC20 tokens and send them back.
contract TokenRecoverable is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Send ERC20 tokens to an address.
    /// Lets assume that a user has mistakingly sent his ERC20 tokens instead of
    /// ETH to our contract. To help him out, the contract owner can send back the tokens.
    function recoverTokens(
        IERC20 token,
        address to,
        uint256 amount
    ) public onlyOwner {
        token.safeTransfer(to, amount);
    }
}
