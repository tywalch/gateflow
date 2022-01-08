import { GateFlowStore, StoreData, StoreKeys, StoreRecord } from "./gateflowstore";

export type FlowSchema<K extends string, V extends K> = [K, V[]][];

export type FlowCache<D extends StoreRecord<any>> = {
  schema: string;
  activeGateIndex: number;
  session: D;
};

export class GateKeeper<K extends string, V extends K, S extends GateFlowStore<any>, D extends StoreData<S>> {
  private store: S;
  private schema: FlowSchema<K, V>
  public key: string;

  constructor(key: string, schema: FlowSchema<K, V>, store: S) {
    this.key = key;
    this.schema = schema;
    this.store = store;
  }

  async next(): Promise<[boolean, D]> {
    let cache = await this.getCache();
    let gateIndex = cache.activeGateIndex + 1;
    let hasCompleted = gateIndex === this.schema.length;
    if (hasCompleted) {
      await this.destroy();
    } else {
      await this.setGate(gateIndex, cache);
    }
    return [hasCompleted, cache.session]
  }

  async destroy(): Promise<void> {
    await this.store.destroy(this.key);
  }

  async getData(): Promise<D> {
    let cache = await this.getCache();
    return cache.session;
  }

  async setData<K extends StoreKeys<D>>(property: K, data: D[K]): Promise<D> {
    let cache = await this.getCache();
    cache.session = Object.assign({}, cache.session, {[property]: data});
    await this.setCache(cache);
    return data;
  }

  async knock(gate: V): Promise<V> {
    let [isValid, errors, cache] = await this.getTest(gate);
    if (!isValid) {
      throw new Error(errors.join(", "));
    }
    let gateIndex = this.getGateIndex(gate);
    await this.setGate(gateIndex, cache);
    return gate;
  }

  async test(gate: V): Promise<[boolean, string[], object]> {
    let [isValid, errors, cache] = await this.getTest(gate);
    return [isValid, errors, cache.session];
  }

  async getActiveGate() {
    let cache = await this.getCache();
    return this.schema[cache.activeGateIndex][0];
  }

  private async getTest(gate: V): Promise<[boolean, string[], FlowCache<D>]> {
    if (typeof gate !== "string" || gate.length === 0) {
      throw new Error("Gate was not defined");
    }
    let cache = await this.getCache();
    let errors: string[] = [];
    if (cache === undefined) {
      errors.push("Invalid key");
    } else {
      if (!this.isValidGate(gate, cache.activeGateIndex)) {
        errors.push("Invalid gate"); 
      }
    }
    return [errors.length === 0, errors, cache]
  }

  private async setGate(gateIndex: number, cache: FlowCache<D>) {
    return this.setCache({
      ...cache,
      activeGateIndex: gateIndex
    });
  }

  private getGateIndex(gate: V): number {
    return this.schema.findIndex(gates => gates[0] === gate);
  }

  private isValidGate(gate: V, gateIndex: number): boolean {
    let validGates = this.schema[gateIndex];
    if (validGates === undefined) {
      return false;
    }
    
    return validGates[1].indexOf(gate) !== -1;
  }

  private async setCache(cache: FlowCache<D>) {
    return this.store.set(this.key, cache);
  }

  private async getCache(): Promise<FlowCache<D>> {
    return this.store.get(this.key);
  }
}