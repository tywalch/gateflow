import {Encrypter} from "./encrypter";

export type Callback<T> = (err: Error | null, reply: T) => void

export type StoreRecord<R> = Record<string, R>;

export type StoreKeys<D extends StoreRecord<any>> = Extract<keyof D, string>;

export type StoreData<S extends GateFlowStore<any>> = S extends GateFlowStore<infer D> ? D : never;

export interface Store {
  set: (key: string, value: string, mode: string, duration: number, cb?: Callback<"OK" | undefined> | undefined) => boolean;
  get: (key: string, cb?: Callback<string | null> | undefined) => boolean
  del: (key: string, cb?: Callback<number> | undefined) => boolean,
  quit: () => void;
}

export class GateFlowStore<D extends Record<string, any>> {
  public ttl: number;
  public store: Store;
  private encrypter: Encrypter;

  constructor(store: Store, secret: string, ttl: number) {
    this.ttl = ttl;
    this.store = store;
    this.encrypter = new Encrypter(secret);
  }

  private async getPrivateKey(publicKey: keyof D): Promise<string> {
    let privateKey = await this.encrypter.decrypt(publicKey as string);
    if (privateKey === undefined) {
      throw new Error("Invalid key");
    }
    return privateKey;
  }

  private async getPublicPrivateKey() {
    let privateKey = await this.encrypter.random();
    let publicKey = await this.encrypter.encrypt(privateKey);
    return {privateKey, publicKey};
  }

  private async sset(value: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        let {privateKey, publicKey} = await this.getPublicPrivateKey();
        this.store.set(privateKey, value, "EX", this.ttl, (err) => {
          /* istanbul ignore if */
          if (err) {
            return reject(err)
          }
          return resolve(publicKey);
        })
      } catch(err) {
        return reject(err);
      }
    })
  }

  private async srset(publicKey: keyof D, value: string): Promise<string|void> {
    return new Promise(async (resolve, reject) => {
      try {
        let privateKey = await this.getPrivateKey(publicKey);
        this.store.set(privateKey, value, "EX", this.ttl, (err) => {
          /* istanbul ignore if */
          if (err) {
            return reject(err);
          }
          return resolve();
        })
      } catch(err) {
        return reject(err);
      }
    })
  }

  private async sget(publicKey: keyof D): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        let privateKey = await this.getPrivateKey(publicKey);
        this.store.get(privateKey, (err, data) => {
          /* istanbul ignore if */
          if (err) {
            reject(err);
          }
          let value = data || "";
          resolve(value);
        })
      } catch(err) {
        reject(err)
      }
    });
  }

  private async sdel(publicKey: keyof D): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        let privateKey = await this.getPrivateKey(publicKey);
        this.store.del(privateKey, (err) => {
          /* istanbul ignore if */
          if (err) {
            return reject(err)
          } else {
            resolve()
          }
        });
      } catch(err) {
        reject(err)
      }
    });
  }

  async create(data: D): Promise<string> {
    let value = JSON.stringify(data);
    return this.sset(value);
  }

  async get(key: StoreKeys<D>): Promise<D> {
    let value = await this.sget(key);
    return JSON.parse(value);
  }

  async destroy(key: StoreKeys<D>) {
    return this.sdel(key);
  }

  async set<K extends keyof D, V extends D[K]>(key: K, data: V): Promise<V> {
    let value = JSON.stringify(data);
    await this.srset(key, value);
    return data;
  }
}