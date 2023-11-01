//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";

/// @title ChainLink VRF consumer implementation.
/// For more details on the specific parameters: https://docs.chain.link/docs/chainlink-vrf-api-reference/#index
abstract contract ChainLinkVRF is VRFConsumerBase {
    bytes32 internal immutable _keyHash;
    uint256 internal immutable _fee;

    // ------------- Storage ------------- //
    bytes32 public requestId;
    uint256 public randomResult;

    // ------------- Events ------------- //
    event GeneratedRandomNumber(uint256 _randomResult);

    /// @notice Constructor for the contract.
    /// @param vrfCoordinator address off the ChainLinks pre-deployed VRF coordinator contract.
    /// @param link ERC20 LINK contract tokens address
    /// @param keyHash The public key against which randomness is generated.
    /// @param fee The fee, in LINK, for the request. Specified by VRF coordinator
    constructor(
        address vrfCoordinator,
        address link,
        bytes32 keyHash,
        uint256 fee
    ) VRFConsumerBase(vrfCoordinator, link) {
        _fee = fee;
        _keyHash = keyHash;
    }

    // ----- VRF overrides -----

    /// @notice Requests randomness.
    /// @return bytes32 the request ID.
    function getRandomNumber() internal returns (bytes32) {
        require(requestId == 0, "Random number can only be set once!");
        require(LINK.balanceOf(address(this)) >= _fee, "Not enough LINK - fill contract with faucet");
        requestId = requestRandomness(_keyHash, _fee);
        return requestId;
    }

    /// @notice Callback function used by VRF Coordinator.
    /// @param requestIdIncoming The randomness request ID.
    /// @param randomness The actual random number.
    function fulfillRandomness(bytes32 requestIdIncoming, uint256 randomness) internal override {
        require(requestId == requestIdIncoming, "Incorrect incoming request ID!");
        // This contract will forever be frozen at this state.
        require(randomResult == 0, "Random number can only be set once!");
        randomResult = randomness;
        emit GeneratedRandomNumber(randomness);
    }
}
