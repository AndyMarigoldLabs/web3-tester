// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Minimal test token with the CLASSIC storage layout — balances mapping at
/// slot 0, allowances at slot 1, totalSupply at slot 2 — deliberately
/// standard so chain.dealErc20 exercises the Solidity probe path against the
/// library's own artifact. mint/burn are unrestricted: this is a test
/// fixture, never deploy it anywhere value lives.
contract TestERC20 {
    mapping(address => uint256) private _balances; // slot 0
    mapping(address => mapping(address => uint256)) private _allowances; // slot 1
    uint256 private _totalSupply; // slot 2

    string public name;
    string public symbol;
    uint8 public immutable decimals;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        address mintTo_
    ) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        if (initialSupply_ > 0) {
            _mint(mintTo_, initialSupply_);
        }
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "TestERC20: insufficient allowance");
            _allowances[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function burn(address from, uint256 value) external {
        require(_balances[from] >= value, "TestERC20: burn exceeds balance");
        _balances[from] -= value;
        _totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function _mint(address to, uint256 value) private {
        _totalSupply += value;
        _balances[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) private {
        require(_balances[from] >= value, "TestERC20: transfer exceeds balance");
        _balances[from] -= value;
        _balances[to] += value;
        emit Transfer(from, to, value);
    }
}
