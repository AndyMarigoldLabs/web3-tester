// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Test-only fixture emulating Vyper's HashMap layout in Solidity: balances
/// live at keccak256(abi.encode(uint256(slot), address(holder))) — the
/// reversed hash order dealErc20's Vyper probe must discover. Never shipped.
contract VyperLayoutToken {
    uint256 private _totalSupply; // slot 0; balances hash from base 7 below

    string public constant name = "Vyper Layout Token";
    string public constant symbol = "VYP";
    uint8 public constant decimals = 18;

    event Transfer(address indexed from, address indexed to, uint256 value);

    uint256 private constant BALANCE_BASE = 7;

    function _slot(address account) private pure returns (bytes32) {
        return keccak256(abi.encode(BALANCE_BASE, account));
    }

    function balanceOf(address account) external view returns (uint256 value) {
        bytes32 slot = _slot(account);
        assembly {
            value := sload(slot)
        }
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function mint(address to, uint256 value) external {
        bytes32 slot = _slot(to);
        uint256 current;
        assembly {
            current := sload(slot)
        }
        current += value;
        assembly {
            sstore(slot, current)
        }
        _totalSupply += value;
        emit Transfer(address(0), to, value);
    }
}

/// Test-only fixture whose balanceOf is COMPUTED (shares * 2), so no storage
/// write can make balanceOf echo the probe sentinel — dealErc20 must fail
/// with Erc20DealError and leave storage untouched. Models rebasing/shares
/// tokens (stETH, aTokens). Never shipped.
contract SharesToken {
    mapping(address => uint256) private _shares; // slot 0

    string public constant name = "Shares Token";
    string public constant symbol = "SHR";
    uint8 public constant decimals = 18;

    function balanceOf(address account) external view returns (uint256) {
        return _shares[account] * 2;
    }

    function sharesOf(address account) external view returns (uint256) {
        return _shares[account];
    }

    function totalSupply() external view returns (uint256) {
        return 0;
    }

    function mintShares(address to, uint256 shares) external {
        _shares[to] += shares;
    }
}
