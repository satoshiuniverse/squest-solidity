//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./SellingControllerStorage.sol";
import "./IGameStarter.sol";
import "./IDnaProvider.sol";

/// @title ERC721 Selling controller.
/// @notice Sell cards at a given price for a given threshold, manage whitelists and vaults.
contract SellingController is SellingControllerStorage {
    /// @notice Constructor for the contract.
    /// @param defaultCardCID the CID of the card back IPFS URI.
    /// @param phases an array of all sequential phases for dynamic price changes.
    /// @dev phases - every next phase needs to have a larger threshold than the previous one.
    /// @dev phases - Cannot handle more than 254 phases, because `phaseIndex` is an uint8.
    /// @param vault Initial vault (money receiver)
    /// @param maintainer Initial maintainer (whitelist manager)
    /// @param nftOwner initial owner of the NFT contract
    /// @param whitelistedAddressCap The very maximum amount of cards that a single whitelisted user can gen
    /// @dev whitelistedAddressCap - necessary for extra hash clash protection: a sanity check
    /// @param whitelistCap The total amount of cards that (NON PARTNER) whitelisted users can get (shared amount)
    /// @param whitelistMerkleRoot whitelist merkle root
    /// @param sellingLaunch Defines the time when the selling will be
    /// @dev sellingLaunch - UNIX timestamp in seconds UTC time
    constructor(
        string memory defaultCardCID,
        Phase[] memory phases,
        address payable vault,
        address maintainer,
        address nftOwner,
        uint256 whitelistedAddressCap,
        uint32 whitelistCap,
        bytes32 whitelistMerkleRoot,
        uint32 sellingLaunch
    )
        SellingControllerStorage(
            defaultCardCID,
            phases,
            vault,
            maintainer,
            nftOwner,
            whitelistMerkleRoot,
            whitelistedAddressCap,
            whitelistCap,
            sellingLaunch
        )
    {}

    /// @notice Buy cards when whitelist has been disabled.
    /// @notice if whitelist is enabled, then only whitelisted addresses can perform this action.
    /// @notice works only as long as the selling period is enabled.
    receive() external payable whenSellingLaunched whenSellingNotStopped {
        require(!whitelistEnabled, "Whitelist enabled: use `buyCards()`!");
        Phase storage currentPhase = _phases[phaseIndex];
        uint256 countToMint = calculateCountToMint(currentPhase.price, msg.value);
        receiveAndMint(countToMint, currentPhase.threshold);
    }

    /// @notice Buy cards while the whitelisting period is enabled
    /// @param proof Merkle proof for the whitelisted entry
    /// @param startingCap The amount of tokens that the user was allowed to mint
    function buyCards(
        bytes32[] calldata proof,
        uint256 startingCap,
        bool partner
    ) external payable whenSellingLaunched whenSellingNotStopped {
        Phase storage currentPhase = _phases[phaseIndex];
        uint256 countToMint = calculateCountToMint(currentPhase.price, msg.value);

        if (whitelistEnabled) {
            bytes32 computedHash = keccak256(abi.encodePacked(msg.sender, block.chainid, startingCap, partner));
            bool isWhitelisted = MerkleProof.verify(proof, _whitelistMerkleRoot, computedHash);
            require(isWhitelisted, "Address is not on the whitelist!");
            require(partner || _whitelistCap >= countToMint, "Reached whitelist token cap");

            if (!getWhitelistEntry(msg.sender).approved) {
                // Safety measure for hash clashing!
                require(startingCap <= _whitelistedAddressCap, "Whitelist cap exceeds the max allowed one!");
                // User is whitelisted but he's not stored in our internal records. Save initial info!
                whitelistAllowance[msg.sender] = WhitelistEntry(true, uint248(startingCap));
            }
            // If whitelist is enabled, decrease the allowance for a given address.
            whitelistDecreaseAllowance(msg.sender, uint248(countToMint));
            if (!partner) {
                _whitelistCap -= uint32(countToMint);
            }
        }

        receiveAndMint(countToMint, currentPhase.threshold);
    }

    /// @notice Transfer ownership to the gameControllers address and call the `startGame` method.
    function startGame(address gameController) external onlyOwner whenSellingStopped {
        require(
            IERC165(gameController).supportsInterface(type(IDnaProvider).interfaceId),
            "The game controller must implement `IDnaProvider`!"
        );
        nftToken.transferController(gameController);
        require(IGameStarter(gameController).startGame(), "Game cannot be started!");
        emit GameStarted();
    }

    /// @notice Stops the selling period altogether.
    /// @dev Increase the selling phase to an invalid one.
    function forceStopSelling() external onlyOwner {
        stopSelling();
    }

    /// @notice Mint cards, advance phase index, forward ether to vault.
    /// @param countToMint the amount of cards that are to be minted.
    /// @param currentThreshold the threshold of the current Phase.
    /// @dev will shift the phases if necessary (if the threshold had been reached).
    /// @dev will alter the whitelisted addresses allowance (if necessary).
    function receiveAndMint(uint256 countToMint, uint256 currentThreshold) internal {
        uint256 currentTokenSupply = nftToken.totalSupply();
        uint248 lastThresholdPhase = _phases[_phases.length - 1].threshold;
        uint256 newTokenSupply = currentTokenSupply + countToMint;
        require(
            newTokenSupply <= lastThresholdPhase, // NEVER exceed the threshold for the last phase!
            "Cannot buy more cards than total supply allows!"
        );

        // award items
        nftToken.mintBatch(countToMint, msg.sender); // By default the card is non-revealed
        forwardEther();

        // Skip if we have not reached the threshold of the current phase
        if (newTokenSupply < currentThreshold) return;

        // check if we sold last token
        if (newTokenSupply == lastThresholdPhase) {
            stopSelling();
            return;
        }

        // Handle multiple phase shifts
        for (uint256 index = phaseIndex; index < _phases.length; index++) {
            if (newTokenSupply < _phases[index].threshold) return;
            // Check if we're surpassing the next phase as well
            phaseIndex++;
            emit NextPhaseStarted(_phases[phaseIndex]);
        }
    }

    /// @notice Calculate how many cards to mint based on card price and sent ether amount
    /// @param price the price for a single card
    /// @param value the amount of ether being sent
    /// @dev will throw if there's excess wei
    /// @return the amount of cards to mint
    function calculateCountToMint(uint256 price, uint256 value) internal pure returns (uint256) {
        require(value >= price, "Not enough funds!");

        uint256 excessWei = value % price;
        require(excessWei == 0, "Leftover wei when buying cards, aborting!");

        return value / price;
    }

    /// @notice Forward received ether
    /// @dev Will forward the ether to the `vault` address
    function forwardEther() internal {
        (bool success, ) = _vault.call{value: msg.value, gas: 10000}("");
        require(success, "Address: unable to send value, recipient may have reverted");
    }
}
