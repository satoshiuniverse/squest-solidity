//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "./GameControllerStorage.sol";
import "./IGameStarter.sol";

/// @title Logic contract for GameController.
contract GameController is GameControllerStorage, IGameStarter {
    using MerkleProof for bytes32[];

    /// @notice Constructor for the contract.
    /// @param nftAddress the address of the nft contract
    /// @param sellingController the address of the selling controller
    /// @param chainLinkVrfCoordinatorData The constructor parameters for proper usage of ChainLinks VRF contracts.
    /// @param maintainer Public key authority for card upgradeability message signing.
    constructor(
        address nftAddress,
        address sellingController,
        VRFCoordinatorConstructor memory chainLinkVrfCoordinatorData,
        address maintainer
    ) GameControllerStorage(nftAddress, chainLinkVrfCoordinatorData, sellingController, maintainer) {}

    /// @notice Card revealing method. Can only be ued once the revealing period has started.
    /// @param proof array of bytearrays to reconstruct the Merkle Root.
    /// @param cardId the NFT ID within the NFT contract.
    /// @param cid the new IPFS CID.
    /// @param cardDna The card specific DNA that describes its attributes.
    /// @dev Reconstruct the card hash from the passed params and make sure that we can reconstruct the Merkle Root.
    function revealCard(
        bytes32[] calldata proof, // Card-specific proof
        uint256 cardId,
        string calldata cid,
        uint256 cardDna
    ) external whenRevealEnabled onlyOwnerOf(cardId) {
        require(getDna(cardId) == 0, "Card has already been revealed!");

        bytes32 computedHash = revealHash(cardDna, cardId, cid);
        bool validReveal = proof.verify(_cardRevealMerkleRoot, computedHash);
        require(validReveal, "The card data has been tampered with!");

        nft.updateURI(cardId, cid);
        _dnaMapping[cardId] = cardDna;
        emit DnaUpdated(cardId, cardDna, cid);
    }

    /// @notice Card upgrading method. Can only be used after the upgrade period has started.
    /// @param maintainerSignedMsg The message signed by the `maintainer`.
    /// @param upgradeParams The data used to reconstruct the message, necessary to validate signature.
    /// @dev Using EIP712 signatures.
    function upgradeCard(bytes calldata maintainerSignedMsg, UpgradeParams calldata upgradeParams)
        external
        whenCardUpgradeEnabled
        onlyOwnerOfRevealedCard(upgradeParams.primaryCardId)
        onlyOwnerOfRevealedCard(upgradeParams.secondaryCardId)
        onlyUniqueMessage(maintainerSignedMsg)
    {
        _verifiedMessages[maintainerSignedMsg] = true;
        // Hash the message
        bytes32 digest = _hashTypedDataV4(keccak256(constructUpgradeMessage(upgradeParams)));

        // verify the message
        require(_maintainer == ECDSA.recover(digest, maintainerSignedMsg), "Maintainer did not sign this message!");

        // Update token uris
        nft.updateURI(upgradeParams.primaryCardId, upgradeParams.newCID);
        _dnaMapping[upgradeParams.primaryCardId] = upgradeParams.newDna;
        emit DnaUpdated(upgradeParams.primaryCardId, upgradeParams.newDna, upgradeParams.newCID);
    }

    /// @notice Find satoshi method. Can only be used after the upgrade period has started. Will mint new cards for the sender!
    /// @param maintainerSignedMsg The message signed by the `maintainer`.
    /// @param findSatoshiParams The data used to reconstruct the message, necessary to validate signature.
    /// @dev Using EIP712 signatures.
    function findSatoshi(bytes calldata maintainerSignedMsg, FindSatoshiParams calldata findSatoshiParams)
        external
        whenCardUpgradeEnabled
        onlyOwnerOfRevealedCard(findSatoshiParams.freakCardId)
        onlyOwnerOfRevealedCard(findSatoshiParams.geekCardId)
        onlyOwnerOfRevealedCard(findSatoshiParams.hackerCardId)
        onlyOwnerOfRevealedCard(findSatoshiParams.slackerCardId)
        onlyUniqueMessage(maintainerSignedMsg)
    {
        // Because there can be multiple ways that can result in the final ending,
        // we instead make sure that an ending hero gets unlocked only once!
        // But because we can unlock multiple cards at once, we make sure that
        // each of them gets revealed only once!
        for (uint256 i = 0; i < findSatoshiParams.newCardsDnas.length; i++) {
            bytes memory dnaAsBytes = abi.encodePacked(findSatoshiParams.newCardsDnas[i]);
            require(!_verifiedMessages[dnaAsBytes], "This ending has already been revealed!");
            _verifiedMessages[dnaAsBytes] = true;
        }
        _verifiedMessages[maintainerSignedMsg] = true;

        // Hash the message
        bytes32 digest = _hashTypedDataV4(keccak256(constructFindSatoshiMessage(findSatoshiParams)));
        // verify the message
        require(_maintainer == ECDSA.recover(digest, maintainerSignedMsg), "Maintainer did not sign this message!");

        // Mint new cards
        uint256[] memory cardIds = nft.mintBatch(findSatoshiParams.newCardsCids.length, msg.sender);

        // Set the DNA and IPFS CID
        for (uint256 i = 0; i < cardIds.length; i++) {
            uint256 cardId = cardIds[i];
            string memory newCid = findSatoshiParams.newCardsCids[i];
            uint256 newDna = findSatoshiParams.newCardsDnas[i];

            nft.updateURI(cardId, newCid);
            _dnaMapping[cardId] = newDna;
            emit DnaUpdated(cardId, newDna, newCid);
        }
    }

    /// @notice Implement IGameStarter.startGame() method.
    /// @dev Must be called by the SellingController, once it's finished the selling period.
    /// @dev this contract must own the required amount of LINK tokens for the ChainLink VRF call.
    function startGame() external override returns (bool) {
        require(msg.sender == _sellingController, "Only the token seller contract can initiate the game!");
        // Request the random number from ChainLink.
        getRandomNumber();
        gameStartedAtTimestamp = block.timestamp;
        return true; // This signifies that everything has went well back to the `SellingController`.
    }

    /// @notice Retry randomness call. Call this method manually.
    /// @dev Use only if something had gone wrong with the original `getRandomNumber()` call via `startGame()`.
    function retryRandomness() external onlyOwner {
        require(
            nft.getController() == address(this),
            "Can only call after game controller becomes the controller of NFTs!"
        );
        require(requestId != 0, "The ChainLink request has never been dispatched!");
        require(randomResult == 0, "Random number can only be set once!");
        requestId = 0;
        getRandomNumber();
    }

    /// @notice Force a deterministic random number. Can only be used after a certain threshold.
    /// @dev ChainLink is asynchronous in its nature and we don't have guarantees when and if it will ever reply with a random number
    /// @dev this method can only be used after a threshold has been reached since the `startGame()` call.
    /// @dev This only acts as a fallback (last resort) to unblock the game if ChainLink failed.
    function overrideRandomNumber() external onlyOwner {
        uint256 secondsSinceGameStartedCall = 10800; // ~3h
        require(
            gameStartedAtTimestamp + secondsSinceGameStartedCall < uint32(block.timestamp),
            "Can only be executed after enough time had passed!"
        );
        // Use the previous blocks blockhash as the random number (current blockhash is not known)
        uint256 customRandomNumber = uint256(blockhash(block.number - 1));
        fulfillRandomness(requestId, customRandomNumber);

        // Clear slot, get back some ether
        gameStartedAtTimestamp = 0;
    }
}
