const assert = require("assert");
const ganache = require("ganache-cli"); // local ethereum test network
const Web3 = require("web3"); // Web3 is a constructur, which is why it's capitalized. Instances of web3 are with lowercase
const web3 = new Web3(ganache.provider()); // instance of web3, with the provider being Ganache

const compiledRegistrationAuthority = require("../ethereum/build/RegistrationAuthority.json");
const compiledElectionFactory = require("../ethereum/build/ElectionFactory.json");
const compiledElection = require("../ethereum/build/Election.json");

const paillier = require("paillier-js");

let accounts, ra, ef;

// https://www.npmjs.com/package/ganache-time-traveler
advanceTimeAndBlock = async time => {
    //capture current time
    let block = await web3.eth.getBlock("latest");
    let forwardTime = block["timestamp"] + time;

    return new Promise((resolve, reject) => {
        web3.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [forwardTime],
                id: new Date().getTime()
            },
            (err, result) => {
                if (err) {
                    return reject(err);
                }
                return resolve(result);
            }
        );
    });
};

beforeEach(async () => {
    accounts = await web3.eth.getAccounts();
    ra = await new web3.eth.Contract(
        JSON.parse(compiledRegistrationAuthority.interface)
    )
        .deploy({ data: "0x" + compiledRegistrationAuthority.bytecode })
        .send({ from: accounts[0], gas: "3000000" });
    ef = await new web3.eth.Contract(
        JSON.parse(compiledElectionFactory.interface)
    )
        .deploy({
            data: "0x" + compiledElectionFactory.bytecode,
            arguments: [ra.options.address]
        })
        .send({ from: accounts[0], gas: "3000000" });
});

describe("Registration Authority", () => {
    it("deploys the RA contract to the blockchain", () => {
        assert.ok(ra.options.address);
    });

    it("the manager of the contract is also its creator", async () => {
        assert((await ra.methods.manager().call()) == accounts[0]);
    });

    it("the number of registered voters is initialized with a zero", async () => {
        assert((await ra.methods.getNumberOfVoters().call()) == 0);
    });

    it("only the manager can access restricted functions", async () => {
        let e;
        try {
            assert(
                await ra.methods.registerVoter(
                    accounts[0].send({ from: accounts[0] })
                )
            ); // manager
            await ra.methods
                .registerVoter(accounts[1])
                .send({ from: accounts[1], gas: 3000000 }); // not the manager
        } catch (err) {
            e = err;
        }
        assert(e);
    });

    it("a voter can be registered", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        assert((await ra.methods.isVoter(accounts[0]).call()) == true);
        assert((await ra.methods.getNumberOfVoters().call()) == 1);
    });

    it("a voter can be unregistered", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        assert((await ra.methods.isVoter(accounts[0]).call()) == true);
        assert((await ra.methods.getNumberOfVoters().call()) == 1);

        await ra.methods
            .unregisterVoter(accounts[0])
            .send({ from: accounts[0], gas: 3000000 });
        assert((await ra.methods.isVoter(accounts[0]).call()) == false);
        assert((await ra.methods.getNumberOfVoters().call()) == 0);
    });

    it("multiple voters can be registered and unregistered", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        await ra.methods
            .registerOrUpdateVoter(accounts[1], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        await ra.methods
            .registerOrUpdateVoter(accounts[2], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        await ra.methods
            .unregisterVoter(accounts[1])
            .send({ from: accounts[0], gas: 3000000 });
        assert((await ra.methods.getNumberOfVoters().call()) == 2);
    });
});

