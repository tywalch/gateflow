# GateFlow
[![Coverage Status](https://coveralls.io/repos/github/tywalch/gateflow/badge.svg?branch=main)](https://coveralls.io/github/tywalch/gateflow?branch=main)
![GateFlow](https://github.com/tywalch/gateflow/blob/main/assets/gateflow.png?raw=true)

***GateFlow*** is a light weight library to manage state and enforce order for flows that span multiple multi-requests.  

## Installation

Install `gateflow` from npm.
```bash
npm install gateflow
```

## Usage
GateFlow and GateFlowStore works out of the box with redis, but will work with storage that implements the `Store` interface exported by the package.

### Import

```typescript
import {GateFlow, GateFlowStore} from  "gateflow";
import redis from "redis";
```

### Configure GateFlowStore

Create a random `secret` for keys, and a `ttl` that represents how long a flow should be active for before it expires (in seconds.)
```typescript
const client = redis.createClient({ /* your configuration */ });
const secret = "your_random_secret";
const ttl = 300; // seconds

const  store  =  new  GateFlowStore(client,  secret,  ttl);
```

### Configure GateFlow Service

`GateFlow` takes an instance of `GateFlowStore`, and a [Schema](#schema) and returns a service for creating and managing flows.

Add the schema either inline or by using the static method `buildSchema()`. 
```typescript
const gateFlow = new GateFlow(store, [
	["login", ["login"]],
	["send_mfa", ["login",  "send_mfa"]],
	["verify_mfa", ["login",  "send_mfa",  "verify_mfa"]],
]);
```

```typescript
const schema = GateFlow.buildSchema([
	["login", ["login"]],
	["send_mfa", ["login",  "send_mfa"]],
	["verify_mfa", ["login",  "send_mfa",  "verify_mfa"]],
]);
const  gateFlow = new GateFlow(store, schema);
```

### Schema

Building a schema for your flow requires planning which routes should be accessible and which routes should not. A flow consists of an array of "gates," with each "gate" consisting of a "name" (the first element), and an array of available gates (the second element) at a given "gate."

```json
[
	["login", ["login"]],
	["send_mfa", ["login",  "send_mfa"]],
	["verify_mfa", ["login",  "send_mfa",  "verify_mfa"]],
]
```

In this example, each "gate" is a request a user must pass through, in order, to progress through an MFA flow on login. The flow might go something like this:

1. A user logs into your application; they start at gate `login`. If they successfully provide a username/password, the user progresses to the "next" gate `send_mfa`, and returns a `key` to the frontend.

2. The user is presented with destinations for MFA (phone or email) and sends a request with their selection and the `key`. If this is valid, the application sends a code to their destination and the user progresses to the "next" gate `verify_mfa`.

3. The user is presented with a form to enter the code sent to their destination. They send a request with the code and the `key`. If the code is valid, the user progresses to the "next" gate, which there is none, so the flow is complete and GateFlow invalidates the `key`.

Looking at the schema, we can see the first element (the gate's "name") aligns closely with the requests made by the user. The second element represents the other gates available to change to at a given gate. 

For example, in an MFA flow, it is important that a user _not_ be able to jump from the `send_mfa` gate directly to the `complete_mfa` gate.  Additionally, if the user is at the gate `verify_mfa`, it would be valid for the user to go back to the `send_mfa` gate if they needed to resend their code again. This is how `GateFlow`  **enforces order** across requests.  

## Example

Using the flow presented in the above section [Schema](#schema).

```typescript

const gateFlow = new GateFlow(store, [
	["login", ["login"]],
	["send_mfa", ["login", "send_mfa"]],
	["verify_mfa", ["login", "send_mfa", "verify_mfa"]],
	["complete_mfa", ["login", "send_mfa", "verify_mfa", "complete_mfa"]],
]);
```

### Login

> 1. A user logs into your application, they start at gate `login`. If they successfully providing a username/password, the user progresses to the "next" gate `send_mfa`, and returns a `key` to the frontend.

After validating the user's credentials, we collect the available destinations for their MFA to be sent. Here, we can store the destinations in `StepFlow` so they can be verified on the next request. We can also store the token that would have gone back to them, if not for MFA.

```typescript
async function(req, res, next) {
	let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
	let destinations = [{
			type: "phone",
			value: "(503) 555-7392"
		}, {
			type: "email",
			value: "gateflow@tinkertamper.com"
		}];
	
	let gatekeeper = await gateFlow.create({token, destinations});
	await gatekeeper.next();
	res.send({
		key: gatekeeper.key,
		destinations: destinations.map(dest => dest.type)
	});
}
```

We create a new `gatekeeper`, and optionally initialize it with the token we will be giving the user at the end of the flow and the list of available destinations the user will be choosing from in the next request. After all processes have been successful, we call `next()` to progress the "gate" from `login` to `send_mfa` - the next gate in the flow. Lastly, we return the `key` to the client for use on subsequent requests.

### Verify MFA

> 2. The user is presented with destinations for MFA (phone or email) and sends a request with their selection and the `key`. If this is valid, the application sends a code to their destination and the user progresses to the "next" gate `verify_mfa`.

On the next request, we will receive the `key` and an MFA destination passed as the desired index in the destination's array. We must validate the destination passed, send that destination an MFA code, and move the gatekeeper forward.

```typescript
async function(req, res, next) {
	const key = req.body.key;
	const index = req.body.destination;

	let gatekeeper = await gateFlow.continue(key);

	let [isValid, errors] = await gatekeeper.test("send_mfa");
	if (!isValid) {
		throw new Error(errors.join(", "));
	}

	await gatekeeper.knock("send_mfa");

	let {destinations, token} = await gatekeeper.getData();
	let code = await sendCode(destinations[index], token);
	await gatekeeper.setData("code", code);
	
	await gatekeeper.next();
	
	res.send({});
}
```

On this request, and all subsequent requests, we will be using the `continue()` method on the `gateFlow` service to get our `gatekeeper` object.

Before we begin servicing the request, we can use `test()` to determine if the gate associated with the request is valid, given the current state of the flow. Also available is the `knock()` method, which allows you to set the current gate, which also does a test and will throw if the gate is not valid. To illustrate why `knock()` and `test()` are useful, let's look at our schema.

The current gate is `send_mfa` (set via the `next()` call at the end of the first route). In our "schema" we defined `mfa_send` as the following:

```json
["send_mfa", ["login", "send_mfa"]]
```

Calling `test(status)` on `send_mfa` verify `status` is either `login` or `send_mfa`. Calling `knock(status)` will verify `status` is either `login` or `send_mfa` and then set the current `gate` to that status.

Back to the code, we retrieve the `destinations` we stored from the first request, and that "trusted" data to send an MFA code to the selected destination. From that function, we get the code that was sent, which we then give to the gatekeeper for use on the next request.

Lastly, and after everything was successful, we progress to the next gate by calling `next()`.

### Verify MFA

> 3. The user is presented with a form to enter the code sent to their destination. They send a request with the code and the `key`. If the code is valid, the user progresses to the "next" gate `complete_mfa`, the user progresses to the "next" gate, which there is none, so the flow is complete and GateFlow invalidates the `key`.

 On this request, the user supplies the code they received and the key from the original request.

```typescript
async function(req, res, next) {
	const key = req.body.key;
	const code = req.body.code;

	let gatekeeper = await gateFlow.continue(key);
	let [isValid, errors] = await gatekeeper.test("verify_mfa");
	if (!isValid) {
		throw new Error(errors.join(", "));
	}

	await gatekeeper.knock("verify_mfa");

	let cache = await gatekeeper.getData();
	if (cache.code !== code) {
		throw new Error("Invalid MFA code");
	}

	let [isComplete, {token}] = await gatekeeper.next();

	if (isComplete) {
		res.send({token});
	} else {
		res.sendStatus(401);
	}
}
```

Similar to the last request, we use `continue` to get a `gatekeeper` object and then test that the current gate requested is valid with `test()` and `knock()`. In this request, verify that the code passed matches the code we have stored.

At the end, the request with a call to `next` to progress the next gate. The `next` method returns a boolean for `isComplete` and the session object we have stored as a part of the flow. Because this is the last gate in our schema, the `gatekeeper` will invalidate the key and its cache from our store. We then can pass back the `token` we stored from the original request to complete our MFA flow.
