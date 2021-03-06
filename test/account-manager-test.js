const AccountManager = artifacts.require("AccountManager");

const UniswapV3FactoryMock = artifacts.require("UniswapV3FactoryMock");
const OpsMock = artifacts.require("OpsMock");
const TaskTreasuryMock = artifacts.require("TaskTreasuryMock");
const ERC20Mock = artifacts.require("ERC20Mock");

const {assertRevert, sleep, randomAddress} = require("./helpers");

contract("AccountManager", (accounts) => {
    let accountManager;
    let uniswapV3Factory;
    let ops;
    let taskTreasury;

    let nullAddress = "0x0000000000000000000000000000000000000000";

    beforeEach(async () => {
        let autoDcaAddress = randomAddress();
        let poolAddress = randomAddress();

        uniswapV3Factory = await UniswapV3FactoryMock.new();
        ops = await OpsMock.new();
        taskTreasury = await TaskTreasuryMock.new();
        await ops.setTaskTreasury(taskTreasury.address);
        accountManager = await AccountManager.new(autoDcaAddress, uniswapV3Factory.address, ops.address);
        token0 = await ERC20Mock.new();
        token1 = await ERC20Mock.new();

        // given
        let interval = 2;
        let amount = 100;
        await uniswapV3Factory.setPool(poolAddress);
        await accountManager.setUpAccount(interval, amount, token0.address, token1.address);
    });

    it("should set up an account", async () => {
        // given
        let interval = 60;
        let amount = 100;

        // when
        await accountManager.setUpAccount(interval, amount, token0.address, token1.address, {from: accounts[1]});

        // then
        let account = await accountManager.accounts(1);
        assert.equal(account, accounts[1]);
        let params = await accountManager.accountsParams(account);
        assert.equal(params.interval, interval);
        assert.equal(params.amount, amount);
    });

    it("should NOT set up an account when pool not found", async () => {
        // given
        let interval = 60;
        let amount = 100;
        await uniswapV3Factory.setPool(nullAddress);

        // expect
        let setUp = accountManager.setUpAccount(interval, amount, token0.address, token1.address, {from: accounts[1]});
        await assertRevert(setUp);
    });

    it("should pause and unpause account", async () => {
        // given
        let account = await accountManager.accounts(0);
        assert.equal(account, accounts[0]);

        // when
        await accountManager.setPause();
        let paused = (await accountManager.accountsParams(account)).paused;

        // then
        assert.isTrue(paused);

        // when
        await accountManager.setUnpause();

        // then
        paused = (await accountManager.accountsParams(account)).paused;
        assert.isFalse(paused);
    });

    it("should return false for exec time", async () => {
        // given
        let account = await accountManager.accounts(0);

        // when
        let isTime = await accountManager.isExecTime(account);

        // then
        assert.isFalse(isTime);
    });

    it("should return true for exec time", async () => {
        // given, wait for exect time
        let account = await accountManager.accounts(0);
        await sleep(2.5);

        // when
        let isTime = await accountManager.isExecTime(account);

        // then
        assert.isTrue(isTime);
    });

    // prettier-ignore
    let conditions = [
        " + exec time", 
        " + tx funds", 
        " + balance", 
        " + allowance"
    ];

    it("should return user need exec, if: " + conditions, async () => {
        // given
        await sleep(2.5);
        let gwei = 1000000000;
        await accountManager.deposit({value: gwei});
        await token0.setBalance(1000);
        await token0.setAllowance(1000);

        // when
        let account = await accountManager.getUserNeedExec();

        // then
        assert.equal(account, accounts[0]);
    });

    // prettier-ignore
    conditions = [
        " - exec time", 
        " + tx funds", 
        " + balance", 
        " + allowance"
    ];

    it("should return null address, if: " + conditions, async () => {
        // given
        let gwei = 1000000000;
        await accountManager.deposit({value: gwei});
        await token0.setBalance(1000);
        await token0.setAllowance(1000);

        // when
        let account = await accountManager.getUserNeedExec();

        // then
        assert.equal(account, nullAddress);
    });

    // prettier-ignore
    conditions = [
        " + exec time", 
        " - tx funds", 
        " + balance", 
        " + allowance"
    ];

    it("should return null address, if: " + conditions, async () => {
        // given
        await sleep(2.5);
        await token0.setBalance(1000);
        await token0.setAllowance(1000);

        // when
        let account = await accountManager.getUserNeedExec();

        // then
        assert.equal(account, nullAddress);
    });

    // prettier-ignore
    conditions = [
        " + exec time", 
        " + tx funds", 
        " - balance", 
        " + allowance"
    ];

    it("should return null address, if: " + conditions, async () => {
        // given
        await sleep(2.5);
        let gwei = 1000000000;
        await accountManager.deposit({value: gwei});
        await token0.setBalance(0);
        await token0.setAllowance(1000);

        // when
        let account = await accountManager.getUserNeedExec();

        // then
        assert.equal(account, nullAddress);
    });

    // prettier-ignore
    conditions = [
        " + exec time", 
        " + tx funds", 
        " + balance", 
        " - allowance"
    ];

    it("should return null address, if: " + conditions, async () => {
        // given
        await sleep(2.5);
        let gwei = 1000000000;
        await accountManager.deposit({value: gwei});
        await token0.setBalance(1000);
        await token0.setAllowance(0);

        // when
        let account = await accountManager.getUserNeedExec();

        // then
        assert.equal(account, nullAddress);
    });

    it("should deposit funds to task tresury", async () => {
        // given
        let gwei = 1000000000;

        // when
        await accountManager.deposit({value: gwei});

        // then
        let balance = await web3.eth.getBalance(taskTreasury.address);
        assert.equal(gwei, balance);
    });
});