describe("Election Factory", () => {
    it("deploys the EF contract to the blockchain", () => {
        assert.ok(ef.options.address);
    });

    it("the manager of the contract is also its creator", async () => {
        assert((await ef.methods.factoryManager().call()) == accounts[0]);
    });

    it("the contract has a valid address to the registration authority", async () => {
        assert.ok(await ef.methods.registrationAuthority().call());
    });

    it("the contract has zero deployed elections initially", async () => {
        assert(
            (await ef.methods.getDeployedElections().call().length) == undefined
        );
    });

    it("only the factory manager can access restricted functions", async () => {
        let e;
        try {
            assert(
                await ef.methods
                    .createElection("", "", 0, 0)
                    .send({ from: accounts[0], gas: 3000000 })
            ); // should work
            await ef.methods
                .createElection("", "", 0, 0)
                .send({ from: accounts[1], gas: 3000000 }); // should throw an error
        } catch (err) {
            e = err;
        }
        assert(e);
    });

    it("an election contract can be deployed", async () => {
        await ef.methods
            .createElection("", "", 0, 0, "")
            .send({ from: accounts[0], gas: 3000000 });
        const deployedContracts = await ef.methods
            .getDeployedElections()
            .call();
        assert(deployedContracts.length == 1);
        assert.ok(deployedContracts[0]);
    });

    it("multiple election contracts can be deployed", async () => {
        await ef.methods
            .createElection("a", "a", 1, 2, "")
            .send({ from: accounts[0], gas: 3000000 });
        await ef.methods
            .createElection("b", "b", 3, 4, "")
            .send({ from: accounts[0], gas: 3000000 });
        const deployedContracts = await ef.methods
            .getDeployedElections()
            .call();
        assert(deployedContracts.length == 2);
        assert.ok(deployedContracts[0]);
        assert.ok(deployedContracts[1]);
    });
});

