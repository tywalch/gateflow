import {GateKeeper, FlowSchema} from "./gatekeeper";
import {GateFlowStore, StoreData} from "./gateflowstore";

export class GateFlow<K extends string, V extends K, S extends GateFlowStore<any>, D extends StoreData<S>> {
  private store: S;
  private schema: FlowSchema<K, V>;
  
  constructor(store: S, schema: FlowSchema<K, V>) {
    this.schema = schema;
    this.store = store;
  }

  static buildSchema = <K extends string, V extends K>(structure: FlowSchema<K, V>): typeof structure => structure;

  async create(session: D): Promise<GateKeeper<K, V, S, D>> {
    let cache = {
      session,
      schema: this.schema,
      activeGateIndex: 0
    };
    let key = await this.store.create(cache);
    return new GateKeeper(key, this.schema, this.store);
  }

  async continue(key: string): Promise<GateKeeper<K, V, S, D>> {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Key is not defined");
    }
    let cache = await this.store.get(key);
    if (cache === undefined) {
      throw new Error("Invalid key");
    }
    return new GateKeeper(key, this.schema, this.store);
  }
}