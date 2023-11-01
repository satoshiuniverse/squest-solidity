//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./NFT.sol";
import "./IGameStarter.sol";
import "./TokenRecoverable.sol";

/// @title Storage contract for SellingController
abstract contract SellingControllerStorage is TokenRecoverable, ERC165 {
    // ------------- Structs ------------- //
    // Represents a single phase and the max token threshold for it to be valid.
    struct Phase {
        uint224 price;
        // The value is inclusive - (x..y].
        uint32 threshold; // measured in cards sold. This is an accumulative value.
    }

    // Represents a single whitelist entry
    struct WhitelistEntry {
        // Used for distinguishing users that are approved in the whitelist but
        // have used up all of their allowance.
        bool approved; // 8bits
        // The amount of cards that the given user is allowed to buy.
        uint248 allowance; //  248 bits
    }

    // ------------- Storage ------------- //
    // The next phase in the array always needs to have a larger threshold than
    // the previous phase!
    Phase[] internal _phases;
    NFT public immutable nftToken;
    bytes32 internal immutable _whitelistMerkleRoot;
    uint256 internal immutable _whitelistedAddressCap; // guard for whitelist cap hashing
    uint32 internal immutable _sellingLaunch;
    uint32 public immutable createdAt;

    // Keep track of whitelisted addresses and how many cards have they bought.
    mapping(address => WhitelistEntry) public whitelistAllowance;

    // --- Slot start ---
    address payable internal _vault; // 20 bytes -> 160bits
    uint8 public phaseIndex; // 8  bits
    bool public whitelistEnabled; // 8 bits
    uint32 internal _whitelistCap; // 32 bits
    // leftover 48 bits
    // --- Slot end ---

    address internal _maintainer; // 20 bytes -> 160bits

    // ------------- Events ------------- //
    event MaintenanceTransferred(address maintainer, address newMaintainer);
    event WhitelistDisabled();
    event NextPhaseStarted(Phase phase);
    event SellingStopped();
    event GameStarted();

    // ------------- Modifiers ------------- //
    modifier onlyMaintainer() {
        require(msg.sender == _maintainer, "Only the maintainer can access this method!");
        _;
    }

    /// @notice Make sure the given index does not exceed the total amount of phases.
    /// @dev used to make sure the API is used correctly when interacting with the phases.
    modifier noLeakyPhases(uint8 index) {
        require(index < _phases.length, "Exceeded phase length!");
        _;
    }

    modifier whenSellingStopped() {
        require(isSellingStopped(), "Selling has not been stopped!");
        _;
    }

    modifier whenSellingNotStopped() {
        require(!isSellingStopped(), "Selling has been stopped!");
        _;
    }

    modifier whenSellingLaunched() {
        require(_sellingLaunch <= block.timestamp, "Selling is not launched yet!");
        _;
    }

    /// @notice Constructor for the contract.
    /// @param defaultCardCID the CID of the card back IPFS URI.
    /// @param phases an array of all sequential phases for dynamic price changes..
    /// @dev phases - every next phase needs to have a larger threshold than the previous one.
    /// @dev phases - Cannot handle more than 254 phases, because `phaseIndex` is an uint8.
    /// @param vault Initial vault (money receiver).
    /// @param maintainer Initial maintainer (whitelist manager).
    /// @param accountWhitelistCap pre-determined maximum allowed whitelist cap.
    //         Used for hash clash sanity checking when validating the whitelist.
    /// @param whitelistCap token cap for whitelisted addresses
    constructor(
        string memory defaultCardCID,
        Phase[] memory phases,
        address payable vault,
        address maintainer,
        address nftOwner,
        bytes32 whitelistMerkleRoot,
        uint256 whitelistedAddressCap,
        uint32 whitelistCap,
        uint32 sellingLaunch
    ) Ownable() {
        // Must handle `phases.length + 1` amount of phases. (+1 because that
        // indicates an invalid phase - gets set when selling period ends).
        require(type(uint8).max > phases.length, "Contract cannot handle this many phases!");
        require(vault != address(0), "Invalid vault address!");
        require(maintainer != address(0), "Invalid maintainer address!");

        // Make sure that phase thresholds are consequentially incrementing
        uint32 previousThreshold = 0;
        for (uint256 index = 0; index < phases.length; index++) {
            _phases.push(phases[index]);
            require(
                previousThreshold < phases[index].threshold,
                "Phase thresholds must be consequentially incrementing!"
            );
            previousThreshold = phases[index].threshold;
        }
        createdAt = uint32(block.number);
        nftToken = new NFT(defaultCardCID, nftOwner);

        _vault = vault;
        _maintainer = maintainer;
        whitelistEnabled = true; // Whitelist is enabled by default!
        _whitelistMerkleRoot = whitelistMerkleRoot;
        _whitelistedAddressCap = whitelistedAddressCap;
        _whitelistCap = whitelistCap;
        _sellingLaunch = sellingLaunch;

        emit MaintenanceTransferred(address(0), maintainer);
        emit NextPhaseStarted(phases[0]);
    }

    // ------------- Setters ------------- //
    /// @notice Set a new vault (address where eth gets redirected).
    /// @param vault the new vault.
    function setVault(address payable vault) external onlyOwner {
        _vault = vault;
    }

    /// @notice Disable the whitelist.
    function disableWhitelist() external onlyMaintainer {
        whitelistEnabled = false;
        emit WhitelistDisabled();
    }

    /// @notice Set a new maintainer.
    /// @param newMaintainer the new maintainer.
    function setMaintainer(address newMaintainer) external onlyOwner {
        emit MaintenanceTransferred(_maintainer, newMaintainer);
        _maintainer = newMaintainer;
    }

    // ------------- Getters ------------- //
    /// @notice The price of the cards for the given phase.
    /// @dev Will throw in case when an invalid phase index gets passed.
    /// @param index the phase index.
    /// @return The price of the cards for the given phase.
    function getPhasePrice(uint8 index) external view noLeakyPhases(index) returns (uint224) {
        return _phases[index].price;
    }

    /// @notice The phase threshold is defined by the max allowed of cards for a given phase.
    /// @dev Will throw in case when an invalid phase index gets passed.
    /// @param index the phase index.
    /// @return The max amount of cards that define the current phase.
    function getPhaseThreshold(uint8 index) external view noLeakyPhases(index) returns (uint32) {
        return _phases[index].threshold;
    }

    /// @notice The total amount of possible phases for the contract.
    /// @return The phase count.
    function getPhaseCount() external view returns (uint256) {
        return _phases.length;
    }

    /// @notice Get the vault of the contract.
    /// @return address of the vault.
    function getVault() external view returns (address) {
        return _vault;
    }

    /// @notice Get the maintainers address.
    /// @return address of the owner.
    function getMaintainer() external view returns (address) {
        return _maintainer;
    }

    /// @notice Get whitelisted address token cap
    /// @return Token count
    function getWhitelistCap() external view returns (uint32) {
        return _whitelistCap;
    }

    // ------------- Internal ------------- //
    /// @notice Check if an address is inside the whitelist.
    /// @param toCheck Addresses to check.
    /// @return `WhitelistEntry` for a given address.
    function getWhitelistEntry(address toCheck) public view returns (WhitelistEntry memory) {
        return whitelistAllowance[toCheck];
    }

    // ------------- Internal ------------- //
    /// @notice Decrease the amount of cards that a given whitelisted address can buy.
    /// @dev Will make sure that the whitelisted addresses allowance is not already depleted.
    /// @param account the whitelisted address on which's allowance must be decremented.
    /// @param decrementBy The amount of cards that must be decremented from the whitelisted address.
    function whitelistDecreaseAllowance(address account, uint248 decrementBy) internal {
        // Make sure that a user is not buying more cards than initially permitted!
        uint248 allowance = whitelistAllowance[account].allowance;

        require(allowance >= decrementBy, "Cannot buy more cards than permitted!");
        whitelistAllowance[account].allowance = allowance - decrementBy;
    }

    /// @notice Stop selling, internal.
    /// @dev Supposed to set clear distinction between the cause and action.
    function stopSelling() internal {
        phaseIndex = uint8(_phases.length);
        emit SellingStopped();
    }

    /// @notice Determine if card selling period has ended.
    /// @return true if selling period is stopped.
    /// @dev checked by validating that our phase index has reached an invalid state.
    function isSellingStopped() public view returns (bool) {
        return phaseIndex >= _phases.length;
    }
}
