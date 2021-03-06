// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./BalanceHolder.sol";
import "./IOps.sol";

contract AccountManager is Ownable {
    mapping(address => AccountParams) public accountsParams;
    address[] public accounts;

    IUniswapV3Factory public immutable uniswapFactory;
    BalanceHolder public immutable balanceHolder;

    uint256 public constant maxSwapCost = 10**6;

    struct AccountParams {
        uint256 interval;
        uint256 nextExec;
        uint256 amount;
        uint24 poolFee;
        IERC20 sellToken;
        IERC20 buyToken;
        bool paused;
    }

    event SetUpAccount(address account, uint256 interval, uint256 amount, address sellToken, address buyToken);
    event Deposit(address account, uint256 value);
    event DeductBalance(address account, uint256 value);

    constructor(
        address autoDcaAddress, 
        IUniswapV3Factory _uniswapFactory,
        IOps _ops
    ) {
        uniswapFactory = _uniswapFactory;
        balanceHolder = new BalanceHolder(autoDcaAddress, _ops);
    }

    function setUpAccount(
        uint256 interval,
        uint256 amount,
        IERC20 sellToken,
        IERC20 buyToken
    ) external {
        uint24 poolFee = findPoolFee(sellToken, buyToken);
        AccountParams memory params = AccountParams(
            interval,
            block.timestamp + interval,
            amount,
            poolFee,
            sellToken,
            buyToken,
            false
        );
        if (!isExisting()) {
            accounts.push(msg.sender);
        }
        accountsParams[msg.sender] = params;
        emit SetUpAccount(msg.sender, interval, amount, address(sellToken), address(buyToken));
    }

    function deposit() public payable {
        require(isExisting(), "Set up an account first");
        balanceHolder.deposit{value: msg.value}(msg.sender);
        emit Deposit(msg.sender, msg.value);
    }

    function deductSwapBalance(address user, uint256 cost) external onlyOwner {
        balanceHolder.deductSwapBalance(user, cost);
        emit DeductBalance(user, cost);
    }

    function setInterval(uint256 interval) external {
        if (isExisting()) {
            accountsParams[msg.sender].interval = interval;
        } else {
            revert("Account does not exists yet");
        }
    }

    function setAmount(uint256 amount) external {
        if (isExisting()) {
            accountsParams[msg.sender].amount = amount;
        } else {
            revert("Account does not exists yet");
        }
    }

    function setSellToken(IERC20 token) external {
        if (isExisting()) {
            accountsParams[msg.sender].sellToken = token;
        } else {
            revert("Account does not exists yet");
        }
    }

    function setBuyToken(IERC20 token) external {
        if (isExisting()) {
            accountsParams[msg.sender].buyToken = token;
        } else {
            revert("Account does not exists yet");
        }
    }

    function setNextExec(address user) external onlyOwner {
        accountsParams[user].nextExec += accountsParams[user].interval;
    }

    function setPause() external {
        if (isExisting()) {
            accountsParams[msg.sender].paused = true;
        } else {
            revert("Account does not exists yet");
        }
    }

    function setUnpause() external {
        if (isExisting()) {
            accountsParams[msg.sender].paused = false;
        } else {
            revert("Account does not exists yet");
        }
    }

    function getUserNeedExec() external view returns (address user) {
        for (uint256 i; i < accounts.length; i++) {
            AccountParams memory account = accountsParams[accounts[i]];
            bool execTime = isExecTime(accounts[i]);
            bool transactable = isTransactable(accounts[i]);
            bool spendable = isSpendable(accounts[i], account.sellToken, account.amount);
            if (execTime && transactable && spendable) {
                user = accounts[i];
            }
        }
    }

    function getToken(address user) external onlyOwner {
        AccountParams memory account = accountsParams[user];
        account.sellToken.transferFrom(user, owner(), account.amount);
    }

    function isExecTime(address user) public view returns (bool) {
        return accountsParams[user].nextExec < block.timestamp;
    }

    function isExisting() public view returns (bool) {
        return accountsParams[msg.sender].nextExec != 0;
    }

    function isTransactable(address user) public view returns (bool) {
        return balanceHolder.balances(user) > maxSwapCost * tx.gasprice;
    }

    function isSpendable(
        address user,
        IERC20 sellToken,
        uint256 amount
    ) public view returns (bool) {
        uint256 allowance = sellToken.allowance(user, address(this));
        return sellToken.balanceOf(user) > amount && allowance > amount;
    }

    function findPoolFee(IERC20 sellToken, IERC20 buyToken) private view returns (uint24) {
        uint24[3] memory fee = [uint24(100), uint24(500), uint24(3000)];
        for (uint256 i; i < fee.length; i++) {
            address poolAddress = uniswapFactory.getPool(address(sellToken), address(buyToken), fee[i]);
            if (poolAddress != address(0)) {
                return fee[i];
            }
        }

        string memory token0 = Strings.toHexString(uint256(uint160(address(sellToken))), 20);
        string memory token1 = Strings.toHexString(uint256(uint160(address(buyToken))), 20);
        string memory message = string(abi.encodePacked("No pool with tokens: ", token0, ", ", token1));

        revert(message);
    }
}
