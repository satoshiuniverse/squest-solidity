// SPDX-License-Identifier: MIT
pragma solidity ^0.8;

// COMPLETE COPY OF CHAINLINKs `LinkERC20`, but with an altered solidity version.

/**
    Our project uses Solidity ^0.8 contracts, but @chainlink/token provides only
    Solidity 0.6.6 version of the LinkToken, which is incompatible with our
    common openzeppelin dependencies. (npm cannot handle two versions of the
    same package).
 */
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract ERC677 is IERC20 {
    function transferAndCall(
        address to,
        uint256 value,
        bytes memory data
    ) public virtual returns (bool success);

    event Transfer(address indexed from, address indexed to, uint256 value, bytes data);
}

abstract contract ERC677Receiver {
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes memory _data
    ) public virtual;
}

abstract contract ERC677Token is ERC20, ERC677 {
    /**
     * @dev transfer token to a contract address with additional data if the recipient is a contact.
     * @param _to The address to transfer to.
     * @param _value The amount to be transferred.
     * @param _data The extra data to be passed to the receiving contract.
     */
    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) public virtual override returns (bool success) {
        super.transfer(_to, _value);
        emit Transfer(msg.sender, _to, _value, _data);
        if (isContract(_to)) {
            contractFallback(_to, _value, _data);
        }
        return true;
    }

    // PRIVATE

    function contractFallback(
        address _to,
        uint256 _value,
        bytes memory _data
    ) private {
        ERC677Receiver receiver = ERC677Receiver(_to);
        receiver.onTokenTransfer(msg.sender, _value, _data);
    }

    function isContract(address _addr) private view returns (bool hasCode) {
        uint256 length;
        assembly {
            length := extcodesize(_addr)
        }
        return length > 0;
    }
}

abstract contract LinkERC20 is ERC20 {
    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function increaseApproval(address spender, uint256 addedValue) public virtual returns (bool) {
        return super.increaseAllowance(spender, addedValue);
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     */
    function decreaseApproval(address spender, uint256 subtractedValue) public virtual returns (bool) {
        return super.decreaseAllowance(spender, subtractedValue);
    }
}

contract LinkToken is LinkERC20, ERC677Token {
    uint256 private constant TOTAL_SUPPLY = 10**27;
    string private constant NAME = "ChainLink Token";
    string private constant SYMBOL = "LINK";

    constructor() public ERC20(NAME, SYMBOL) {
        _onCreate();
    }

    /**
     * @dev Hook that is called when this contract is created.
     * Useful to override constructor behaviour in child contracts (e.g., LINK bridge tokens).
     * @notice Default implementation mints 10**27 tokens to msg.sender
     */
    function _onCreate() internal virtual {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     */
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual override validAddress(recipient) {
        super._transfer(sender, recipient, amount);
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the `owner`s tokens.
     *
     * This is internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override validAddress(spender) {
        super._approve(owner, spender, amount);
    }

    // MODIFIERS

    modifier validAddress(address _recipient) {
        require(_recipient != address(this), "LinkToken: transfer/approve to this contract address");
        _;
    }
}
