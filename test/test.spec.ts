import { expect } from 'chai';
import RedisClientMock from "./mock/redis";
import {GateFlowStore} from "../src/gateflowstore";
import {GateFlow} from "../src/gateflow";
const client = new RedisClientMock();

type TestData = {
    registration: boolean;
    newProperty?: {
        name: string;
    };
    secondProperty?: {
        name2: string;
    };
}

const store = new GateFlowStore<TestData>(client, "apples", 99999999);


const schema = GateFlow.buildSchema([
    ["register", ["register"]],
    ["mfasend", ["register", "mfasend", "mfaverify"]],
    ["mfaverify", ["register", "mfasend", "mfaverify"]],
    ["complete", ["register", "mfasend", "mfaverify", "complete"]]
]);

describe("Gate Flow", async () => {
  after(() => {
      client.quit();
  });
  describe("Initilization", async () => {
      let gateFlow = new GateFlow(store, schema);

      beforeEach(() => {
        gateFlow = new GateFlow(store, schema);
      });

      it("Should have a key when started", async () => {
          let initialData = {registration: true};
          let gatekeeper = await gateFlow.create(initialData);
          expect(gatekeeper.key).to.be.string;
      });

      it("Should have a key when continued", async () => {
          let { key } = await gateFlow.create({registration: false});
          let gatekeeper = await gateFlow.continue(key);
          expect(gatekeeper.key).to.be.string;
          expect(gatekeeper.key).to.equal(key);
      });

      it("Should start with the active gate being the first in the flow", async () => {
          let secondGate = schema[0][0];
          let gatekeeper = await gateFlow.create({registration: true});
          let activeGate = await gatekeeper.getActiveGate();
          expect(activeGate).to.be.string;
          expect(activeGate).to.be.equal(secondGate)
      });

      it("Should be initilized with the object passed to start", async () => {
          let initialData = {registration: true};
          let gatekeeper = await gateFlow.create(initialData); 
          let data = await gatekeeper.getData();
          expect(data.registration).to.be.true;
          expect(data).to.be.deep.equal(initialData);
      });
  })
  describe("Gatekeeper", async () => {
      let schema = [
          ["register", ["register"]],
          ["mfasend", ["register", "mfasend", "mfaverify"]],
          ["mfaverify", ["register", "mfasend", "mfaverify"]],
          ["complete", ["register", "mfasend", "mfaverify", "complete"]]
      ];

      let gateFlow = new GateFlow(store, [
        ["register", ["register"]],
        ["mfasend", ["register", "mfasend", "mfaverify"]],
        ["mfaverify", ["register", "mfasend", "mfaverify"]],
        ["complete", ["register", "mfasend", "mfaverify", "complete"]]
      ])

      beforeEach(() => {
        gateFlow = new GateFlow(store, [
          ["register", ["register"]],
          ["mfasend", ["register", "mfasend", "mfaverify"]],
          ["mfaverify", ["register", "mfasend", "mfaverify"]],
          ["complete", ["register", "mfasend", "mfaverify", "complete"]]
        ])
      });

      it("Should disallow invalid continue keys", async () => {
        const tests = [
            {
              input: "", // empty string
              output: "Key is not defined",
              throw: true,
            },
            {
              input: undefined, // undefined value
              output: "Key is not defined",
              throw: true,
            },
            {
              input: 12, // invalid type
              output: "Key is not defined",
              throw: true, 
            },
            {
              input: "complete", // not valid gate
              output: "Invalid key",
              throw: false,
            }
        ]

        let gatekeeper = await gateFlow.create({registration: true});
        await gatekeeper.next();
        
        for (let test of tests) {
            let input = test.input as string
            let [success, err] = await gateFlow.continue(input)
                .then(() => [true, null])
                .catch(err => [false, err]);
            expect(success).to.be.false;
            expect(err.message).to.be.equal(test.output)
        }
    })

      it("Should disallow invalid knocks", async () => {
          const tests = [
              {
                input: "", // empty string
                output: "Gate was not defined",
                throw: true,
              },
              {
                input: undefined, // undefined value
                output: "Gate was not defined",
                throw: true,
              },
              {
                input: 12, // invalid type
                output: "Gate was not defined",
                throw: true, 
              },
              {
                input: "complete", // not valid gate
                output: "Invalid gate",
                throw: false,
              }
          ]

          let gatekeeper = await gateFlow.create({registration: false});
          await gatekeeper.next();
          let gateKeeperTwo = await gateFlow.continue(gatekeeper.key);

          for (let test of tests) {
              try {
                let input = test.input as "register" | "mfasend" | "mfaverify" | "complete"
                let results = await gateKeeperTwo.knock(input);
                expect(test.throw).to.be.false;
                expect(results[0]).to.be.false;
                expect(results[1]).to.deep.equal([test.output])
              } catch(err: any) {
                expect(err.message).to.equal(test.output)
              }
          }
      })

      it("Should be able to get and set data associated with the gate flow across multiple gates", async () => {
          let initialData = {registration: true};
          let newProperty = {name: "value"};
          let gatekeeper = await gateFlow.create(initialData); 
          await gatekeeper.setData("newProperty", newProperty);
          let data = await gatekeeper.getData();
          expect(data).to.be.deep.equal({
              ...initialData,
              ...{newProperty}
          });
          await gatekeeper.next();
          let secondProperty = {name2: "value2"};
          await gatekeeper.setData("secondProperty", secondProperty);
          let nextGateData = await gatekeeper.getData();
          expect(nextGateData).to.be.deep.equal({
              ...initialData,
              ...{newProperty},
              ...{secondProperty}
          });
      });

      it("Should progress in the flow when gate is called", async () => {
          const secondGate = "mfasend";
          let gateOne = await gateFlow.create({registration: true});
          let [isComplete] = await gateOne.next();
          expect(isComplete).to.be.false;

          let gateTwo = await gateFlow.continue(gateOne.key);
          await gateTwo.knock(secondGate);
          let activeGate = await gateTwo.getActiveGate();
          expect(activeGate).to.be.deep.equal(secondGate);
      });

      it("Should delete the gate session after the flow is completed", async () => {
          const secondGateName = "mfasend";
          const thirdGateName = "mfaverify"
          const lastGateName = "complete";
          expect(lastGateName).to.equal(schema[schema.length - 1][0])
          
          // start gate 1
          let gateOne = await gateFlow.create({registration: false});
          let key = gateOne.key;
          await gateOne.next();

          // start gate 2
          let gateTwo = await gateFlow.continue(key);
          await gateTwo.knock(secondGateName);
          let [isComplete] = await gateTwo.next();
          expect(isComplete).to.be.false;

          // start gate 3
          let gateThree = await gateFlow.continue(key);
          await gateThree.knock(thirdGateName);
          let activeGate = await gateThree.getActiveGate();
          expect(activeGate).to.be.equal(thirdGateName);
          await gateThree.next();

          // gate to gate 4
          let lastGate = await gateFlow.continue(key);
          await lastGate.knock(lastGateName);
          let lastGateActiveGate = await lastGate.getActiveGate();
          expect(lastGateActiveGate).to.be.equal(lastGateName);
          let [lastGateIsComplete] = await lastGate.next();
          expect(lastGateIsComplete).to.be.true;
      });

      it("Should regress in the flow when prior valid gate is called", async () => {
          const secondGateName = "mfasend";
          const thirdGateName = "mfaverify";
          
          // start gate 1
          let gateOne = await gateFlow.create({registration: true});
          let key = gateOne.key;
          await gateOne.next();

          // start gate 2
          let gateTwo = await gateFlow.continue(key);
          await gateTwo.knock(secondGateName);
          let [isComplete, session] = await gateTwo.next();
          expect(isComplete).to.be.false;
          expect(session.registration).to.be.true;

          // start gate 3
          let gateThree = await gateFlow.continue(key);
          await gateThree.knock(thirdGateName);
          let activeGate = await gateThree.getActiveGate();
          expect(activeGate).to.be.equal(thirdGateName);

          // regress back to gate 2
          let regression = await gateFlow.continue(key);
          await regression.knock(secondGateName);
          let regressedActiveGate = await regression.getActiveGate();
          expect(regressedActiveGate).to.be.equal(secondGateName);
          await regression.setData('registration', false);
          const {registration, newProperty} = await regression.getData();
          expect(registration).to.be.false;
          expect(newProperty).to.be.undefined;
      });

      it("Should not allow going to gates that specified in the schema", async () => {
          const expectedErrorText = "Invalid gate";
          let firstGates = schema[0];
          let firstGateName = firstGates[0];
          const lastGateName = "complete";
          expect(firstGates[1]).to.not.include.members([lastGateName]);
          let gateOne = await gateFlow.create({
              registration: true,
              newProperty: {
                  name: "tyler"
              }
          });
          let gateOneActiveGate = await gateOne.getActiveGate();
          expect(gateOneActiveGate).to.be.equal(firstGateName);
          let [isValid, errors] = await gateOne.test(lastGateName);
          expect(isValid).to.be.false;
          expect(errors).to.deep.equal([expectedErrorText]);
          let error: Error | undefined = undefined;
          try {
              await gateOne.knock(lastGateName);
          } catch(err) {
              if (err instanceof Error) {
                  error = err;
              }
          }
          expect(error).to.not.be.null;
          expect(error?.message).to.equal(expectedErrorText);
      })
  });
});