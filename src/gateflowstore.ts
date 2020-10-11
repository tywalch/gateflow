import {Encrypter} from "./encrypter";

export type Callback<T> = (err: Error | null, reply: T) => void
export interface Store {
  set: (key: string, value: string, mode: string, duration: number, cb?: Callback<"OK" | undefined> | undefined) => boolean;
  get: (key: string, cb?: Callback<string | null> | undefined) => boolean
  del: (key: string, cb?: Callback<number> | undefined) => boolean,
  quit: () => void;
}

export default class GateFlowStore {
  public ttl: number;
  public store: Store;
  private encrypter: Encrypter;

  constructor(store: Store, secret: string, ttl: number) {
    this.ttl = ttl;
    this.store = store;
    this.encrypter = new Encrypter(secret);
  }

  private async getPrivateKey(publicKey: string): Promise<string> {
    let privateKey = await this.encrypter.decrypt(publicKey);
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
        this.store.set(privateKey, value, "EX", this.ttl, (err, data) => {
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

  private async srset(publicKey: string, value: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        let privateKey = await this.getPrivateKey(publicKey);
        this.store.set(privateKey, value, "EX", this.ttl, (err, data) => {
          if (err) {
            return reject(err);
          }
          return resolve(data);
        })
      } catch(err) {
        return reject(err);
      }
    })
  }

  private async sget(publicKey: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        let privateKey = await this.getPrivateKey(publicKey);
        this.store.get(privateKey, (err, data) => {
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

  private async sdel(publicKey: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        let privateKey = await this.getPrivateKey(publicKey);
        this.store.del(privateKey, (err, data) => {
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

  async create<T extends object>(data: T): Promise<string> {
    let value = JSON.stringify(data);
    return this.sset(value);
  }

  async get<T extends object>(key: string): Promise<T> {
    let value = await this.sget(key);
    return JSON.parse(value);
  }

  async destroy(key: string) {
    return this.sdel(key);
  }

  async set<T extends object>(key: string, data: T): Promise<T> {
    let value = JSON.stringify(data);
    await this.srset(key, value);
    return data;
  }
}