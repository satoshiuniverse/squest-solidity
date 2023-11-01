//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "./NFT.sol";
import "./ChainLinkVRF.sol";
import "./TokenRecoverable.sol";
import "./IDnaProvider.sol";

/// @title Storage contract for GameController
abstract contract GameControllerStorage is TokenRecoverable, ERC165, EIP712, ChainLinkVRF, IDnaProvider {
    // ------------- Structs ------------- //
    struct VRFCoordinatorConstructor {
        address vrfCoordinator;
        address link;
        bytes32 keyHash;
        uint256 fee;
    }

    // Card upgrading
    struct UpgradeParams {
        uint256 primaryCardId;
        uint256 secondaryCardId;
        uint256 newDna;
        string newCID;
    }

    // Finding Satoshi
    struct FindSatoshiParams {
        uint256 freakCardId;
        uint256 geekCardId;
        uint256 slackerCardId;
        uint256 hackerCardId;
        string[] newCardsCids;
        uint256[] newCardsDnas;
    }

    // EIP712 message type hash.
    bytes32 private constant UPGRADE_TYPE_HASH =
        keccak256("UpgradeParams(uint256 primaryCardId,uint256 secondaryCardId,uint256 newDna,string newCID)");

    bytes32 private constant FIND_SATOSHI_TYPE_HASH =
        keccak256(
            "FindSatoshiParams(uint256 freakCardId,uint256 geekCardId,uint256 slackerCardId,uint256 hackerCardId,string[] newCardsCids,uint256[] newCardsDnas)"
        );

    NFT public immutable nft; // NFT contract
    address internal immutable _sellingController; // SellingController contract
    uint32 public immutable createdAt;

    // ------------- Storage ------------- //
    // tokenId => dna
    mapping(uint256 => uint256) internal _dnaMapping;
    // Upgrade messages being verified
    mapping(bytes => bool) internal _verifiedMessages;

    // --- Slot start ---
    bytes32 internal _cardRevealMerkleRoot; // 256 bits
    // --- Slot end ---

    // --- Slot start ---
    uint256 internal gameStartedAtTimestamp; // 256 bits
    // --- Slot end ---

    // --- Slot start ---
    address internal _maintainer; // 20 bytes -> 160bits
    bool private _cardUpgradeEnabled = false; // 8 bits
    // leftover 88 bits
    // --- Slot end ---

    // ------------- Events ------------- //
    event DnaUpdated(uint256 tokenID, uint256 newDna, string newCID);
    event CardRevealMerkleRootUpdated(bytes32 merkleRoot);
    event MaintenanceTransferred(address maintainer, address newMaintainer);
    event CardUpgradesEnabled();

    // ------------- Modifiers ------------- //
    /// @notice Make sure that the card revealing part of the game can start.
    modifier whenRevealEnabled() {
        require(isCardRevealEnabled(), "The `reveals` functionality has not yet been enabled!");
        _;
    }

    /// @notice Make sure that the card upgradeability part of the game can start.
    modifier whenCardUpgradeEnabled() {
        require(_cardUpgradeEnabled, "The `upgrades` functionality has not yet been enabled!");
        _;
    }

    /// @notice Make sure the caller is owner of the card.
    /// @param cardId the token id within the NFT contract.
    modifier onlyOwnerOf(uint256 cardId) {
        require(nft.ownerOf(cardId) == msg.sender, "Only owner can use this token!");
        _;
    }

    modifier onlyOwnerOfRevealedCard(uint256 cardId) {
        require(nft.ownerOf(cardId) == msg.sender, "Only owner can use this token!");
        require(getDna(cardId) != 0, "Card needs to be revealed!");
        _;
    }

    modifier onlyUniqueMessage(bytes calldata signedMessage) {
        require(!_verifiedMessages[signedMessage], "This message has already been executed!");
        _;
    }

    /// @notice Constructor for the contract.
    /// @param nftAddress the address of the nft contract.
    /// @param chainLinkVrfParams The constructor parameters for proper usage of ChainLinks VRF contracts.
    /// @param sellingController the address of the selling controller.
    /// @param maintainer Public key authority for card upgradeability message signing.
    constructor(
        address nftAddress,
        VRFCoordinatorConstructor memory chainLinkVrfParams,
        address sellingController,
        address maintainer
    )
        ChainLinkVRF(
            chainLinkVrfParams.vrfCoordinator,
            chainLinkVrfParams.link,
            chainLinkVrfParams.keyHash,
            chainLinkVrfParams.fee
        )
        EIP712("SatoshiQuest WebApp", "v1")
    {
        require(nftAddress != address(0), "NFT address is zero address");
        require(sellingController != address(0), "SellingController is zero address");
        require(maintainer != address(0), "Maintainer is zero address");

        nft = NFT(nftAddress);
        _sellingController = sellingController;
        _maintainer = maintainer;
        createdAt = uint32(block.number);
    }

    /// @notice Override ERC165.supportsInterface method.
    /// @dev Used for informing the SellingController that it implements `IDnaProvider` interface.
    /// @return true if the requested interface ID is supported
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165) returns (bool) {
        return interfaceId == type(IDnaProvider).interfaceId || ERC165.supportsInterface(interfaceId);
    }

    // ------------- Setters ------------- //
    /// @notice The contract owner can set the expected merkle root for card validation.
    /// @param merkleRoot the MerkleRooot that will be used for card revealing validation.
    function setCardMerkleRootReveal(bytes32 merkleRoot) external onlyOwner {
        // If the merkle root can be altered on the whim, then there's no
        // guarantee for the tokens to actually be persistent. Therefore we lock it!
        require(_cardRevealMerkleRoot == "", "Merkle root for reveals can only be set once!");
        require(randomResult != 0, "The random seed is not known yet!");

        _cardRevealMerkleRoot = merkleRoot;
        emit CardRevealMerkleRootUpdated(merkleRoot);
    }

    /// @notice Set the maintainer that will have the authority to sign card upgrade messages.
    /// @dev in practice the private key is only known by the backend.
    function setMaintainer(address maintainer) external onlyOwner {
        emit MaintenanceTransferred(_maintainer, maintainer);
        _maintainer = maintainer;
    }

    // ------------- Getters ------------- //
    /// @notice Get the Merkle root for card reveals.
    /// @return bytes32 merkle root.
    function getCardRevealMerkleRoot() external view returns (bytes32) {
        return _cardRevealMerkleRoot;
    }

    function isCardRevealEnabled() public view returns (bool) {
        return _cardRevealMerkleRoot != "";
    }

    function isCardUpgradeEnabled() external view returns (bool) {
        return _cardUpgradeEnabled;
    }

    /// @notice Get the maintainers address.
    /// @return the maintainers address.
    function getMaintainer() external view returns (address) {
        return _maintainer;
    }

    /// @notice get the DNA of a token (implementation fo the IDnaProvider).
    /// @param tokenId the token id from the NFT contract.
    /// @return the token DNA.
    function getDna(uint256 tokenId) public view override returns (uint256) {
        return _dnaMapping[tokenId];
    }

    /// @notice Start the upgrades period.
    function enableCardUpgrades() external onlyOwner {
        require(!_cardUpgradeEnabled, "Upgrades already started");
        _cardUpgradeEnabled = true;
        emit CardUpgradesEnabled();
    }

    // ------------- Internal ------------- //
    /// @notice Reconstruct the card reveal hash. Used when finding Merkle Root.
    /// @return bytes32 the hash of the message.
    function revealHash(
        uint256 cardDna,
        uint256 tokenId,
        string calldata ipfsUri
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(cardDna, tokenId, ipfsUri, address(this), block.chainid));
    }

    /// @notice Reconstruct the card upgrade message without hashing.
    /// @param upgradeParams necessary data for proper message reconstruction.
    /// @dev Follows EIP712 standard.
    /// @return the newly packed message as bytes.
    function constructUpgradeMessage(UpgradeParams memory upgradeParams) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                UPGRADE_TYPE_HASH,
                upgradeParams.primaryCardId,
                upgradeParams.secondaryCardId,
                upgradeParams.newDna,
                // EIP712 expects strings to be hashed
                keccak256(bytes(upgradeParams.newCID))
            );
    }

    /// @notice Reconstruct the "find satoshi" message without hashing.
    /// @param findSatoshiParams necessary data for proper message reconstruction.
    /// @dev Follows EIP712 standard.
    /// @return the newly packed message as bytes.
    function constructFindSatoshiMessage(FindSatoshiParams memory findSatoshiParams)
        internal
        pure
        returns (bytes memory)
    {
        // EIP712 expects strings to be hashed
        bytes32[] memory cidsAsHashes = new bytes32[](findSatoshiParams.newCardsCids.length);
        for (uint256 index = 0; index < findSatoshiParams.newCardsCids.length; index++) {
            cidsAsHashes[index] = keccak256(bytes(findSatoshiParams.newCardsCids[index]));
        }
        bytes32 dnaHash = keccak256(abi.encodePacked(findSatoshiParams.newCardsDnas));
        return
            abi.encodePacked(
                FIND_SATOSHI_TYPE_HASH,
                findSatoshiParams.freakCardId,
                findSatoshiParams.geekCardId,
                findSatoshiParams.hackerCardId,
                findSatoshiParams.slackerCardId,
                keccak256(abi.encodePacked(cidsAsHashes)),
                dnaHash
            );
    }
}