describe("Election", () => {
    it("deploys an election contract to the blockchain", async () => {
        await ef.methods
            .createElection("", "", 0, 0, "")
            .send({ from: accounts[0], gas: 3000000 });
        const deployedElections = await ef.methods
            .getDeployedElections()
            .call();
        assert.ok(deployedElections[0]);
    });

    it("all constructor parameters are applied to the contract at creation", async () => {
        const title = "title test",
            description = "description test",
            startTime = 5,
            timeLimit = 10;
        await ef.methods
            .createElection(title, description, startTime, timeLimit, "")
            .send({ from: accounts[0], gas: 3000000 });
        const electionContract = new web3.eth.Contract(
            JSON.parse(compiledElection.interface),
            await ef.methods.deployedElections(0).call()
        );

        assert(
            (await electionContract.methods.electionManager().call()) ==
                accounts[0]
        );
        assert(
            (await electionContract.methods.electionFactory().call()) ==
                ef.options.address
        );
        assert(
            (await electionContract.methods.registrationAuthority().call()) ==
                ra.options.address
        );
        assert((await electionContract.methods.title().call()) == title);
        assert(
            (await electionContract.methods.description().call()) == description
        );
        assert(
            (await electionContract.methods.startTime().call()) == startTime
        );
        assert(
            (await electionContract.methods.timeLimit().call()) == timeLimit
        );
    });

    it("only the election manager can access restricted functions", async () => {
        let e;
        try {
            await ef.methods
                .createElection("a", "b", Date.now() + 600, Date.now() + 1200)
                .send({ from: accounts[0], gas: 3000000 });
            const electionContract = new web3.eth.Contract(
                JSON.parse(compiledElection.interface),
                await ef.methods.deployedElections(0).call()
            );
            await electionContract.methods
                .addOption("", "")
                .send({ from: accounts[1], gas: 3000000 }); // should throw an error, not the election manager
        } catch (err) {
            e = err;
        }
        assert(e);
    });

    it("the manager can add voting options before the election", async () => {
        await ef.methods
            .createElection("", "", Date.now() + 600, Date.now() + 1200, "")
            .send({ from: accounts[0], gas: 3000000 });
        const electionContract = new web3.eth.Contract(
            JSON.parse(compiledElection.interface),
            await ef.methods.deployedElections(0).call()
        );
        await electionContract.methods
            .addOption("option 1", "desc 1")
            .send({ from: accounts[0], gas: 3000000 });
        const options = await electionContract.methods.getOptions().call();
        assert(options.length == 1);
    });

    it("a registered voter can cast their vote during their election", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        await ef.methods
            .createElection(
                "",
                "",
                Math.floor(Date.now() / 1000 - 600),
                Math.floor(Date.now() / 1000 + 600),
                ""
            )
            .send({ from: accounts[0], gas: 3000000 });
        const electionContract = new web3.eth.Contract(
            JSON.parse(compiledElection.interface),
            await ef.methods.deployedElections(0).call()
        );
        await electionContract.methods
            .vote(JSON.stringify([0, 1, 0]))
            .send({ from: accounts[0], gas: 3000000 });
        assert(await electionContract.methods.hasVoted(accounts[0]).call());
    });

    it("a non-registered voter can not cast their vote during their election", async () => {
        let e;
        try {
            await ef.methods
                .createElection(
                    "",
                    "",
                    Math.floor(Date.now() / 1000 - 600),
                    Math.floor(Date.now() / 1000 + 600)
                )
                .send({ from: accounts[0], gas: 3000000 });
            const electionContract = new web3.eth.Contract(
                JSON.parse(compiledElection.interface),
                await ef.methods.deployedElections(0).call()
            );
            await electionContract.methods
                .vote(JSON.stringify([0, 1, 0]))
                .send({ from: accounts[0], gas: 3000000 });
        } catch (err) {
            e = err;
        }
        assert(e);
    });

    it("a voter can vote multiple times and invalidate their previous vote each time", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });
        await ef.methods
            .createElection(
                "",
                "",
                Math.floor(Date.now() / 1000 - 60),
                Math.floor(Date.now() / 1000 + 60),
                ""
            )
            .send({ from: accounts[0], gas: 3000000 });
        const electionContract = new web3.eth.Contract(
            JSON.parse(compiledElection.interface),
            await ef.methods.deployedElections(0).call()
        );
        await electionContract.methods
            .vote(JSON.stringify([1, 0, 0]))
            .send({ from: accounts[0], gas: 3000000 });
        await electionContract.methods
            .vote(JSON.stringify([0, 0, 1]))
            .send({ from: accounts[0], gas: 3000000 }); // change vote

        await advanceTimeAndBlock(600); // advance time 10 minutes until after election

        let result = await electionContract.methods
            .getEncryptedVoteOfVoter(accounts[0])
            .call();
        assert.deepEqual(result, JSON.stringify([0, 0, 1])); // check whether arrays are structurally equivalent (normal assert compares if it's the same object)

        await advanceTimeAndBlock(-600); // reset time travel from this test
    });

    it("votes are stored encrypted", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });

        const { publicKey, privateKey } = paillier.generateRandomKeys(256);

        await ef.methods
            .createElection(
                "",
                "",
                Math.floor(Date.now() / 1000 - 60),
                Math.floor(Date.now() / 1000 + 60),
                JSON.stringify(publicKey)
            )
            .send({ from: accounts[0], gas: 3000000 });

        const electionContract = new web3.eth.Contract(
            JSON.parse(compiledElection.interface),
            await ef.methods.deployedElections(0).call()
        );

        const votes = [
            publicKey.encrypt(1).toString(),
            publicKey.encrypt(0).toString(),
            publicKey.encrypt(0).toString()
        ];

        await electionContract.methods
            .vote(JSON.stringify(votes))
            .send({ from: accounts[0], gas: 3000000 });

        await advanceTimeAndBlock(600);

        let result = await electionContract.methods
            .getEncryptedVoteOfVoter(accounts[0])
            .call();

        assert.deepEqual(JSON.stringify(votes), result);

        await advanceTimeAndBlock(-600); // reset time travel from this test
    });

    it("election results can be published by the election manager", async () => {
        await ra.methods
            .registerOrUpdateVoter(accounts[0], "", "", "", "")
            .send({ from: accounts[0], gas: 3000000 });

        const { publicKey, privateKey } = paillier.generateRandomKeys(256);

        await ef.methods
            .createElection(
                "",
                "",
                Math.floor(Date.now() / 1000 - 60),
                Math.floor(Date.now() / 1000 + 60),
                JSON.stringify(publicKey)
            )
            .send({ from: accounts[0], gas: 3000000 });

        const electionContract = new web3.eth.Contract(
            JSON.parse(compiledElection.interface),
            await ef.methods.deployedElections(0).call()
        );

        const votes = [0, 1, 0];

        const encryptedVotes = [
            publicKey.encrypt(votes[0]).toString(),
            publicKey.encrypt(votes[1]).toString(),
            publicKey.encrypt(votes[2]).toString()
        ];

        await electionContract.methods
            .vote(JSON.stringify(encryptedVotes))
            .send({ from: accounts[0], gas: 3000000 });

        await advanceTimeAndBlock(600);

        let result = await electionContract.methods
            .getEncryptedVoteOfVoter(accounts[0])
            .call();

        const parsedResult = JSON.parse(result);

        const decryptedVotes = [
            Number(privateKey.decrypt(parsedResult[0])),
            Number(privateKey.decrypt(parsedResult[1])),
            Number(privateKey.decrypt(parsedResult[2]))
        ];

        await electionContract.methods
            .publishResults(decryptedVotes)
            .send({ from: accounts[0], gas: 3000000 });

        const publishedResults = await electionContract.methods
            .getResults()
            .call();

        assert.deepEqual(votes, publishedResults);
    });
});
